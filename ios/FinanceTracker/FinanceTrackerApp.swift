import SwiftUI

@main
struct FinanceTrackerApp: App {
    @State private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .task { await session.bootstrap() }
        }
    }
}

struct RootView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        Group {
            switch session.phase {
            case .loading:
                ProgressView("Loading…")
            case .unauthenticated:
                LoginView()
            case .authenticated:
                MainTabView()
            }
        }
        .tint(session.theme.primary.accent)
        .preferredColorScheme(session.preferredColorScheme)
    }
}
