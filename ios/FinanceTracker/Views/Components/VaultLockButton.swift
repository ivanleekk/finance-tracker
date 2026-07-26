import SwiftUI

/// A nav-bar control for the private-vault lock (drop it inside a `ToolbarItem`). It renders
/// only when the lock is active on this device (setting on + biometrics available):
/// - Locked → a filled lock; tap to authenticate and reveal private items.
/// - Unlocked → an open lock; tap to re-lock immediately.
/// Mirrors the passive `ViewModeSwitcher` pattern — nothing shows when there's nothing to do.
struct VaultLockButton: View {
    @Environment(ViewModeStore.self) private var viewModeStore
    @Environment(SessionStore.self) private var session

    @State private var isAuthenticating = false

    var body: some View {
        if viewModeStore.vaultLockActive {
            Button {
                if viewModeStore.isVaultLocked {
                    guard !isAuthenticating else { return }
                    isAuthenticating = true
                    Task {
                        _ = await viewModeStore.unlockVault()
                        isAuthenticating = false
                    }
                } else {
                    viewModeStore.lockVault()
                }
            } label: {
                Image(systemName: viewModeStore.isVaultLocked ? "lock.fill" : "lock.open.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(viewModeStore.isVaultLocked ? .secondary : session.theme.primary.accent)
            }
            .disabled(isAuthenticating)
            .accessibilityLabel(viewModeStore.isVaultLocked ? "Unlock private vault" : "Lock private vault")
        }
    }
}
