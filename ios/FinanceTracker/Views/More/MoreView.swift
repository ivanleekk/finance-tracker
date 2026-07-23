import SwiftUI

struct MoreView: View {
    @Environment(SessionStore.self) private var session

    @AppStorage("api_base_url") private var apiBaseURL = ""
    @State private var showingLogoutConfirm = false
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
                    Section("Profile") {
                        LabeledContent("Name", value: user.name)
                        LabeledContent("Email", value: user.email)
                    }
                }

                Section("Household") {
                    if session.households.count > 1 {
                        Picker("Active Household", selection: $session.activeHousehold) {
                            ForEach(session.households) { household in
                                Text(household.name).tag(Optional(household))
                            }
                        }
                    } else if let household = session.activeHousehold {
                        LabeledContent("Household", value: household.name)
                    }
                    if let household = session.activeHousehold {
                        LabeledContent("Base Currency", value: household.baseCurrency)
                        LabeledContent("Country", value: household.countryCode)
                        NavigationLink {
                            HouseholdMembersView()
                        } label: {
                            Label("Members & Invites", systemImage: "person.2")
                        }
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

                Section {
                    TextField("http://192.168.1.142:8000", text: $apiBaseURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("API Server")
                } footer: {
                    Text("Leave empty for localhost (simulator). On a physical device, point this at your Mac's LAN address, e.g. http://192.168.1.10:8000.")
                }

                Section {
                    Button("Log Out", role: .destructive) {
                        showingLogoutConfirm = true
                    }
                }
            }
            .navigationTitle("More")
            .confirmationDialog("Log out of Finance Tracker?", isPresented: $showingLogoutConfirm, titleVisibility: .visible) {
                Button("Log Out", role: .destructive) {
                    session.logout()
                }
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
