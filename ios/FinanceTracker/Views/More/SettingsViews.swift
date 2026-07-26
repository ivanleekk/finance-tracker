import SwiftUI

// Native counterparts of the web Settings page sections (frontend/src/pages/Settings):
// General (profile + household), Security, Privacy & vault. Appearance and Data live in
// MoreView / ReportsView already.

// MARK: - Profile

/// Edit the signed-in user's name and reporting timezone (PUT /users).
struct ProfileSettingsView: View {
    @Environment(SessionStore.self) private var session

    @State private var name = ""
    @State private var timezone = "UTC"
    @State private var isSaving = false
    @State private var status: SaveStatus = .idle

    private var isDirty: Bool {
        guard let user = session.user else { return false }
        return name.trimmingCharacters(in: .whitespaces) != user.name
            || timezone != (user.preferredTimezone ?? "UTC")
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Email", value: session.user?.email ?? "—")
                HStack {
                    Text("Name")
                    TextField("Your name", text: $name)
                        .textContentType(.name)
                        .multilineTextAlignment(.trailing)
                }
                NavigationLink {
                    TimezonePicker(selection: $timezone)
                } label: {
                    LabeledContent("Timezone", value: timezone)
                }
            } header: {
                Text("Profile")
            } footer: {
                Text("Your timezone is used when dates are recorded. Change your email or password under Security.")
            }

            StatusSection(status: status)
        }
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }
                    .disabled(!isDirty || isSaving || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .onAppear {
            name = session.user?.name ?? ""
            timezone = session.user?.preferredTimezone ?? "UTC"
        }
    }

    private func save() {
        isSaving = true
        status = .idle
        let cleanName = name.trimmingCharacters(in: .whitespaces)
        Task {
            defer { isSaving = false }
            do {
                try await session.updateUser(UserUpdate(name: cleanName, preferredTimezone: timezone))
                status = .success("Profile updated.")
            } catch {
                status = .failure(error.localizedDescription)
            }
        }
    }
}

// MARK: - Security

/// Change email address and/or password (both are partial PUT /users fields).
struct SecuritySettingsView: View {
    @Environment(SessionStore.self) private var session

    @State private var email = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var isSaving = false
    @State private var status: SaveStatus = .idle

    private var emailChanged: Bool {
        let clean = email.trimmingCharacters(in: .whitespaces)
        return !clean.isEmpty && clean.caseInsensitiveCompare(session.user?.email ?? "") != .orderedSame
    }

    private var passwordProblem: String? {
        guard !newPassword.isEmpty else { return nil }
        if newPassword.count < 8 { return "Password must be at least 8 characters." }
        if newPassword != confirmPassword { return "Passwords do not match." }
        return nil
    }

    private var canSave: Bool {
        !isSaving && passwordProblem == nil && (emailChanged || !newPassword.isEmpty)
    }

    var body: some View {
        Form {
            Section {
                TextField("Email", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } header: {
                Text("Email Address")
            } footer: {
                Text("Changing your email changes the address you sign in with.")
            }

            Section {
                SecureField("New password", text: $newPassword)
                    .textContentType(.newPassword)
                SecureField("Confirm new password", text: $confirmPassword)
                    .textContentType(.newPassword)
            } header: {
                Text("Update Password")
            } footer: {
                if let passwordProblem {
                    Text(passwordProblem).foregroundStyle(.red)
                } else {
                    Text("Minimum 8 characters. Leave blank to keep your current password.")
                }
            }

            StatusSection(status: status)
        }
        .navigationTitle("Security")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }
                    .disabled(!canSave)
            }
        }
        .onAppear { email = session.user?.email ?? "" }
    }

    private func save() {
        guard canSave else { return }
        isSaving = true
        status = .idle
        let update = UserUpdate(
            email: emailChanged ? email.trimmingCharacters(in: .whitespaces) : nil,
            password: newPassword.isEmpty ? nil : newPassword
        )
        Task {
            defer { isSaving = false }
            do {
                try await session.updateUser(update)
                newPassword = ""
                confirmPassword = ""
                status = .success("Security settings updated.")
            } catch {
                status = .failure(error.localizedDescription)
            }
        }
    }
}

// MARK: - Privacy & vault

/// The web "Privacy & vault" card: how private accounts/goals behave.
struct PrivacySettingsView: View {
    @Environment(SessionStore.self) private var session

    @State private var hidePrivate = true
    @State private var defaultPrivate = true
    @State private var requireFaceId = false
    @State private var isSaving = false
    @State private var status: SaveStatus = .idle
    /// Seeding the toggles from the user also fires `onChange`; don't PUT until then.
    @State private var didLoad = false

    private var biometryName: String { BiometricAuth.displayName }

