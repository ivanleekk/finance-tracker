import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case http(status: Int, detail: String?)
    case sessionExpired

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL."
        case .http(let status, let detail): return detail ?? "Request failed (HTTP \(status))."
        case .sessionExpired: return "Your session has expired. Please log in again."
        }
    }
}

extension Notification.Name {
    static let sessionExpired = Notification.Name("sessionExpired")
}

/// Async URLSession client for the FastAPI backend.
/// Mirrors mobile/src/lib/api.ts: Bearer access token on every request,
/// transparent refresh-and-retry on 401 via /auth/refresh.
actor APIClient {
    static let shared = APIClient()

    /// The backend base URL. Debug builds allow a runtime override ("api_base_url" in
    /// UserDefaults, set from the More tab / login screen) so a physical device can reach
    /// a Mac on the LAN. Release builds ignore the override and use the baked-in endpoint.
    var baseURL: URL {
        #if DEBUG
        if let saved = UserDefaults.standard.string(forKey: "api_base_url"),
           !saved.isEmpty, let url = URL(string: saved) {
            return url
        }
        #endif
        return AppConfig.defaultBaseURL
    }

    // MARK: - JSON coding

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = DateParser.parse(raw) { return date }
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Unrecognized date format: \(raw)"
            ))
        }
        return d
    }()

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        e.dateEncodingStrategy = .formatted(DateParser.isoDateTime)
        return e
    }()

    // MARK: - Public API

    func get<T: Decodable>(_ path: String) async throws -> T {
        try await send(path: path, method: "GET", body: nil)
    }

    /// Raw (undecoded) GET — used for binary downloads like the CSV export ZIP.
    func getData(_ path: String) async throws -> Data {
        try await send(path: path, method: "GET", body: nil, decode: false)
    }

    func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await send(path: path, method: "POST", body: try Self.encoder.encode(body))
    }

    func put<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await send(path: path, method: "PUT", body: try Self.encoder.encode(body))
    }

    func patch<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await send(path: path, method: "PATCH", body: try Self.encoder.encode(body))
    }

    func delete(_ path: String) async throws {
        _ = try await send(path: path, method: "DELETE", body: nil, decode: false)
    }

    /// POST /auth/token with form-encoded credentials; stores both tokens.
    func login(email: String, password: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: "/auth/token"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "username", value: email),
            URLQueryItem(name: "password", value: password),
        ]
        request.httpBody = Data((components.percentEncodedQuery ?? "").utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.checkStatus(response, data: data)
        let token = try Self.decoder.decode(TokenResponse.self, from: data)
        Keychain.set(token.accessToken, for: Keychain.accessTokenKey)
        if let refresh = token.refreshToken {
            Keychain.set(refresh, for: Keychain.refreshTokenKey)
        }
    }

    // MARK: - Core request path

    @discardableResult
    private func send(
        path: String,
        method: String,
        body: Data?,
        decode: Bool = true,
        isRetry: Bool = false
    ) async throws -> Data {
        var request = URLRequest(url: Self.url(base: baseURL, path: path))
        request.httpMethod = method
        request.httpBody = body
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token = Keychain.get(Keychain.accessTokenKey) {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        if status == 401, !isRetry, !path.hasPrefix("/auth/") {
            try await refreshAccessToken()
            return try await send(path: path, method: method, body: body, decode: decode, isRetry: true)
        }

        try Self.checkStatus(response, data: data)
        return data
    }

    /// Build a request URL from a path that may carry a query string.
    ///
    /// `URL.appending(path:)` percent-encodes its argument, so a path like
    /// "/x/projection?months=360" turns the "?" into "%3F" and the query becomes
    /// part of the path — the server sees an unknown route and 404s. Split the
    /// query off and attach it as real query items instead.
    static func url(base: URL, path: String) -> URL {
        guard let separator = path.firstIndex(of: "?") else {
            return base.appending(path: path)
        }
        let bare = String(path[path.startIndex..<separator])
        let query = String(path[path.index(after: separator)...])

        let items = query.split(separator: "&").compactMap { pair -> URLQueryItem? in
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard let name = parts.first, !name.isEmpty else { return nil }
            return URLQueryItem(
                name: String(name),
                value: parts.count > 1 ? String(parts[1]) : nil
            )
        }

        let withPath = base.appending(path: bare)
        guard !items.isEmpty else { return withPath }
        return withPath.appending(queryItems: items)
    }

    private func send<T: Decodable>(path: String, method: String, body: Data?) async throws -> T {
        let data = try await send(path: path, method: method, body: body, decode: true)
        return try Self.decoder.decode(T.self, from: data)
    }

    private func refreshAccessToken() async throws {
        guard let refreshToken = Keychain.get(Keychain.refreshTokenKey) else {
            expireSession()
            throw APIError.sessionExpired
        }
        var request = URLRequest(url: baseURL.appending(path: "/auth/refresh"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(refreshToken)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            try Self.checkStatus(response, data: data)
            let token = try Self.decoder.decode(TokenResponse.self, from: data)
            Keychain.set(token.accessToken, for: Keychain.accessTokenKey)
            if let newRefresh = token.refreshToken {
                Keychain.set(newRefresh, for: Keychain.refreshTokenKey)
            }
        } catch {
            expireSession()
            throw APIError.sessionExpired
        }
    }

    private func expireSession() {
        Keychain.clearTokens()
        NotificationCenter.default.post(name: .sessionExpired, object: nil)
    }

    private static func checkStatus(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard !(200...299).contains(http.statusCode) else { return }
        // FastAPI errors look like {"detail": "..."} (detail may also be a validation array).
        var detail: String?
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            detail = json["detail"] as? String
        }
        throw APIError.http(status: http.statusCode, detail: detail)
    }
}

