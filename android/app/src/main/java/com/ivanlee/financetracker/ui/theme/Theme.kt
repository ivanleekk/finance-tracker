package com.ivanlee.financetracker.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import com.ivanlee.financetracker.data.model.UserResponse

/** One Tailwind colour scale (50–950) — the same shades the web dashboard uses. */
data class Palette(val shades: Map<Int, Color>) {
    operator fun get(shade: Int): Color = shades[shade] ?: Color(0xFF0284C7)

    /**
     * Adaptive accent: shade 600 in light, 400 in dark. The web app runs dark and leans on
     * the 400/500 range; 600 is what keeps contrast on a white surface.
     */
    fun accent(dark: Boolean): Color = if (dark) this[400] else this[600]
}

/**
 * The user's chosen palettes, resolved from the names stored on the backend
 * (`UserResponse.primary_color` etc.) — mirrors the web ThemeContext and iOS AppTheme.
 */
data class AppTheme(
    val primary: Palette,
    val secondary: Palette,
    val base: Palette,
) {
    companion object {
        /** Same choices THEME_PALETTES offers on the web settings page. */
        val primaryChoices = listOf("sky", "indigo", "rose", "emerald", "blue")
        val secondaryChoices = listOf("fuchsia", "orange", "yellow")
        val baseChoices = listOf("mauve", "slate")

        fun from(user: UserResponse?): AppTheme = AppTheme(
            primary = palette(user?.primaryColor, "sky"),
            secondary = palette(user?.secondaryColor, "fuchsia"),
            base = palette(user?.baseColor, "mauve"),
        )

        private fun palette(name: String?, fallback: String): Palette =
            ThemePalettes.all[name ?: fallback]
                ?: ThemePalettes.all.getValue(fallback)
    }
}

val LocalAppTheme = compositionLocalOf { AppTheme.from(null) }

/** Semantic money colours, kept out of the M3 scheme so gains never read as "primary". */
object MoneyColors {
    val positiveLight = Color(0xFF15803D)
    val positiveDark = Color(0xFF4ADE80)
    val negativeLight = Color(0xFFB91C1C)
    val negativeDark = Color(0xFFF87171)
    val warningLight = Color(0xFFB45309)
    val warningDark = Color(0xFFFBBF24)
}

/** Green for a gain, red for a loss, muted for exactly zero. */
@Composable
@ReadOnlyComposable
fun amountColor(value: Double): Color {
    val dark = MaterialTheme.colorScheme.background.luminanceIsDark()
    return when {
        value > 0 -> if (dark) MoneyColors.positiveDark else MoneyColors.positiveLight
        value < 0 -> if (dark) MoneyColors.negativeDark else MoneyColors.negativeLight
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
}

@Composable
@ReadOnlyComposable
fun positiveColor(): Color =
    if (MaterialTheme.colorScheme.background.luminanceIsDark()) MoneyColors.positiveDark
    else MoneyColors.positiveLight

@Composable
@ReadOnlyComposable
fun negativeColor(): Color =
    if (MaterialTheme.colorScheme.background.luminanceIsDark()) MoneyColors.negativeDark
    else MoneyColors.negativeLight

@Composable
@ReadOnlyComposable
fun warningColor(): Color =
    if (MaterialTheme.colorScheme.background.luminanceIsDark()) MoneyColors.warningDark
    else MoneyColors.warningLight

internal fun Color.luminanceIsDark(): Boolean =
    (0.299 * red + 0.587 * green + 0.114 * blue) < 0.5

/**
 * Material 3 scheme built from the user's saved palette.
 *
 * Deliberately *not* Material You dynamic colour: primary/secondary are a cross-client user
 * preference synced from the backend, so honouring the wallpaper here would make the same
 * account look different on Android than on web/iOS. Surfaces stay M3 baseline neutrals —
 * same rule as iOS, where the base palette is stored for parity but not painted onto
 * backgrounds.
 */
private fun schemeFor(theme: AppTheme, dark: Boolean): ColorScheme {
    val p = theme.primary
    val s = theme.secondary
    return if (dark) {
        darkColorScheme(
            primary = p[400],
            onPrimary = p[950],
            primaryContainer = p[800],
            onPrimaryContainer = p[100],
            inversePrimary = p[600],
            secondary = s[400],
            onSecondary = s[950],
            secondaryContainer = s[800],
            onSecondaryContainer = s[100],
            tertiary = s[300],
            onTertiary = s[950],
            tertiaryContainer = s[900],
            onTertiaryContainer = s[100],
        )
    } else {
        lightColorScheme(
            primary = p[600],
            onPrimary = Color.White,
            primaryContainer = p[100],
            onPrimaryContainer = p[900],
            inversePrimary = p[400],
            secondary = s[600],
            onSecondary = Color.White,
            secondaryContainer = s[100],
            onSecondaryContainer = s[900],
            tertiary = s[700],
            onTertiary = Color.White,
            tertiaryContainer = s[100],
            onTertiaryContainer = s[900],
        )
    }
}

/**
 * @param themeMode the user's `theme_mode` preference: "light", "dark", or null/"system".
 */
@Composable
fun WaypointTheme(
    appTheme: AppTheme = AppTheme.from(null),
    themeMode: String? = null,
    content: @Composable () -> Unit,
) {
    val dark = when (themeMode) {
        "light" -> false
        "dark" -> true
        else -> isSystemInDarkTheme()
    }
    val colorScheme = remember(appTheme, dark) { schemeFor(appTheme, dark) }
    CompositionLocalProvider(LocalAppTheme provides appTheme) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = WaypointTypography,
            content = content,
        )
    }
}
