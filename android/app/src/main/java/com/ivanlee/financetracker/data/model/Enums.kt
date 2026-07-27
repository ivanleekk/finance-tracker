package com.ivanlee.financetracker.data.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * A value the app doesn't know about must not fail the decode of the whole list — an older
 * build should still show the rows it understands rather than an empty screen. Mirrors the
 * lenient `init(from:)` overrides in iOS's Models.swift.
 */
private inline fun <reified T : Enum<T>> lenientEnumSerializer(
    name: String,
    crossinline wire: (T) -> String,
    fallback: T,
): KSerializer<T> = object : KSerializer<T> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor(name, PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): T {
        val raw = decoder.decodeString()
        return enumValues<T>().firstOrNull { wire(it) == raw } ?: fallback
    }

    override fun serialize(encoder: Encoder, value: T) = encoder.encodeString(wire(value))
}

@Serializable(with = LiquidityStatusSerializer::class)
enum class LiquidityStatus(val wire: String, val label: String) {
    LIQUID("liquid", "Liquid"),
    MARKET_LIQUID("market_liquid", "Market Liquid"),
    TIME_LOCKED("time_locked", "Time Locked"),
    RETIREMENT("retirement", "Retirement"),

    /** Property, vehicles and other physical assets: part of net worth, never "liquid now". */
    ILLIQUID("illiquid", "Property"),
}

object LiquidityStatusSerializer :
    KSerializer<LiquidityStatus> by lenientEnumSerializer(
        "LiquidityStatus", { it.wire }, LiquidityStatus.LIQUID
    )

@Serializable
enum class TransactionType(val wire: String) {
    @SerialName("income")
    INCOME("income"),

    @SerialName("expense")
    EXPENSE("expense"),
}

@Serializable
enum class TradeType(val wire: String, val label: String) {
    @SerialName("buy")
    BUY("buy", "Buy"),

    @SerialName("sell")
    SELL("sell", "Sell"),
}

@Serializable
enum class TaxTreatment(val wire: String, val label: String) {
    @SerialName("taxable")
    TAXABLE("taxable", "Taxable"),

    @SerialName("tax_deferred")
    TAX_DEFERRED("tax_deferred", "Tax-Deferred"),

    @SerialName("tax_free")
    TAX_FREE("tax_free", "Tax-Free"),
}

@Serializable
enum class AccountKind(val wire: String, val label: String) {
    @SerialName("asset")
    ASSET("asset", "Asset"),

    @SerialName("liability")
    LIABILITY("liability", "Liability"),
}

@Serializable
enum class HouseholdRole(val wire: String, val label: String) {
    @SerialName("owner")
    OWNER("owner", "Owner"),

    @SerialName("editor")
    EDITOR("editor", "Editor"),

    @SerialName("viewer")
    VIEWER("viewer", "Viewer"),
}

@Serializable(with = RecurrenceFrequencySerializer::class)
enum class RecurrenceFrequency(val wire: String, val label: String) {
    WEEKLY("weekly", "Weekly"),
    BIWEEKLY("biweekly", "Every 2 weeks"),
    MONTHLY("monthly", "Monthly"),
    QUARTERLY("quarterly", "Quarterly"),
    YEARLY("yearly", "Yearly");

    /**
     * How many times a month this fires — used to normalize rules of different cadences
     * into one comparable "per month" commitment figure.
     */
    val occurrencesPerMonth: Double
        get() = when (this) {
            WEEKLY -> 52.0 / 12.0
            BIWEEKLY -> 26.0 / 12.0
            MONTHLY -> 1.0
            QUARTERLY -> 1.0 / 3.0
            YEARLY -> 1.0 / 12.0
        }
}

object RecurrenceFrequencySerializer :
    KSerializer<RecurrenceFrequency> by lenientEnumSerializer(
        "RecurrenceFrequency", { it.wire }, RecurrenceFrequency.MONTHLY
    )

@Serializable(with = BudgetPeriodSerializer::class)
enum class BudgetPeriod(val wire: String, val label: String) {
    MONTHLY("monthly", "Monthly"),
    YEARLY("yearly", "Yearly"),
}

object BudgetPeriodSerializer :
    KSerializer<BudgetPeriod> by lenientEnumSerializer(
        "BudgetPeriod", { it.wire }, BudgetPeriod.MONTHLY
    )

/**
 * Which slice of the household's finances to show. Mirrors the web ViewModeContext:
 * - [BLENDED]: shared items **and** my own private items (default; the only mode a solo
 *   household ever uses).
 * - [HOUSEHOLD]: shared items only — everyone's shared money, nobody's private.
 * - [PRIVATE]: only my own private items.
 *
 * The server never returns *other* members' private data, so filtering here is purely about
 * my own private-vs-shared items.
 */
enum class ViewMode(val wire: String, val label: String) {
    BLENDED("blended", "Blended"),
    HOUSEHOLD("household", "Household"),
    PRIVATE("private", "Private");

    companion object {
        fun from(raw: String?): ViewMode = entries.firstOrNull { it.wire == raw } ?: BLENDED
    }
}