/// Backend dates arrive as naive ISO datetimes ("2026-07-19T00:00:00[.ffffff]"),
/// timezone-aware ones ("2026-07-19T01:53:01.787071Z"), or plain dates ("2026-07-19").
///
/// Parsed by hand rather than by `DateFormatter`, because this is the app's hottest
/// decoding path: the Dashboard alone pulls balances, transactions and a daily portfolio
/// timeseries covering the household's whole history, which is tens of thousands of date
/// fields in one load. The old implementation tried five `DateFormatter`s in sequence and
/// fell back to a freshly-allocated `ISO8601DateFormatter`; a date-only string — the most
/// common shape the backend sends — cost four *failed* parses before the one that worked,
/// at roughly 100µs each. That is where the app's half-minute cold start went.
///
/// The scanner below reads fixed offsets out of the string's UTF-8 bytes and converts with
/// days-from-civil arithmetic, so there is no formatter, no `Calendar` and no allocation on
/// the happy path. `DateParser.legacyParse` keeps the old chain as a fallback for anything
/// the scanner doesn't recognise, so no format that used to decode stops decoding.
enum DateParser {
    /// Kept for *encoding* (`APIClient.encoder`) and as the parsing fallback.
    static let isoDateTime = formatter("yyyy-MM-dd'T'HH:mm:ss")
    static let isoDateTimeFractional = formatter("yyyy-MM-dd'T'HH:mm:ss.SSSSSS")
    static let isoDateTimeZoned = formatter("yyyy-MM-dd'T'HH:mm:ssXXXXX")
    static let isoDateTimeFractionalZoned = formatter("yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX")
    static let isoDateOnly = formatter("yyyy-MM-dd")

    static func parse(_ raw: String) -> Date? {
        fastParse(raw) ?? legacyParse(raw)
    }

    // MARK: - Fast path

    /// Reads `yyyy-MM-dd` optionally followed by `THH:mm:ss`, optional fractional seconds,
    /// and an optional `Z` / `±HH:MM` / `±HHMM` offset. Returns nil (rather than a wrong
    /// date) for anything else, including out-of-range components, so the fallback sees it.
    private static func fastParse(_ raw: String) -> Date? {
        // `withUTF8` gives a contiguous buffer without copying when the string already has
        // one, which is the case for every string `JSONDecoder` hands us.
        var raw = raw
        return raw.withUTF8(scan(_:))
    }

