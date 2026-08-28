package com.ivanlee.financetracker.data

import com.ivanlee.financetracker.data.model.CardLimitStatusRow
import com.ivanlee.financetracker.data.model.CardResponse
import com.ivanlee.financetracker.data.model.CardStatusResponse
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.logic.Cards

/**
 * The card behind an account, with this cycle's headroom — or null, which is the
 * ordinary answer for an account that is not a card rather than an error.
 *
 * Shared by the transaction form and Quick Add so the two cannot drift into
 * saying different things about the same card. It lives here rather than in
 * `logic/` because it makes network calls, and `logic/` is the pure,
 * JVM-testable half.
 */
data class LoadedCard(
    val card: CardResponse,
    val headroom: Map<String, CardLimitStatusRow>,
)

suspend fun loadCardForAccount(householdId: String, accountId: String): LoadedCard? {
    val card = runCatching {
        Api.get<List<CardResponse>>("/cards/household/$householdId")
            .firstOrNull { it.financialAccountId == accountId }
    }.getOrNull() ?: return null

    // A missing meter makes the picker plainer, never the form unusable, so the
    // status is allowed to fail on its own.
    val headroom = runCatching {
        Cards.headroomByCategory(card, Api.get<CardStatusResponse>("/cards/${card.id}/status"))
    }.getOrDefault(emptyMap())

    return LoadedCard(card, headroom)
}