    var body: some View {
        Form {
            Section {
                Toggle("Hide private from household", isOn: $hidePrivate)
                    .onChange(of: hidePrivate) { _, value in
                        guard didLoad else { return }
                        save(UserUpdate(hidePrivateFromHousehold: value))
                    }
                Toggle("Default new items to Private", isOn: $defaultPrivate)
                    .onChange(of: defaultPrivate) { _, value in
                        guard didLoad else { return }
                        save(UserUpdate(defaultNewItemsPrivate: value))
                    }
            } header: {
                Text("Private vault")
            } footer: {
                Text("""
                Hidden private items never show their balances to other household members. \
                The default applies to new accounts, goals and Quick Add entries.
                """)
            }

            Section {
                Toggle("Require \(biometryName) to unlock", isOn: $requireFaceId)
                    .onChange(of: requireFaceId) { _, value in
                        guard didLoad else { return }
                        save(UserUpdate(requireFaceIdForVault: value))
                    }
            } header: {
                Label("Vault lock", systemImage: BiometricAuth.symbolName)
            } footer: {
                if BiometricAuth.isAvailable {
                    Text("When on, your private items stay hidden until you unlock them with \(biometryName). The vault re-locks each time you leave the app.")
                } else {
                    Text("This device has no biometrics or passcode set, so the lock can't be enforced here — your private items stay visible. The setting still syncs to your other devices.")
                }
            }

            StatusSection(status: status, savingLabel: isSaving ? "Saving…" : nil)
        }
        .navigationTitle("Privacy & Vault")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            guard !didLoad else { return }
            hidePrivate = session.user?.hidesPrivateFromHousehold ?? true
            defaultPrivate = session.user?.defaultsNewItemsPrivate ?? true
            requireFaceId = session.user?.requiresFaceIdForVault ?? false
            didLoad = true
        }
    }

    private func save(_ update: UserUpdate) {
        isSaving = true
        status = .idle
        Task {
            defer { isSaving = false }
            do {
                try await session.updateUser(update)
            } catch {
                status = .failure(error.localizedDescription)
                // Roll the toggles back to whatever the server still believes.
                didLoad = false
                hidePrivate = session.user?.hidesPrivateFromHousehold ?? true
                defaultPrivate = session.user?.defaultsNewItemsPrivate ?? true
                requireFaceId = session.user?.requiresFaceIdForVault ?? false
                didLoad = true
            }
        }
    }
}

// MARK: - Household preferences

/// Rename the active household and set its base reporting currency (PUT /users/households/{id}).
struct HouseholdSettingsView: View {
    @Environment(SessionStore.self) private var session

    @State private var name = ""
    @State private var baseCurrency = "USD"
    @State private var isSaving = false
    @State private var status: SaveStatus = .idle

    private var isDirty: Bool {
        guard let household = session.activeHousehold else { return false }
        return name.trimmingCharacters(in: .whitespaces) != household.name
            || baseCurrency != household.baseCurrency
    }

    var body: some View {
        Form {
            Section {
                HStack {
                    Text("Name")
                    TextField("Household name", text: $name)
                        .multilineTextAlignment(.trailing)
                }
                NavigationLink {
                    CurrencyPicker(selection: $baseCurrency)
                } label: {
                    LabeledContent("Base currency", value: baseCurrency)
                }
            } header: {
                Text("Household preferences")
            } footer: {
                Text("The base currency is used for every aggregated chart and metric. Existing records keep their own currency and are converted at the rate on their date.")
            }

            if let household = session.activeHousehold {
                Section("Details") {
                    LabeledContent("Country", value: household.countryCode)
                }
            }

            StatusSection(status: status)
        }
        .navigationTitle("Household")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }
                    .disabled(!isDirty || isSaving || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .onAppear {
            name = session.activeHousehold?.name ?? ""
            baseCurrency = session.activeHousehold?.baseCurrency ?? "USD"
        }
    }

    private func save() {
        guard let household = session.activeHousehold else { return }
        isSaving = true
        status = .idle
        let cleanName = name.trimmingCharacters(in: .whitespaces)
        Task {
            defer { isSaving = false }
            do {
                try await session.updateHousehold(
                    id: household.id,
                    name: cleanName,
                    baseCurrency: baseCurrency
                )
                status = .success("Household updated.")
            } catch {
                status = .failure(error.localizedDescription)
            }
        }
    }
}

// MARK: - Reference pickers

/// Searchable ISO 4217 list from GET /reference/currencies.
struct CurrencyPicker: View {
    @Binding var selection: String

    var body: some View {
        ReferencePicker(
            title: "Base Currency",
            path: "/reference/currencies",
            selection: $selection,
            id: \ReferenceCurrency.code,
            label: { "\($0.code) — \($0.name)" },
            searchText: { "\($0.code) \($0.name)" }
        )
    }
}

/// Searchable timezone list from GET /reference/timezones.
struct TimezonePicker: View {
    @Binding var selection: String

    var body: some View {
        ReferencePicker(
            title: "Timezone",
            path: "/reference/timezones",
            selection: $selection,
            id: \ReferenceTimezone.name,
            label: \.label,
            searchText: \.label
        )
    }
}

/// Generic searchable single-select list backed by a `/reference/*` endpoint.
private struct ReferencePicker<Item: Decodable & Hashable>: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    let path: String
    @Binding var selection: String
    let id: (Item) -> String
    let label: (Item) -> String
    let searchText: (Item) -> String

    @State private var items: [Item] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var query = ""

    private var filtered: [Item] {
        let clean = query.trimmingCharacters(in: .whitespaces)
        guard !clean.isEmpty else { return items }
        return items.filter { searchText($0).localizedCaseInsensitiveContains(clean) }
    }

    var body: some View {
        List {
            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
            }
            ForEach(filtered, id: \.self) { item in
                Button {
                    selection = id(item)
                    dismiss()
                } label: {
                    HStack {
                        Text(label(item))
                            .foregroundStyle(.primary)
                        Spacer()
                        if id(item) == selection {
                            Image(systemName: "checkmark")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(.tint)
                        }
                    }
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if isLoading && items.isEmpty {
                ProgressView()
            }
        }
        .task {
            guard items.isEmpty else { return }
            isLoading = true
            defer { isLoading = false }
            do {
                items = try await APIClient.shared.get(path)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Shared save feedback

enum SaveStatus {
    case idle
    case success(String)
    case failure(String)
}

/// Inline success/error row shared by the settings forms.
struct StatusSection: View {
    let status: SaveStatus
    var savingLabel: String? = nil

    var body: some View {
        switch status {
        case .idle:
            if let savingLabel {
                Section {
                    Text(savingLabel)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        case .success(let message):
            Section {
                Label(message, systemImage: "checkmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.green)
            }
        case .failure(let message):
            Section {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
    }
}
