import SwiftUI

@main
struct FinanceTrackerApp: App {
    @State private var session = SessionStore()
    @State private var quickAdd = QuickAddStore()
    @State private var viewMode = ViewModeStore()
    @State private var reference = ReferenceDataStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(quickAdd)
                .environment(viewMode)
                .environment(reference)
                .task { await session.bootstrap() }
        }
    }
}

struct RootView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch session.phase {
            case .loading:
                ProgressView("Loading…")
            case .unreachable:
                UnreachableView()
            case .unauthenticated:
                LoginView()
            case .authenticated:
                if session.needsOnboarding {
                    OnboardingView()
                } else {
                    MainTabView()
                }
            }
        }
        .tint(session.theme.primary.accent)
        .preferredColorScheme(session.preferredColorScheme)
        // Coming back to the app is the natural moment the network has recovered.
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active, session.phase == .unreachable {
                Task { await session.retryBootstrap() }
            }
        }
    }
}

/// Shown when launch couldn't load the session for a reason other than the server rejecting
/// it. The tokens are still valid, so this offers Retry rather than a password prompt; Log Out
/// stays available so nobody is stuck on it.
private struct UnreachableView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        ContentUnavailableView {
            Label("Couldn't Reach the Server", systemImage: "wifi.exclamationmark")
        } description: {
            Text(session.bootstrapError ?? "Check your connection and try again.")
        } actions: {
            Button("Retry") {
                Task { await session.retryBootstrap() }
            }
            .buttonStyle(.borderedProminent)
            Button("Log Out", role: .destructive) {
                session.logout()
            }
        }
    }
}
