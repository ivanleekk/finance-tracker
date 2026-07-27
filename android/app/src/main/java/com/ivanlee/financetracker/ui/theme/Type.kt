package com.ivanlee.financetracker.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * The Material 3 type scale, unchanged apart from one thing: money is set in tabular
 * figures wherever it appears in a column, so digits line up down a list (see
 * [numericStyle]). Everything else stays default — the M3 scale is what the platform's
 * accessibility scaling and density rules are tuned for.
 */
val WaypointTypography = Typography()

/** Monospaced digits for aligned money columns. */
val numericStyle: TextStyle = TextStyle(
    fontFamily = FontFamily.Monospace,
    fontWeight = FontWeight.Medium,
    fontSize = 14.sp,
)
