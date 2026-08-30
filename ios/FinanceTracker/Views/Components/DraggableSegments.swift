import SwiftUI

/// Makes a native `Picker(.segmented)` (or any n-way segmented control) draggable: pressing
/// anywhere on the bar and dragging across it changes the selection as the finger crosses each
/// segment boundary, the same way scrubbing a real `UISegmentedControl` would feel if Apple
/// exposed that gesture. The picker itself is untouched — this only decides *when* to write a
/// new value to `selection`, so the system draws its own Liquid Glass thumb and animates it with
/// its own transition. Taps go through the same code path (the gesture has `minimumDistance: 0`
/// and fires on touch-down), so tap-to-select keeps working exactly as before.
///
/// VoiceOver is unaffected: while it's active, the system intercepts raw touches for exploration
/// before they ever reach this gesture, so VoiceOver users keep operating the picker's own
/// per-segment accessibility elements. `.accessibilityHidden` makes that explicit rather than
/// relying on it being incidentally true.
private struct DraggableSegments<Option: Hashable>: ViewModifier {
    let options: [Option]
    @Binding var selection: Option

    func body(content: Content) -> some View {
        content.overlay(
            GeometryReader { proxy in
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                let segmentWidth = proxy.size.width / CGFloat(max(options.count, 1))
                                guard segmentWidth > 0 else { return }
                                let index = Int(value.location.x / segmentWidth)
                                let clamped = min(max(index, 0), options.count - 1)
                                let target = options[clamped]
                                if target != selection { selection = target }
                            }
                    )
            }
            .accessibilityHidden(true)
        )
        .sensoryFeedback(.selection, trigger: selection)
    }
}

extension View {
    /// Overlays drag-to-scrub behavior on a segmented `Picker`. See `DraggableSegments`.
    func draggableSegments<Option: Hashable>(options: [Option], selection: Binding<Option>) -> some View {
        modifier(DraggableSegments(options: options, selection: selection))
    }
}
