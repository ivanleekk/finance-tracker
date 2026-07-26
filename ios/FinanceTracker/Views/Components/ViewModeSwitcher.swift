import SwiftUI

/// A compact Private / Household / Blended switch for a screen's nav-bar (drop it inside a
/// `ToolbarItem`). Renders nothing until the active household has a second person, matching
/// the web behaviour where the switch appears only once there's someone to share with.
struct ViewModeSwitcher: View {
    @Environment(ViewModeStore.self) private var viewModeStore
    @Environment(SessionStore.self) private var session

    var body: some View {
        @Bindable var store = viewModeStore
        if viewModeStore.hasSecondPerson {
            Menu {
                Picker("View", selection: $store.viewMode) {
                    ForEach(ViewMode.allCases) { mode in
                        Label(mode.label, systemImage: mode.icon).tag(mode)
                    }
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: viewModeStore.effectiveMode.icon)
                        .font(.caption)
                    Text(viewModeStore.effectiveMode.label)
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(session.theme.primary.accent)
            }
            .accessibilityLabel("View mode: \(viewModeStore.effectiveMode.label)")
        }
    }
}
