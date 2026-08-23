package com.ivanlee.financetracker.state

import android.content.Context
import com.ivanlee.financetracker.logic.CategoryPeriod
import com.ivanlee.financetracker.logic.TopCategoryFilterPrefs
import java.time.Instant

/**
 * SharedPreferences-backed persistence for the Activity screen's Top-Categories filter, keyed per
 * household — two households have different categories, so one household's hidden set is
 * meaningless in the other. Kept out of `logic/` because it touches the framework; the shapes it
 * stores ([TopCategoryFilterPrefs], [CategoryPeriod]) are the pure, testable half.
 */
object TopCategoryFilterStore {
    private const val PREFS = "waypoint_prefs"

    private fun key(householdId: String) = "tx_category_filter_$householdId"

    fun load(context: Context, householdId: String): TopCategoryFilterPrefs {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val base = key(householdId)
        return TopCategoryFilterPrefs(
            hiddenCategoryIds = prefs.getStringSet("$base:hidden", emptySet())?.toSet() ?: emptySet(),
            period = CategoryPeriod.fromWire(prefs.getString("$base:period", null)),
            customStart = prefs.getLong("$base:start", 0L).takeIf { it > 0 }?.let(Instant::ofEpochMilli),
            customEnd = prefs.getLong("$base:end", 0L).takeIf { it > 0 }?.let(Instant::ofEpochMilli),
        )
    }

    fun save(context: Context, householdId: String, value: TopCategoryFilterPrefs) {
        val base = key(householdId)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply {
            putStringSet("$base:hidden", value.hiddenCategoryIds)
            putString("$base:period", value.period.wire)
            putLong("$base:start", value.customStart?.toEpochMilli() ?: 0L)
            putLong("$base:end", value.customEnd?.toEpochMilli() ?: 0L)
            apply()
        }
    }
}
