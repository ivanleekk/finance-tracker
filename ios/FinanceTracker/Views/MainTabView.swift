import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Dashboard", systemImage: "rectangle.3.group") }
            GoalsView()
                .tabItem { Label("Goals", systemImage: "target") }
            PortfolioView()
                .tabItem { Label("Portfolio", systemImage: "chart.pie") }
            TransactionsView()
                .tabItem { Label("Transactions", systemImage: "list.bullet.rectangle") }
            MoreView()
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
        }
    }
}
