import SwiftUI

/// A compact Private / Household / Blended switch for a screen's nav-bar (drop it inside a
/// `ToolbarItem`). Renders nothing until the active household has a second person, matching
/// the web behaviour where the switch appears only once there's someone to share with.
///
/// A segmented control rather than the dropdown menu this used to be — three fixed options is
/// exactly what a segmented control is for, and dragging across it switches modes directly
/// instead of opening a menu to pick one.
struct ViewModeSwitcher: View {
    @Environment(ViewModeStore.self) private var viewModeStore

    var body: some View {
        @Bindable var store = viewModeStore
        if viewModeStore.hasSecondPerson {
            Picker("View", selection: $store.viewMode) {
                ForEach(ViewMode.allCases) { mode in
                    Label(mode.label, systemImage: mode.icon)
                        .labelStyle(.iconOnly)
                        .tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .draggableSegments(options: ViewMode.allCases, selection: $store.viewMode)
            .frame(width: 108)
            .accessibilityLabel("View mode: \(viewModeStore.effectiveMode.label)")
        }
    }
}
