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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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

    /// The indicator retracting after the finger lifts is the one part of this gesture
    /// that isn't finger-driven, so it's the one part that animates. Everything while a
    /// finger is down tracks 1:1 — animating there would put lag between finger and badge.
    private var retract: Animation {
        reduceMotion ? .easeOut(duration: 0.2) : .spring(response: 0.3, dampingFraction: 0.85)
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
            // A drag that gets cancelled rather than ended (the sheet coming up over the
            // list, a system gesture taking over) never reaches `onEnded`, which would
            // leave `dragging` stuck true and let plain momentum overscroll arm the pull.
            .onChange(of: store.isPresented) { _, _ in
                dragging = false
                armed = false
                withAnimation(retract) { pull = 0 }
            }
            .onChange(of: store.reloadToken) { _, _ in
                Task { await onReload() }
            }
    }

    private func update(with overscroll: CGFloat) {
        // Ignore everything that isn't finger-driven: a flick's rubber-band bounce used
        // to fire this the moment it crossed the threshold, with the finger already off.
        guard dragging else {
            if pull != 0 { withAnimation(retract) { pull = 0 } }
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
            // Disarming gets its own (softer) tick — the arm haptic promised something,
            // and silently withdrawing the promise leaves the user guessing.
            armed = false
            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        }
    }

    /// Finger lifted: open the command bar if the pull was held past the threshold.
    ///
    /// The release *direction* decides, not its speed. Still moving down, or roughly
    /// still, means the pull stands — that's the gesture the "Release for Quick Add"
    /// badge just promised, and a confident fast pull is the most deliberate version of
    /// it, not the least. Only a sharp flick back *up* reads as taking it back. (Momentum
    /// overscroll from scrolling can't reach here at all: `dragging` gates it above.)
    private func release(velocity: CGFloat) {
        dragging = false
        let wasArmed = armed
        armed = false
        withAnimation(retract) { pull = 0 }
        guard wasArmed, !store.isPresented else { return }
        guard velocity > -Self.retractVelocity else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        store.open()
    }

    /// Upward points/second at lift-off above which the release reads as pulling the
    /// gesture back rather than completing it.
    private static let retractVelocity: CGFloat = 900

    @ViewBuilder
    private var indicator: some View {
        if pull > deadZone {
            let ready = progress >= 1
            HStack(spacing: 7) {
                Image(systemName: "plus.circle.fill")
                    .rotationEffect(.degrees(reduceMotion ? 0 : Double(progress) * 180))
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
            .allowsHitTesting(false)
            .accessibilityHidden(true)
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
