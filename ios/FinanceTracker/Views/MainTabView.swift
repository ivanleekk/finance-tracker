import SwiftUI

struct MainTabView: View {
    /// Named `AppTab` rather than `Tab` so it doesn't shadow SwiftUI's `Tab` builder below.
    enum AppTab: Hashable {
        case dashboard, accounts, portfolio, transactions, more
    }

    @Environment(QuickAddStore.self) private var quickAdd
    @Environment(SessionStore.self) private var session
    @Environment(ViewModeStore.self) private var viewMode
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
            Tab("Transactions", systemImage: "list.bullet.rectangle", value: AppTab.transactions) {
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
    }
}
