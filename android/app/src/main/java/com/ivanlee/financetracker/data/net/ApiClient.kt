package com.ivanlee.financetracker.data.net

import android.content.Context
import android.content.SharedPreferences
import com.ivanlee.financetracker.BuildConfig
import com.ivanlee.financetracker.data.model.TokenResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
// The reified extensions — without these imports the calls below bind to the
// (serializer, value) overloads and stop compiling.
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Thrown for any non-2xx response; [detail] carries FastAPI's `{"detail": "..."}` message. */
class ApiException(val status: Int, val detail: String?) :
    IOException(detail ?: "Request failed (HTTP $status).")

/** The refresh token was missing or rejected — the user has to log in again. */
class SessionExpiredException : IOException("Your session has expired. Please log in again.")

/**
 * Coroutine HTTP client for the FastAPI backend.
 *
 * Mirrors ios/FinanceTracker/Networking/APIClient.swift: a Bearer access token on every
 * request and a transparent refresh-and-retry on 401 via `/auth/refresh`.
 */
object Api {

    /**
     * Shared JSON config. Three settings carry real weight:
     *  - [JsonNamingStrategy.SnakeCase] maps camelCase Kotlin names onto the Pydantic
     *    snake_case wire format (iOS's `.convertFromSnakeCase`).
     *  - `explicitNulls = false` omits null properties from request bodies, which is what
     *    makes every partial-update model ("send only what changed") work.
     *  - `ignoreUnknownKeys` keeps an older build decoding responses from a newer backend.
     */
    val json: Json = Json {
        namingStrategy = JsonNamingStrategy.SnakeCase
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        isLenient = true
    }

    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val jsonMedia = "application/json".toMediaType()
    private val formMedia = "application/x-www-form-urlencoded".toMediaType()

    /** Emits once whenever the session dies, so the app can drop to the login screen. */
    val sessionExpired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    private var appPrefs: SharedPreferences? = null

    fun init(context: Context) {
        TokenStore.init(context)
        appPrefs = context.applicationContext
            .getSharedPreferences("waypoint_prefs", Context.MODE_PRIVATE)
    }

    /**
     * The backend base URL.
     *
     * Debug builds allow a runtime override (`api_base_url`, set from Settings ▸ API server)
     * so a physical device can reach a Mac on the LAN; release builds ignore the override and
     * always use the baked-in endpoint. The whole override path is compiled out of release.
     */
    val baseUrl: String
        get() {
            if (BuildConfig.DEBUG) {
                val saved = appPrefs?.getString(OVERRIDE_KEY, null)
                if (!saved.isNullOrBlank()) return saved.trimEnd('/')
            }
            return BuildConfig.API_BASE_URL.trimEnd('/')
        }

    const val OVERRIDE_KEY = "api_base_url"

    /** Debug-only: point the app at a different backend (no-op in release). */
    fun setBaseUrlOverride(value: String?) {
        if (!BuildConfig.DEBUG) return
        appPrefs?.edit()?.apply {
            if (value.isNullOrBlank()) remove(OVERRIDE_KEY) else putString(OVERRIDE_KEY, value.trim())
        }?.apply()
    }

    fun currentOverride(): String? =
        if (BuildConfig.DEBUG) appPrefs?.getString(OVERRIDE_KEY, null) else null

    // ---- Public verbs -------------------------------------------------------------------

    suspend inline fun <reified T> get(path: String): T =
        json.decodeFromString(sendForString(path, "GET", null))

    /** Raw (undecoded) GET — used for binary downloads like the CSV export ZIP. */
    suspend fun getBytes(path: String): ByteArray = sendForBytes(path, "GET", null)

    suspend inline fun <reified B, reified T> post(path: String, body: B): T =
        json.decodeFromString(sendForString(path, "POST", json.encodeToString(body)))

    suspend inline fun <reified B, reified T> put(path: String, body: B): T =
        json.decodeFromString(sendForString(path, "PUT", json.encodeToString(body)))

    suspend inline fun <reified B, reified T> patch(path: String, body: B): T =
        json.decodeFromString(sendForString(path, "PATCH", json.encodeToString(body)))

    /** POST that returns a body we don't care about. */
    suspend inline fun <reified B> postIgnoringResult(path: String, body: B) {
        sendForBytes(path, "POST", json.encodeToString(body))
    }

    /** POST with no request body at all (action endpoints like `.../recurring/{id}/run`). */
    suspend inline fun <reified T> postEmpty(path: String): T =
        json.decodeFromString(sendForString(path, "POST", "{}"))

    suspend fun delete(path: String) {
        sendForBytes(path, "DELETE", null)
    }

