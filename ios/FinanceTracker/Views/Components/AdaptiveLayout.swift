import SwiftUI

/// Chart height that grows on a wide canvas. A height tuned for a 390pt iPhone reads as a
/// squat band when the same chart is 1400pt across on an iPad, so regular-width layouts
/// get proportionally more vertical room.
private struct AdaptiveChartHeight: ViewModifier {
    @Environment(\.horizontalSizeClass) private var sizeClass

    let compact: CGFloat
    let regular: CGFloat

    func body(content: Content) -> some View {
        content.frame(height: sizeClass == .regular ? regular : compact)
    }
}

extension View {
    /// Applies `compact` on iPhone (and iPad in narrow multitasking), `regular` on a full
    /// iPad/Mac canvas — where the size class, not the device, is what actually matters.
    func adaptiveChartHeight(compact: CGFloat, regular: CGFloat) -> some View {
        modifier(AdaptiveChartHeight(compact: compact, regular: regular))
    }
}
