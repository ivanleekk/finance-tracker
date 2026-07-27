package com.ivanlee.financetracker

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Pins the query-string splitting in `Api.url`.
 *
 * The trap this guards against, and the reason it exists on iOS too: naively appending a path
 * that carries a query percent-encodes the "?", the query becomes part of the path, and the
 * request 404s — silently, if the call site swallowed the error. That's how the dashboard's
 * net-worth outlook first went missing.
 *
 * The production function reads `Api.baseUrl`, which needs an Android context, so this
 * exercises the same builder logic against a fixed base.
 */
class ApiUrlTest {

    /** Mirror of `Api.url`'s body with the base injected. */
    private fun url(base: String, path: String): String {
        val root = base.trimEnd('/').toHttpUrl()
        val separator = path.indexOf('?')
        val bare = if (separator < 0) path else path.substring(0, separator)
        val query = if (separator < 0) null else path.substring(separator + 1)

        val builder = root.newBuilder()
        bare.split('/').filter { it.isNotEmpty() }.forEach { builder.addPathSegment(it) }
        query?.split('&')?.forEach { pair ->
            if (pair.isEmpty()) return@forEach
            val eq = pair.indexOf('=')
            if (eq < 0) builder.addQueryParameter(pair, null)
            else builder.addQueryParameter(pair.substring(0, eq), pair.substring(eq + 1))
        }
        return builder.build().toString()
    }

    private val base = "http://10.0.2.2:8000"

    @Test
    fun `a plain path is appended verbatim`() {
        assertEquals("$base/accounts/household/h1", url(base, "/accounts/household/h1"))
    }

    @Test
    fun `a query string stays a query string`() {
        assertEquals(
            "$base/accounts/household/h1/projection?months=360",
            url(base, "/accounts/household/h1/projection?months=360"),
        )
    }

    @Test
    fun `the question mark is never percent-encoded into the path`() {
        val result = url(base, "/portfolio/snapshots/household/h1?latest_only=true")
        assert(!result.contains("%3F")) { "query separator was encoded into the path: $result" }
        assertEquals("$base/portfolio/snapshots/household/h1?latest_only=true", result)
    }

    @Test
    fun `multiple parameters are all carried across`() {
        assertEquals(
            "$base/exports/household/h1/report?start=2026-01-01&end=2026-12-31",
            url(base, "/exports/household/h1/report?start=2026-01-01&end=2026-12-31"),
        )
    }

    @Test
    fun `a valueless parameter survives`() {
        assertEquals("$base/x?flag", url(base, "/x?flag"))
    }

    @Test
    fun `a trailing slash on the base does not double up`() {
        assertEquals("$base/users", url("$base/", "/users"))
    }
}