    /** POST /auth/token with form-encoded credentials; stores both tokens. */
    suspend fun login(email: String, password: String) = withContext(Dispatchers.IO) {
        val form = "username=${email.formEncode()}&password=${password.formEncode()}"
        val request = Request.Builder()
            .url(url("/auth/token"))
            .post(form.toRequestBody(formMedia))
            .build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            checkStatus(response.code, body)
            val token = json.decodeFromString<TokenResponse>(body)
            TokenStore.accessToken = token.accessToken
            token.refreshToken?.let { TokenStore.refreshToken = it }
        }
    }

    // ---- Core request path --------------------------------------------------------------

    suspend fun sendForString(path: String, method: String, body: String?): String =
        String(sendForBytes(path, method, body), Charsets.UTF_8)

    suspend fun sendForBytes(
        path: String,
        method: String,
        body: String?,
        isRetry: Boolean = false,
    ): ByteArray = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(url(path))
        val requestBody = body?.toRequestBody(jsonMedia)
        when (method) {
            "GET" -> builder.get()
            "DELETE" -> if (requestBody != null) builder.delete(requestBody) else builder.delete()
            else -> builder.method(method, requestBody ?: ByteArray(0).toRequestBody(jsonMedia))
        }
        TokenStore.accessToken?.let { builder.header("Authorization", "Bearer $it") }

        val response = http.newCall(builder.build()).execute()
        val bytes = response.use { it.body?.bytes() ?: ByteArray(0) }

        if (response.code == 401 && !isRetry && !path.startsWith("/auth/")) {
            refreshAccessToken()
            return@withContext sendForBytes(path, method, body, isRetry = true)
        }

        checkStatus(response.code, String(bytes, Charsets.UTF_8))
        bytes
    }

    private val refreshLock = Mutex()

    /**
     * Serialized behind [refreshLock] so a screen firing several requests at once doesn't
     * race three refreshes and have two of them invalidate the token the third just stored.
     */
    private suspend fun refreshAccessToken() = refreshLock.withLock {
        val refresh = TokenStore.refreshToken ?: run {
            expireSession()
            throw SessionExpiredException()
        }
        val request = Request.Builder()
            .url(url("/auth/refresh"))
            .header("Authorization", "Bearer $refresh")
            .post(ByteArray(0).toRequestBody(jsonMedia))
            .build()
        // A dropped connection, timeout, or server error here says nothing about whether the
        // refresh token itself is still valid — only a 401 from the server does. Wiping the
        // session on every transport failure turned a flaky network into a surprise full
        // sign-out; only an actual rejection should do that.
        http.newCall(request).execute().use { response ->
            if (response.code == 401) {
                expireSession()
                throw SessionExpiredException()
            }
            val body = response.body?.string().orEmpty()
            checkStatus(response.code, body)
            val token = json.decodeFromString<TokenResponse>(body)
            TokenStore.accessToken = token.accessToken
            token.refreshToken?.let { TokenStore.refreshToken = it }
        }
    }

    private fun expireSession() {
        TokenStore.clear()
        sessionExpired.tryEmit(Unit)
    }

    private fun checkStatus(code: Int, body: String) {
        if (code in 200..299) return
        // FastAPI errors look like {"detail": "..."} (detail may also be a validation array).
        val detail = runCatching {
            json.parseToJsonElement(body).jsonObject["detail"]?.jsonPrimitive?.content
        }.getOrNull()
        throw ApiException(code, detail)
    }

    /**
     * Build a request URL from a path that may carry a query string.
     *
     * OkHttp's `HttpUrl.Builder.addPathSegments` percent-encodes what it's given, so a path
     * like "/x/projection?months=360" would turn the "?" into "%3F" — the query becomes part
     * of the path and the server 404s. Split the query off and attach it as real query
     * parameters instead. (Same trap as iOS's `APIClient.url(base:path:)`; `ApiUrlTest` pins
     * the behaviour.)
     */
    fun url(path: String): HttpUrl {
        val base = baseUrl.toHttpUrlOrNull()
            ?: throw ApiException(0, "Invalid API base URL: $baseUrl")
        val separator = path.indexOf('?')
        val bare = if (separator < 0) path else path.substring(0, separator)
        val query = if (separator < 0) null else path.substring(separator + 1)

        val builder = base.newBuilder()
        bare.split('/').filter { it.isNotEmpty() }.forEach { builder.addPathSegment(it) }
        query?.split('&')?.forEach { pair ->
            if (pair.isEmpty()) return@forEach
            val eq = pair.indexOf('=')
            if (eq < 0) builder.addQueryParameter(pair, null)
            else builder.addQueryParameter(pair.substring(0, eq), pair.substring(eq + 1))
        }
        return builder.build()
    }

    private fun String.formEncode(): String =
        java.net.URLEncoder.encode(this, "UTF-8")
}
