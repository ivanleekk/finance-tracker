import SwiftUI

struct MainTabView: View {
    /// Named `AppTab` rather than `Tab` so it doesn't shadow SwiftUI's `Tab` builder below.
    enum AppTab: Hashable {
        case dashboard, accounts, portfolio, cashFlow, more
    }

    @Environment(QuickAddStore.self) private var quickAdd
    @Environment(SessionStore.self) private var session
    @Environment(ViewModeStore.self) private var viewMode
    @Environment(\.scenePhase) private var scenePhase
    @State private var selection: AppTab = .dashboard

    var body: some View {
        @Bindable var quickAdd = quickAdd
        TabView(selection: $selection) {
            Tab("Dashboard", systemImage: "rectangle.3.group", value: AppTab.dashboard) {
                DashboardView(
                    onSeePortfolio: { selection = .portfolio },
                    onSeeAccounts: { selection = .accounts }
                )
            }
            Tab("Accounts", systemImage: "building.columns", value: AppTab.accounts) {
                NavigationStack {
                    AccountsListView()
                }
            }
            Tab("Portfolio", systemImage: "chart.pie", value: AppTab.portfolio) {
                PortfolioView()
            }
            // "Cash Flow" rather than "Transactions": the tab now holds the plan
            // (budgets, card caps, what's scheduled) above the record, and income
            // rows and upcoming salary make "Spending" a lie. It is also the word
            // the backend already uses for this router.
            Tab("Cash Flow", systemImage: "list.bullet.rectangle", value: AppTab.cashFlow) {
                TransactionsView()
            }
            Tab("More", systemImage: "ellipsis.circle", value: AppTab.more) {
                MoreView()
            }
        }
        // Sidebar on regular width (iPad full screen, Mac), ordinary tab bar on compact
        // (iPhone, and iPad in narrow Split View / Slide Over).
        .tabViewStyle(.sidebarAdaptable)
        .sheet(isPresented: $quickAdd.isPresented, onDismiss: { quickAdd.requestReload() }) {
            QuickAddView()
        }
        // iPad keyboards get the web app's ⌘K. It's not a nicety there: haptics don't
        // exist on iPad, so the pull gesture loses the feedback that makes it discoverable.
        .background {
            Button("Quick Add") { quickAdd.open() }
                .keyboardShortcut("k", modifiers: .command)
                .hidden()
        }
        .task(id: session.activeHousehold?.id) {
            await viewMode.refresh(householdId: session.activeHousehold?.id)
        }
        // Configure the private-vault lock from the user's setting when they log in / change,
        // then auto-prompt once so opening the app goes straight to the biometric unlock.
        .task(id: session.user?.id) {
            viewMode.configureVault(requireFaceId: session.user?.requiresFaceIdForVault ?? false)
            if viewMode.isVaultLocked {
                _ = await viewMode.unlockVault()
            }
        }
        // Reflect a live toggle of the setting (same user, changed value) without re-prompting.
        .onChange(of: session.user?.requiresFaceIdForVault) { _, _ in
            viewMode.configureVault(requireFaceId: session.user?.requiresFaceIdForVault ?? false)
        }
        // Re-lock when the app is actually backgrounded, and re-unlock on return. Guard against
        // `.inactive` (the biometric prompt itself makes the app inactive — locking there would
        // loop) by acting only on `.background` / `.active`.
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .background:
                viewMode.lockVault()
            case .active:
                if viewMode.isVaultLocked {
                    Task { _ = await viewMode.unlockVault() }
                }
            default:
                break
            }
        }
    }
}
