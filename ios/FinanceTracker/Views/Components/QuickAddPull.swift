import SwiftUI

/// No-op kept so existing `QuickAddPullSensor()` call sites still compile. Overscroll is
/// now read from scroll geometry in `.quickAddPull`, so no marker row is needed.
struct QuickAddPullSensor: View {
    var body: some View { EmptyView() }
}

/// Replaces pull-to-refresh: pulling a List down past a threshold opens the QuickAdd
/// command bar, with a distinct "＋ pull / release" indicator (not the refresh spinner)
/// and a haptic. Also reloads the screen when a change is logged from anywhere.
private struct QuickAddPull: ViewModifier {
    @Environment(SessionStore.self) private var session
    let store: QuickAddStore
    let onReload: () async -> Void

    /// Overscroll distance (points past the top) that fires the command bar.
    private let trigger: CGFloat = 70
    /// Below this the indicator stays hidden.
    private let deadZone: CGFloat = 6

    @State private var pull: CGFloat = 0
    @State private var armed = false

    private var progress: CGFloat {
        min(1, max(0, (pull - deadZone) / (trigger - deadZone)))
    }

    func body(content: Content) -> some View {
        Group {
            if #available(iOS 18.0, *) {
                content
                    .scrollBounceBehavior(.always, axes: .vertical)
                    .onScrollGeometryChange(for: CGFloat.self) { geo in
                        // Distance pulled past the resting top position.
                        -(geo.contentOffset.y + geo.contentInsets.top)
                    } action: { _, overscroll in
                        update(with: overscroll)
                    }
            } else {
                content
            }
        }
        .overlay(alignment: .top) { indicator }
        .onChange(of: store.reloadToken) { _, _ in
            Task { await onReload() }
        }
    }

    private func update(with overscroll: CGFloat) {
        pull = max(0, overscroll)
        if pull >= trigger, !armed, !store.isPresented {
            armed = true
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            store.open()
        } else if pull < deadZone {
            armed = false
        }
    }

    @ViewBuilder
    private var indicator: some View {
        if pull > deadZone {
            let ready = progress >= 1
            HStack(spacing: 7) {
                Image(systemName: "plus.circle.fill")
                    .rotationEffect(.degrees(Double(progress) * 180))
                    .scaleEffect(ready ? 1.15 : 1)
                Text(ready ? "Release for Quick Add" : "Pull for Quick Add")
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(session.theme.primary.accent, in: Capsule())
            .shadow(color: .black.opacity(0.18), radius: 6, y: 3)
            .scaleEffect(0.85 + 0.15 * progress)
            .opacity(Double(min(1, progress * 1.4)))
            .offset(y: min(pull * 0.45, 54))
            .animation(.snappy(duration: 0.18), value: ready)
            .allowsHitTesting(false)
        }
    }
}

extension View {
    /// Pull this List down to open the QuickAdd command bar (replaces pull-to-refresh),
    /// and reload `onReload` whenever a change is logged.
    func quickAddPull(
        _ store: QuickAddStore,
        onReload: @escaping () async -> Void
    ) -> some View {
        modifier(QuickAddPull(store: store, onReload: onReload))
    }
}
