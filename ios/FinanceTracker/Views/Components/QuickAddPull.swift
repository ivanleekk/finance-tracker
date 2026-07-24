import SwiftUI

/// No-op kept so existing `QuickAddPullSensor()` call sites still compile. Overscroll is
/// now read from scroll geometry in `.quickAddPull`, so no marker row is needed.
struct QuickAddPullSensor: View {
    var body: some View { EmptyView() }
}

/// Replaces pull-to-refresh: pulling a List down past a threshold and *releasing* opens
/// the QuickAdd command bar, with a distinct "＋ pull / release" indicator (not the
/// refresh spinner) and a haptic. Also reloads the screen when a change is logged
/// from anywhere.
///
/// Two signals drive it, because neither is sufficient alone:
/// - `onScrollGeometryChange` gives the overscroll distance, but knows nothing about the
///   finger — momentum from a flick rubber-bands well past any threshold on its own.
/// - a simultaneous `DragGesture` gives finger down/up. (`onScrollPhaseChange` looks like
///   the right API for this, but on a `List` it only ever reported `.idle` — no
///   `.interacting`/`.decelerating` transitions — so it can't be used to detect release.)
///
/// Overscroll is rubber-banded, so the `trigger` below is roughly half of it in finger
/// travel: ~100pt of overscroll ≈ a 220pt pull.
private struct QuickAddPull: ViewModifier {
    @Environment(SessionStore.self) private var session
    let store: QuickAddStore
    let onReload: () async -> Void

    /// Overscroll distance (points past the top) that arms the command bar.
    private let trigger: CGFloat = 100
    /// Below this the indicator stays hidden — swallows the bounce of a normal scroll.
    private let deadZone: CGFloat = 20

    @State private var pull: CGFloat = 0
    @State private var armed = false
    /// True only while a finger is on the screen; momentum overscroll must not arm.
    @State private var dragging = false

    private var progress: CGFloat {
        min(1, max(0, (pull - deadZone) / (trigger - deadZone)))
    }

    func body(content: Content) -> some View {
        content
            .scrollBounceBehavior(.always, axes: .vertical)
            .onScrollGeometryChange(for: CGFloat.self) { geo in
                // Distance pulled past the resting top position.
                -(geo.contentOffset.y + geo.contentInsets.top)
            } action: { _, overscroll in
                update(with: overscroll)
            }
            // minimumDistance keeps taps on rows and buttons untouched; being
            // simultaneous leaves the List's own scrolling intact.
            .simultaneousGesture(
                DragGesture(minimumDistance: 4)
                    .onChanged { _ in dragging = true }
                    .onEnded { value in release(velocity: value.velocity.height) }
            )
            .overlay(alignment: .top) { indicator }
            .onChange(of: store.reloadToken) { _, _ in
                Task { await onReload() }
            }
    }

    private func update(with overscroll: CGFloat) {
        // Ignore everything that isn't finger-driven: a flick's rubber-band bounce used
        // to fire this the moment it crossed the threshold, with the finger already off.
        guard dragging else {
            pull = 0
            armed = false
            return
        }
        pull = max(0, overscroll)
        guard !store.isPresented else { return }
        if pull >= trigger, !armed {
            armed = true
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        } else if armed, pull < trigger - 12 {
            // Hysteresis: easing back up past the threshold disarms without flapping.
            armed = false
        }
    }

    /// Finger lifted: open the command bar only if the pull was held past the threshold
    /// *and* the finger had settled. A fast downward flick from the top of the list also
    /// crosses the threshold, but it's a scroll gesture, not a deliberate pull — so
    /// releasing at speed is ignored.
    private func release(velocity: CGFloat) {
        dragging = false
        pull = 0
        guard armed else { return }
        armed = false
        guard !store.isPresented, abs(velocity) < Self.flickVelocity else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        store.open()
    }

    /// Points/second at lift-off above which the gesture reads as a flick, not a pull.
    private static let flickVelocity: CGFloat = 1200

    @ViewBuilder
    private var indicator: some View {
        if pull > deadZone {
            let ready = progress >= 1
            HStack(spacing: 7) {
                Image(systemName: "plus.circle.fill")
                    .rotationEffect(.degrees(Double(progress) * 180))
                    .scaleEffect(ready ? 1.15 : 1)
                Text(ready ? "Release for Quick Add" : "Keep pulling for Quick Add")
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
            .transition(.opacity)
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
