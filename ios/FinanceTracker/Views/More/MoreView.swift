import SwiftUI

struct MoreView: View {
    @Environment(SessionStore.self) private var session

    #if DEBUG
    @AppStorage("api_base_url") private var apiBaseURL = ""
    #endif
    @State private var showingLogoutConfirm = false
    @State private var showingCreateHousehold = false
    @State private var appearanceError: String?

    private var themeModeBinding: Binding<String> {
        Binding(
            get: { session.user?.themeMode ?? "system" },
            set: { saveAppearance(mode: $0) }
        )
    }

    private func saveAppearance(
        mode: String? = nil,
        primary: String? = nil,
        secondary: String? = nil,
        base: String? = nil
    ) {
        appearanceError = nil
        Task {
            do {
                try await session.updateAppearance(
                    themeMode: mode,
                    primaryColor: primary,
                    secondaryColor: secondary,
                    baseColor: base
                )
            } catch {
                appearanceError = error.localizedDescription
            }
        }
    }

    var body: some View {
        @Bindable var session = session

        NavigationStack {
            Form {
                if let user = session.user {
                    Section("Account") {
                        NavigationLink {
                            ProfileSettingsView()
                        } label: {
                            LabeledContent {
                                Text(user.name)
                            } label: {
                                Label("Profile", systemImage: "person.crop.circle")
                            }
                        }
                        NavigationLink {
                            SecuritySettingsView()
                        } label: {
                            Label("Security", systemImage: "lock")
                        }
                        NavigationLink {
                            PrivacySettingsView()
                        } label: {
                            Label("Privacy & Vault", systemImage: "eye.slash")
                        }
                    }
                }

                Section("Household") {
                    if session.households.count > 1 {
                        Picker("Active Household", selection: $session.activeHousehold) {
                            ForEach(session.households) { household in
                                Text(household.name).tag(Optional(household))
                            }
                        }
                    }
                    if let household = session.activeHousehold {
                        NavigationLink {
                            HouseholdSettingsView()
                        } label: {
                            LabeledContent {
                                Text(household.name)
                            } label: {
                                Label("Preferences", systemImage: "house")
                            }
                        }
                        LabeledContent("Base Currency", value: household.baseCurrency)
                        NavigationLink {
                            HouseholdMembersView()
                        } label: {
                            Label("Members & Invites", systemImage: "person.2")
                        }
                    }
                    Button {
                        showingCreateHousehold = true
                    } label: {
                        Label("Create Household", systemImage: "plus.circle")
                    }
                }

                Section("Appearance") {
                    Picker("Theme", selection: themeModeBinding) {
                        Text("System").tag("system")
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                    }
                    PaletteSwatchRow(
                        title: "Primary",
                        options: AppTheme.primaryChoices,
                        selected: session.user?.primaryColor ?? "sky"
                    ) { saveAppearance(primary: $0) }
                    PaletteSwatchRow(
                        title: "Secondary",
                        options: AppTheme.secondaryChoices,
                        selected: session.user?.secondaryColor ?? "fuchsia"
                    ) { saveAppearance(secondary: $0) }
                    PaletteSwatchRow(
                        title: "Base",
                        options: AppTheme.baseChoices,
                        selected: session.user?.baseColor ?? "mauve"
                    ) { saveAppearance(base: $0) }
                    if let appearanceError {
                        Label(appearanceError, systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                Section("Manage") {
                    NavigationLink {
                        BudgetsView()
                    } label: {
                        Label("Budgets & Emergency Fund", systemImage: "chart.pie")
                    }
                    NavigationLink {
                        RecurringView()
                    } label: {
                        Label("Recurring", systemImage: "repeat")
                    }
                    NavigationLink {
                        ReportsView()
                    } label: {
                        Label("Reports", systemImage: "doc.text.magnifyingglass")
                    }
                    NavigationLink {
                        CategoriesView()
                    } label: {
                        Label("Categories", systemImage: "tag")
                    }
                }

                #if DEBUG
                Section {
                    TextField("http://192.168.1.142:8000", text: $apiBaseURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("API Server (Debug)")
                } footer: {
                    Text("Developer-only, hidden in production builds. Leave empty for localhost (simulator). On a physical device, point this at your Mac's LAN address, e.g. http://192.168.1.10:8000.")
                }
                #endif

                Section {
                    Button("Log Out", role: .destructive) {
                        showingLogoutConfirm = true
                    }
                }
            }
            .navigationTitle("More")
            .confirmationDialog("Log out of Waypoint?", isPresented: $showingLogoutConfirm, titleVisibility: .visible) {
                Button("Log Out", role: .destructive) {
                    session.logout()
                }
            }
            .sheet(isPresented: $showingCreateHousehold) {
                CreateHouseholdView()
            }
        }
    }
}

/// Create a new household and switch to it. The creator becomes its owner.
struct CreateHouseholdView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session

    @State private var name = ""
    @State private var baseCurrency = "USD"
    @State private var countryCode = "US"
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && baseCurrency.trimmingCharacters(in: .whitespaces).count >= 3
            && countryCode.trimmingCharacters(in: .whitespaces).count >= 2
            && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name (e.g. Smith Family)", text: $name)
                    TextField("Base Currency (e.g. USD)", text: $baseCurrency)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    TextField("Country (e.g. US)", text: $countryCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                } footer: {
                    Text("All aggregate values are reported in the base currency. You'll switch to this household after creating it.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("New Household")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { save() }
                        .disabled(!canSave)
                }
            }
        }
    }

    private func save() {
        guard canSave else { return }
        isSaving = true
        errorMessage = nil
        let cleanName = name.trimmingCharacters(in: .whitespaces)
        let currency = baseCurrency.trimmingCharacters(in: .whitespaces).uppercased()
        let country = countryCode.trimmingCharacters(in: .whitespaces).uppercased()
        Task {
            defer { isSaving = false }
            do {
                try await session.createHousehold(
                    name: cleanName,
                    baseCurrency: currency,
                    countryCode: country
                )
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

/// Tap-to-select color swatches, mirroring the web settings palette picker.
private struct PaletteSwatchRow: View {
    let title: String
    let options: [String]
    let selected: String
    let onSelect: (String) -> Void

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            HStack(spacing: 10) {
                ForEach(options, id: \.self) { name in
                    Button {
                        onSelect(name)
                    } label: {
                        Circle()
                            .fill((ThemePalettes.all[name] ?? Palette(shades: [:]))[500])
                            .frame(width: 26, height: 26)
                            .overlay {
                                if name == selected {
                                    Image(systemName: "checkmark")
                                        .font(.caption2.bold())
                                        .foregroundStyle(.white)
                                }
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(title) color \(name)")
                    .accessibilityAddTraits(name == selected ? .isSelected : [])
                }
            }
        }
    }
}
