import SwiftUI

/// The "plan" block that sits above the transactions list, and its exception row
/// on the Dashboard.
///
/// Two shapes, one rule: anything that needs acting on is spelled out inline;
/// everything else collapses to a single row that pushes the full screen. That
/// keeps the activity list on the second screen rather than the fourth, which is
/// the thing this block must not cost.

/// What the household needs to act on, or nothing at all.
///
/// Rendered unconditionally by its hosts — `items.isEmpty` is the ordinary case
/// and produces no section, no header and no empty state. A "nothing needs your
/// attention" placeholder would be a row you learn to skip, which defeats the
/// point of a row that only appears when it matters.
struct NeedsAttentionSection: View {
    let items: [AttentionItem]
    /// Tapping a recurring item posts what's due, rather than pushing a screen
    /// to press the same button one level down.
    var onPostDue: (() async -> Void)?
    var isPosting: Bool = false

    var body: some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { item in
                    if item.kind == .recurring, let onPostDue {
                        Button {
                            Task { await onPostDue() }
                        } label: {
                            HStack {
                                AttentionRow(item: item)
                                Spacer(minLength: 8)
                                if isPosting { ProgressView() }
                            }
                        }
                        // `.plain`, so the row keeps the attention colouring the
                        // other rows use. The default button tint repaints the
                        // whole row in the accent and it stops reading as part
                        // of the same list.
                        .buttonStyle(.plain)
                        .disabled(isPosting)
                    } else {
                        AttentionRow(item: item)
                    }
                }
            } header: {
                Label("Needs attention", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
            }
        }
    }
}

private struct AttentionRow: View {
    let item: AttentionItem

    private var tint: Color {
        // Only what has already happened is red. Painting a projection red too
        // would leave nothing louder to say when the cap actually bursts.
        item.tone == .over ? .red : .orange
    }

    private var symbol: String {
        switch item.kind {
        case .budget: "chart.pie.fill"
        case .card: "creditcard.fill"
        case .recurring: "repeat"
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.footnote)
                .foregroundStyle(tint)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text(item.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title). \(item.detail)")
    }
}

/// A one-line summary that pushes the screen it summarises.
///
/// The same shape as the Dashboard's runway row: a figure worth glancing at,
/// and a way through to the detail. Three of these replace three full sections
/// and cost about 150pt instead of two screens.
struct SummaryLinkRow: View {
    let title: String
    let value: String
    var detail: String?
    var tint: Color = .primary
    let systemImage: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline)
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Text(value)
                .font(.subheadline.monospacedDigit().weight(.semibold))
                .foregroundStyle(tint)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(detail.map { "\(title), \(value), \($0)" } ?? "\(title), \(value)")
    }
}
