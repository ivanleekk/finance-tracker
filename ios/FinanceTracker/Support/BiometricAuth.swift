import Foundation
import LocalAuthentication

/// Thin wrapper over `LocalAuthentication` for the private-vault lock. Uses
/// `.deviceOwnerAuthentication` (Face ID / Touch ID with device-passcode fallback) so it
/// still works on hardware without enrolled biometrics as long as a passcode is set. On a
/// device with neither, `isAvailable` is false and callers fail *open* — we never lock a
/// user out of their own data on a device that can't authenticate them.
enum BiometricAuth {
    /// True if the device can perform biometric OR passcode auth.
    static var isAvailable: Bool {
        var error: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    /// Face ID / Touch ID / Optic ID / none — for choosing an icon and label.
    static var biometryType: LABiometryType {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
        return context.biometryType
    }

    /// SF Symbol matching the device's biometry (falls back to a generic lock).
    static var symbolName: String {
        switch biometryType {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        case .opticID: return "opticid"
        default: return "lock.shield"
        }
    }

    /// "Face ID" / "Touch ID" / … for prompts and settings copy.
    static var displayName: String {
        switch biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "device passcode"
        }
    }

    /// Prompt the user; returns true on success, false on cancel/failure/unavailable.
    static func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            return false
        }
        do {
            return try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        } catch {
            return false
        }
    }
}
