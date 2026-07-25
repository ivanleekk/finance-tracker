import SwiftUI

/// Guided first-run setup, the native counterpart of the web `/onboarding` flow. Backend
/// `POST /users` doesn't create a household, so a brand-new signup would otherwise land in
/// an empty app; this two-step flow creates the first household (+ optional starter
/// accounts), records the private-by-default choice, and optionally invites a partner.
///
/// Step 1 always creates the household — even "Skip" — so the app is never entered without
/// one. `SessionStore.isOnboarding` keeps this view mounted across step 1 (which makes
/// `households` non-empty) until the user finishes; see `SessionStore.needsOnboarding`.
struct OnboardingView: View {
    @Environment(SessionStore.self) private var session

    @State private var step = 1
    @State private var baseCurrency = "USD"
    @State private var showCurrencyPicker = false

    // Step 1 — starter accounts (mirror web presets) + privacy default.
    @State private var addCash = false
    @State private var cashBalance = ""
    @State private var addInvestment = false
    @State private var investmentBalance = ""
    @State private var defaultPrivate = true

    // Step 2 — household name + optional invite.
    @State private var householdName = ""
    @State private var inviteEmail = ""

    @State private var isWorking = false
    @State private var errorMessage: String?

    private let quickCurrencies = ["USD", "SGD", "EUR", "GBP"]

    private var defaultHouseholdName: String {
        if let name = session.user?.name, !name.isEmpty { return "\(name)'s finances" }
        return "My finances"
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    session.theme.secondary.accent.opacity(0.12),
                    Color(.systemBackground),
                    session.theme.primary.accent.opacity(0.10),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 20) {
                    progressHeader
                    if step == 1 { stepOne } else { stepTwo }
                }
                .padding(20)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
        }
        .tint(session.theme.primary.accent)
        .sheet(isPresented: $showCurrencyPicker) {
            NavigationStack { CurrencyPicker(selection: $baseCurrency) }
        }
        .onAppear {
            session.isOnboarding = true
            if householdName.isEmpty { householdName = defaultHouseholdName }
            defaultPrivate = session.user?.defaultsNewItemsPrivate ?? true
        }
    }

    // MARK: Header

    private var progressHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(.systemGray5))
                    Capsule()
                        .fill(LinearGradient(
                            colors: [session.theme.secondary.accent, session.theme.primary.accent],
                            startPoint: .leading, endPoint: .trailing
                        ))
                        .frame(width: geo.size.width * (step == 1 ? 0.5 : 1.0))
                        .animation(.easeInOut(duration: 0.4), value: step)
                }
            }
            .frame(height: 6)

            Text("STEP \(step) / 2")
                .font(.caption2.weight(.bold))
                .tracking(1.5)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 12)
    }

    // MARK: Step 1

    private var stepOne: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Set up in 30 seconds")
                    .font(.system(.title, design: .rounded, weight: .bold))
                Text("Everything here has a smart default — change only what you want.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            // Base currency
            VStack(alignment: .leading, spacing: 10) {
                Text("Base currency").font(.subheadline.weight(.semibold))
                Text("How your net worth and portfolio are totalled.")
                    .font(.caption).foregroundStyle(.secondary)
                FlowChips(
                    options: quickCurrencies,
                    selection: baseCurrency,
                    onSelect: { baseCurrency = $0 },
                    trailing: {
                        Button {
                            showCurrencyPicker = true
                        } label: {
                            Label(
                                quickCurrencies.contains(baseCurrency) ? "More…" : baseCurrency,
                                systemImage: "chevron.down"
                            )
                            .font(.subheadline.weight(.semibold))
                            .labelStyle(.titleAndIcon)
                        }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                    }
                )
            }

            // Starter accounts
            VStack(alignment: .leading, spacing: 10) {
                Text("Add your first account").font(.subheadline.weight(.semibold))
                Text("Optional — tap a preset and enter its current balance.")
                    .font(.caption).foregroundStyle(.secondary)
                PresetAccountCard(
                    icon: "💰", title: "Cash account",
                    isOn: $addCash, balance: $cashBalance, currency: baseCurrency
                )
                PresetAccountCard(
                    icon: "📈", title: "Investment account",
                    isOn: $addInvestment, balance: $investmentBalance, currency: baseCurrency
                )
            }

            Toggle(isOn: $defaultPrivate) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("New entries are private by default").font(.subheadline)
                    Text("Keep new accounts and goals to yourself until you share them.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(14)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(.footnote).foregroundStyle(.red)
            }

            HStack(spacing: 12) {
                Button {
                    Task { await runFastSetup(skipPresets: true) }
                } label: {
                    Text("Skip").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)

                Button {
                    Task { await runFastSetup(skipPresets: false) }
                } label: {
                    Text(isWorking ? "Setting up…" : "Continue").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .disabled(isWorking)
        }
        .padding(22)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 20, y: 8)
    }

    // MARK: Step 2

    private var stepTwo: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Share with a household?")
                    .font(.system(.title, design: .rounded, weight: .bold))
                Text("Optional. Track shared money with a partner or family, kept separate from your private accounts. You can always do this later.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Household name").font(.subheadline.weight(.semibold))
                TextField("My finances", text: $householdName)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Invite by email (optional)").font(.subheadline.weight(.semibold))
                TextField("partner@example.com", text: $inviteEmail)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(.footnote).foregroundStyle(.red)
            }

            HStack(spacing: 12) {
                Button {
                    session.finishOnboarding()
                } label: {
                    Text("Skip for now").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)

                Button {
                    Task { await finishHousehold() }
                } label: {
                    Text(isWorking ? "Finishing…" : "Create & finish").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .disabled(isWorking)
        }
        .padding(22)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 20, y: 8)
    }

    // MARK: Actions

    private func runFastSetup(skipPresets: Bool) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let name = householdName.trimmingCharacters(in: .whitespaces)
            try await session.createHousehold(
                name: name.isEmpty ? defaultHouseholdName : name,
                baseCurrency: baseCurrency,
                countryCode: "US"
            )
            try await session.updateUser(UserUpdate(defaultNewItemsPrivate: defaultPrivate))

            guard let householdId = session.activeHousehold?.id else {
                errorMessage = "Could not create your household. Please try again."
                return
            }
            let owner = defaultPrivate ? session.user?.id : nil

            if !skipPresets && addCash {
                try await session.createPresetAccount(
                    householdId: householdId, name: "Cash account",
                    liquidity: .liquid, currency: baseCurrency,
                    ownerUserId: owner, startingBalance: Double(cashBalance) ?? 0
                )
            }
            if !skipPresets && addInvestment {
                try await session.createPresetAccount(
                    householdId: householdId, name: "Investment account",
                    liquidity: .marketLiquid, currency: baseCurrency,
                    ownerUserId: owner, startingBalance: Double(investmentBalance) ?? 0
                )
            }
            withAnimation { step = 2 }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func finishHousehold() async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            guard let householdId = session.activeHousehold?.id else {
                session.finishOnboarding(); return
            }
            let name = householdName.trimmingCharacters(in: .whitespaces)
            if !name.isEmpty, name != session.activeHousehold?.name {
                try await session.updateHousehold(id: householdId, name: name, baseCurrency: nil)
            }
            let email = inviteEmail.trimmingCharacters(in: .whitespaces)
            if !email.isEmpty {
                try await session.sendInvite(householdId: householdId, email: email)
            }
            session.finishOnboarding()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Small building blocks

