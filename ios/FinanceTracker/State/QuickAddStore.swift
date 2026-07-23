import SwiftUI

/// Drives the global "quick add" command bar. Held at the app root and read from the
/// environment so any screen can open it (via pull-down) and observe reloads after a
/// change is logged. Mirrors the web ⌘K command bar / mobile QuickAdd, but options-first.
@MainActor
@Observable
final class QuickAddStore {
    /// Whether the quick-add sheet is presented (bound from MainTabView).
    var isPresented = false

    /// Bumped whenever a change is logged (or the sheet is dismissed) so open screens
    /// know to reload their data. Screens observe this via `.pullDownToQuickAdd`.
    private(set) var reloadToken = 0

    func open() { isPresented = true }

    func requestReload() { reloadToken += 1 }
}

extension View {
    /// Repurposes a List's pull-to-refresh to open the quick-add command bar instead of
    /// refreshing, and reloads `onReload` whenever a change is logged from anywhere.
    func pullDownToQuickAdd(
        _ store: QuickAddStore,
        onReload: @escaping () async -> Void
    ) -> some View {
        self
            .refreshable { await MainActor.run { store.open() } }
            .onChange(of: store.reloadToken) { _, _ in
                Task { await onReload() }
            }
    }
}
