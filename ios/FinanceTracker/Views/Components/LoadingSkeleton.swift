import SwiftUI

/// An animated placeholder shown while a screen's data loads, instead of a blank page
/// or a bare spinner. Gray content-shaped rows with a moving shimmer draw the eye and
/// signal "loading" clearly. Use as an `.overlay` gated on `isLoading && data.isEmpty`.
struct LoadingSkeleton: View {
    var showsHeader = false
    var rows = 6

    var body: some View {
        VStack(spacing: 18) {
            if showsHeader {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .frame(height: 150)
            }
            ForEach(0..<rows, id: \.self) { _ in
                HStack(spacing: 12) {
                    Circle()
                        .frame(width: 38, height: 38)
                    VStack(alignment: .leading, spacing: 7) {
                        RoundedRectangle(cornerRadius: 4)
                            .frame(height: 12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        RoundedRectangle(cornerRadius: 4)
                            .frame(width: 130, height: 10)
                    }
                    Spacer()
                    RoundedRectangle(cornerRadius: 4)
                        .frame(width: 58, height: 14)
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.quaternary)
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(.systemGroupedBackground))
        .shimmering()
        .accessibilityLabel("Loading")
    }
}

/// A diagonal highlight that sweeps across the view, clipped to its content.
private struct Shimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay {
                GeometryReader { geo in
                    LinearGradient(
                        colors: [.white.opacity(0), .white.opacity(0.55), .white.opacity(0)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: geo.size.width * 0.55)
                    .offset(x: phase * geo.size.width * 1.7)
                    .blendMode(.plusLighter)
                }
                .mask(content)
                .allowsHitTesting(false)
            }
            // A sweep that never stops is exactly the kind of looping motion Reduce
            // Motion exists to switch off; the placeholder still reads as "loading"
            // from its shape and the spinner-free skeleton itself.
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.25).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
    }
}

extension View {
    func shimmering() -> some View { modifier(Shimmer()) }
}