/// A row of selectable pill chips plus an optional trailing control. Sized for a handful of
/// short currency codes + one button, which fits comfortably on an iPhone row.
private struct FlowChips<Trailing: View>: View {
    let options: [String]
    let selection: String
    let onSelect: (String) -> Void
    @ViewBuilder let trailing: Trailing

    var body: some View {
        // Horizontal scroll so the chips + trailing "More…" keep their natural widths and
        // never get squeezed into vertical text when the row is wider than the screen.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(options, id: \.self) { option in
                    let isSelected = option == selection
                    Button { onSelect(option) } label: {
                        Text(option).font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(isSelected ? AnyButtonStyle(.borderedProminent) : AnyButtonStyle(.bordered))
                    .buttonBorderShape(.capsule)
                }
                trailing
                    .fixedSize()
            }
            .padding(.vertical, 2)
        }
    }
}

/// Type-erases the two concrete button styles so a chip can switch between them.
private struct AnyButtonStyle: PrimitiveButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: PrimitiveButtonStyle>(_ style: S) {
        make = { config in AnyView(style.makeBody(configuration: config)) }
    }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}

/// A togglable "starter account" preset with an inline balance field when enabled.
private struct PresetAccountCard: View {
    let icon: String
    let title: String
    @Binding var isOn: Bool
    @Binding var balance: String
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) { isOn.toggle() }
            } label: {
                HStack {
                    Text("\(icon)  \(title)").font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                    Spacer()
                    Image(systemName: isOn ? "checkmark.circle.fill" : "plus.circle")
                        .foregroundStyle(isOn ? Color.accentColor : .secondary)
                }
            }

            if isOn {
                HStack(spacing: 6) {
                    Text(currency).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                    TextField("0.00", text: $balance)
                        .keyboardType(.decimalPad)
                        .font(.subheadline)
                }
                .padding(.vertical, 6)
                .padding(.horizontal, 10)
                .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(isOn ? Color.accentColor.opacity(0.5) : Color.clear, lineWidth: 1.5)
        )
    }
}