    private static func scan(_ bytes: UnsafeBufferPointer<UInt8>) -> Date? {
        let count = bytes.count
        guard count >= 10 else { return nil }

        // Bounds-checked here rather than at each call site: a truncated offset
        // ("…+8" instead of "…+08:00") otherwise reads past the buffer, which
        // `UnsafeBufferPointer` only traps on in debug builds.
        func digits(_ start: Int, _ length: Int) -> Int? {
            guard start >= 0, start + length <= count else { return nil }
            var value = 0
            for index in start..<(start + length) {
                let byte = bytes[index]
                guard byte >= 0x30, byte <= 0x39 else { return nil }
                value = value * 10 + Int(byte - 0x30)
            }
            return value
        }

        guard let year = digits(0, 4), bytes[4] == 0x2D,        // "-"
              let month = digits(5, 2), bytes[7] == 0x2D,
              let day = digits(8, 2),
              month >= 1, month <= 12, day >= 1, day <= 31
        else { return nil }

        var seconds = Double(daysFromCivil(year: year, month: month, day: day)) * 86_400

        guard count > 10 else {
            return Date(timeIntervalSince1970: seconds)
        }
        // Only "T" separates a date from a time here; a space-separated datetime never
        // parsed before either.
        guard bytes[10] == 0x54, count >= 19 else { return nil }
        guard let hour = digits(11, 2), bytes[13] == 0x3A,      // ":"
              let minute = digits(14, 2), bytes[16] == 0x3A,
              let second = digits(17, 2),
              hour <= 23, minute <= 59, second <= 60           // 60 = leap second, as ISO allows
        else { return nil }
        seconds += Double(hour * 3600 + minute * 60 + second)

        var index = 19
        // Fractional seconds: kept at whatever precision was sent, not truncated to the
        // six digits the old `.SSSSSS` formatter insisted on.
        if index < count, bytes[index] == 0x2E {               // "."
            index += 1
            let fractionStart = index
            var fraction = 0.0
            var scale = 1.0
            while index < count, bytes[index] >= 0x30, bytes[index] <= 0x39 {
                scale /= 10
                fraction += Double(bytes[index] - 0x30) * scale
                index += 1
            }
            guard index > fractionStart else { return nil }
            seconds += fraction
        }

        guard index < count else {
            return Date(timeIntervalSince1970: seconds)       // naive == UTC, as before
        }

        switch bytes[index] {
        case 0x5A, 0x7A:                                       // "Z" / "z"
            guard index == count - 1 else { return nil }
        case 0x2B, 0x2D:                                       // "+" / "-"
            let sign: Double = bytes[index] == 0x2B ? -1 : 1   // offset is removed to reach UTC
            let offsetStart = index + 1
            guard let offsetHour = digits(offsetStart, 2) else { return nil }
            let minuteStart = (offsetStart + 2 < count && bytes[offsetStart + 2] == 0x3A)
                ? offsetStart + 3
                : offsetStart + 2
            guard minuteStart + 2 == count, let offsetMinute = digits(minuteStart, 2) else { return nil }
            seconds += sign * Double(offsetHour * 3600 + offsetMinute * 60)
        default:
            return nil
        }
        return Date(timeIntervalSince1970: seconds)
    }

    /// Days between 1970-01-01 and the given proleptic-Gregorian date (Howard Hinnant's
    /// `days_from_civil`). Pure integer arithmetic — no `Calendar`, no timezone lookup.
    private static func daysFromCivil(year: Int, month: Int, day: Int) -> Int {
        let y = year - (month <= 2 ? 1 : 0)
        let era = (y >= 0 ? y : y - 399) / 400
        let yearOfEra = y - era * 400                                   // [0, 399]
        let dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    // MARK: - Fallback

    /// The original formatter chain, now only reached for shapes the scanner rejects.
    static func legacyParse(_ raw: String) -> Date? {
        isoDateTime.date(from: raw)
            ?? isoDateTimeFractional.date(from: raw)
            ?? isoDateTimeZoned.date(from: raw)
            ?? isoDateTimeFractionalZoned.date(from: raw)
            ?? isoDateOnly.date(from: raw)
            ?? sharedISO8601.date(from: raw)
    }

    /// One shared instance; the old code allocated an `ISO8601DateFormatter` per call.
    private static let sharedISO8601 = ISO8601DateFormatter()

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = format
        return f
    }
}
