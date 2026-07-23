import SwiftUI

struct MainTabView: View {
    enum Tab: Hashable {
        case dashboard, accounts, portfolio, transactions, more
    }

    @Environment(QuickAddStore.self) private var quickAdd
    @State private var selection: Tab = .dashboard

    var body: some View {
        @Bindable var quickAdd = quickAdd
        TabView(selection: $selection) {
            DashboardView(
                onSeePortfolio: { selection = .portfolio },
                onSeeAccounts: { selection = .accounts }
            )
            .tabItem { Label("Dashboard", systemImage: "rectangle.3.group") }
            .tag(Tab.dashboard)

            NavigationStack {
                AccountsListView()
            }
            .tabItem { Label("Accounts", systemImage: "building.columns") }
            .tag(Tab.accounts)

            PortfolioView()
                .tabItem { Label("Portfolio", systemImage: "chart.pie") }
                .tag(Tab.portfolio)

            TransactionsView()
                .tabItem { Label("Transactions", systemImage: "list.bullet.rectangle") }
                .tag(Tab.transactions)

            MoreView()
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
                .tag(Tab.more)
        }
        .sheet(isPresented: $quickAdd.isPresented, onDismiss: { quickAdd.requestReload() }) {
            QuickAddView()
        }
    }
}
