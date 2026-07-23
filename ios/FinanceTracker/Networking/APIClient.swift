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
        var request = URLRequest(url: baseURL.appending(path: path))
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
enum DateParser {
    static let isoDateTime = formatter("yyyy-MM-dd'T'HH:mm:ss")
    static let isoDateTimeFractional = formatter("yyyy-MM-dd'T'HH:mm:ss.SSSSSS")
    static let isoDateTimeZoned = formatter("yyyy-MM-dd'T'HH:mm:ssXXXXX")
    static let isoDateTimeFractionalZoned = formatter("yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX")
    static let isoDateOnly = formatter("yyyy-MM-dd")

    static func parse(_ raw: String) -> Date? {
        isoDateTime.date(from: raw)
            ?? isoDateTimeFractional.date(from: raw)
            ?? isoDateTimeZoned.date(from: raw)
            ?? isoDateTimeFractionalZoned.date(from: raw)
            ?? isoDateOnly.date(from: raw)
            ?? ISO8601DateFormatter().date(from: raw)
    }

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = format
        return f
    }
}
