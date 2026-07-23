import SwiftUI

/// One Tailwind color scale (50–950), same shades the web dashboard uses.
struct Palette: Equatable {
    let shades: [Int: Color]

    subscript(_ shade: Int) -> Color {
        shades[shade] ?? .accentColor
    }

    /// Adaptive accent: shade 600 in light mode, 400 in dark (the web app runs
    /// dark and leans on the 400/500 range; 600 keeps contrast on white).
    var accent: Color {
        let light = UIColor(self[600])
        let dark = UIColor(self[400])
        return Color(UIColor { trait in
            trait.userInterfaceStyle == .dark ? dark : light
        })
    }
}

/// The user's chosen palettes, resolved from the names stored on the backend
/// (UserResponse.primary_color etc.) — mirrors the web ThemeContext.
struct AppTheme: Equatable {
    let primary: Palette
    let secondary: Palette
    let base: Palette

    /// Same choices THEME_PALETTES offers on the web settings page.
    static let primaryChoices = ["sky", "indigo", "rose", "emerald", "blue"]
    static let secondaryChoices = ["fuchsia", "orange", "yellow"]
    static let baseChoices = ["mauve", "slate"]

    init(primaryName: String?, secondaryName: String?, baseName: String?) {
        primary = Self.palette(primaryName, fallback: "sky")
        secondary = Self.palette(secondaryName, fallback: "fuchsia")
        base = Self.palette(baseName, fallback: "mauve")
    }

    static func from(_ user: UserResponse?) -> AppTheme {
        AppTheme(
            primaryName: user?.primaryColor,
            secondaryName: user?.secondaryColor,
            baseName: user?.baseColor
        )
    }

    private static func palette(_ name: String?, fallback: String) -> Palette {
        ThemePalettes.all[name ?? fallback]
            ?? ThemePalettes.all[fallback]
            ?? Palette(shades: [:])
    }
}
