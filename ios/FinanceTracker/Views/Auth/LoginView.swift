import SwiftUI

struct LoginView: View {
    @Environment(SessionStore.self) private var session

    private enum Mode: String, CaseIterable, Identifiable {
        case login = "Log In"
        case signup = "Sign Up"
        var id: String { rawValue }
    }

    private enum Field: Hashable { case name, email, password }

    @State private var mode: Mode = .login
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @FocusState private var focused: Field?
    #if DEBUG
    @AppStorage("api_base_url") private var apiBaseURL = ""
    @State private var showServerSettings = false
    #endif

    private var canSubmit: Bool {
        !isSubmitting && !email.isEmpty && !password.isEmpty && (mode == .login || !name.isEmpty)
    }

    // Web's primary→secondary gradient branding, reused on the mark and CTA.
    private var brandGradient: LinearGradient {
        LinearGradient(
            colors: [session.theme.primary.accent, session.theme.secondary.accent],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
    }

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()

            ScrollView {
                VStack(spacing: 28) {
                    header
                        .padding(.top, 48)

                    Picker("Mode", selection: $mode) {
                        ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    fields

                    #if DEBUG
                    serverSettings
                    #endif

                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .transition(.opacity)
                    }

                    submitButton
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
                .animation(.default, value: mode)
                .animation(.default, value: errorMessage)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private var header: some View {
        VStack(spacing: 18) {
            ZStack {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(brandGradient)
                    .frame(width: 88, height: 88)
                    .shadow(color: session.theme.primary.accent.opacity(0.35), radius: 18, y: 10)
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 40, weight: .bold))
                    .foregroundStyle(.white)
            }
            VStack(spacing: 6) {
                Text("Finance Tracker")
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                Text("Plan your milestones. Grow your net worth.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private var fields: some View {
        VStack(spacing: 0) {
            if mode == .signup {
                inputRow(icon: "person") {
                    TextField("Name", text: $name)
                        .textContentType(.name)
                        .focused($focused, equals: .name)
                        .submitLabel(.next)
                        .onSubmit { focused = .email }
                }
                rowDivider
            }
            inputRow(icon: "envelope") {
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focused = .password }
            }
            rowDivider
            inputRow(icon: "lock") {
                SecureField("Password", text: $password)
                    .textContentType(mode == .signup ? .newPassword : .password)
                    .focused($focused, equals: .password)
                    .submitLabel(.go)
                    .onSubmit { if canSubmit { submit() } }
            }
        }
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func inputRow(icon: String, @ViewBuilder content: () -> some View) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 22)
            content()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 15)
    }

    private var rowDivider: some View {
        Divider().padding(.leading, 52)
    }

    #if DEBUG
    private var effectiveBaseURLDescription: String {
        apiBaseURL.isEmpty ? "http://localhost:8000 (default)" : apiBaseURL
    }

    private var serverSettings: some View {
        DisclosureGroup(isExpanded: $showServerSettings) {
            VStack(alignment: .leading, spacing: 8) {
                TextField("http://192.168.1.142:8000", text: $apiBaseURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Text("Leave empty for localhost (simulator). On a physical device, point this at your Mac's LAN address, e.g. http://192.168.1.10:8000.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 8)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Label("API Server", systemImage: "server.rack")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                // Shows the URL that will actually be used, even while collapsed,
                // since a stale/empty override here is the #1 cause of silent connection failures.
                Text(effectiveBaseURLDescription)
                    .font(.caption)
                    .foregroundStyle(apiBaseURL.isEmpty ? .orange : .secondary)
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .onAppear {
            if apiBaseURL.isEmpty {
                showServerSettings = true
            }
        }
    }
    #endif

    private var submitButton: some View {
        Button {
            submit()
        } label: {
            Group {
                if isSubmitting {
                    ProgressView().tint(.white)
                } else {
                    Text(mode.rawValue).font(.headline)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(.white)
            .background(brandGradient, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .opacity(canSubmit ? 1 : 0.5)
        }
        .disabled(!canSubmit)
    }

    private func submit() {
        focused = nil
        errorMessage = nil
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                if mode == .login {
                    try await session.login(email: email, password: password)
                } else {
                    try await session.signup(email: email, password: password, name: name)
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
