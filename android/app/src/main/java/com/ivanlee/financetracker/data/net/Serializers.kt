package com.ivanlee.financetracker.data.net

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.nullable
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Pydantic serializes `Decimal` fields as JSON *strings* ("5000.00") but `float` fields as
 * numbers. Every money field must go through this (or [OptionalMoneySerializer]) or the
 * decode of the whole response fails. Kotlin twin of iOS's `@MoneyAmount`.
 */
object MoneySerializer : KSerializer<Double> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("Money", PrimitiveKind.DOUBLE)

    override fun deserialize(decoder: Decoder): Double {
        val json = decoder as? JsonDecoder ?: return decoder.decodeDouble()
        val primitive = json.decodeJsonElement() as? JsonPrimitive ?: return 0.0
        return primitive.content.toDoubleOrNull() ?: 0.0
    }

    override fun serialize(encoder: Encoder, value: Double) = encoder.encodeDouble(value)
}

/** [MoneySerializer] for nullable fields; an unparseable value decodes to null, not a crash. */
object OptionalMoneySerializer : KSerializer<Double?> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("MoneyOrNull", PrimitiveKind.DOUBLE).nullable

    override fun deserialize(decoder: Decoder): Double? {
        val json = decoder as? JsonDecoder ?: return decoder.decodeDouble()
        val element = json.decodeJsonElement()
        if (element is JsonNull) return null
        return (element as? JsonPrimitive)?.content?.toDoubleOrNull()
    }

    override fun serialize(encoder: Encoder, value: Double?) {
        if (value == null) encoder.encodeNull() else encoder.encodeDouble(value)
    }
}

/**
 * Backend dates arrive as naive ISO datetimes ("2026-07-19T00:00:00[.ffffff]"),
 * timezone-aware ones ("2026-07-19T01:53:01.787071Z"), or plain dates ("2026-07-19").
 *
 * Naive values are read as UTC — the same choice iOS's `DateParser` makes — so a date-only
 * field round-trips through [apiDateOnly] unchanged regardless of where the phone is.
 * Kotlin twin of `DateParser` in APIClient.swift.
 */
object DateParser {
    private val dateTime: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")
    private val dateOnly: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE

    fun parse(raw: String): Instant? {
        val trimmed = raw.trim()
        // Zoned / offset forms first — Instant.parse handles "…Z" and fractional seconds.
        runCatching { return Instant.parse(trimmed) }
        runCatching {
            return java.time.OffsetDateTime.parse(trimmed).toInstant()
        }
        runCatching {
            return LocalDateTime.parse(trimmed).toInstant(ZoneOffset.UTC)
        }
        runCatching {
            return LocalDateTime.parse(trimmed, dateTime).toInstant(ZoneOffset.UTC)
        }
        runCatching {
            return LocalDate.parse(trimmed, dateOnly).atStartOfDay(ZoneOffset.UTC).toInstant()
        }
        return null
    }

    /** How outgoing datetimes are written: naive UTC, matching what FastAPI expects. */
    fun format(instant: Instant): String =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")
            .withZone(ZoneOffset.UTC)
            .format(instant)
}

object InstantSerializer : KSerializer<Instant> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): Instant {
        val raw = decoder.decodeString()
        return DateParser.parse(raw)
            ?: throw IllegalArgumentException("Unrecognized date format: $raw")
    }

    override fun serialize(encoder: Encoder, value: Instant) =
        encoder.encodeString(DateParser.format(value))
}

/** Nullable [InstantSerializer]; a malformed date decodes to null rather than failing the row. */
object OptionalInstantSerializer : KSerializer<Instant?> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("InstantOrNull", PrimitiveKind.STRING).nullable

    override fun deserialize(decoder: Decoder): Instant? {
        val json = decoder as? JsonDecoder ?: return DateParser.parse(decoder.decodeString())
        val element = json.decodeJsonElement()
        if (element is JsonNull) return null
        return (element as? JsonPrimitive)?.content?.let { DateParser.parse(it) }
    }

    override fun serialize(encoder: Encoder, value: Instant?) {
        if (value == null) encoder.encodeNull() else encoder.encodeString(DateParser.format(value))
    }
}

/**
 * "yyyy-MM-dd" in UTC, for backend `date`-typed fields.
 *
 * Pydantic's `date` rejects a datetime with a non-zero time, and a Material date picker
 * carries a time-of-day — so date-only bodies must send a bare date string. UTC matches how
 * [DateParser] reads date-only values back, so seeded dates round-trip.
 */
fun Instant.apiDateOnly(): String =
    DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneOffset.UTC).format(this)
