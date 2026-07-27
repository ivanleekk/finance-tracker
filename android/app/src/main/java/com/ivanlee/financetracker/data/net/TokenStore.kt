package com.ivanlee.financetracker.data.net

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Access/refresh token storage, backed by [EncryptedSharedPreferences] (keys held in the
 * Android Keystore). The Android counterpart of iOS's Keychain.swift.
 *
 * If the encrypted store can't be opened — a known failure mode after a device restore, when
 * the Keystore key no longer matches the stored data — the file is dropped and recreated.
 * Losing tokens costs one login; a crash loop on launch costs the app.
 */
object TokenStore {
    private const val FILE = "waypoint_secure_prefs"
    private const val ACCESS = "access_token"
    private const val REFRESH = "refresh_token"

    @Volatile
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        if (prefs != null) return
        synchronized(this) {
            if (prefs == null) prefs = open(context.applicationContext)
        }
    }

    private fun open(context: Context): SharedPreferences {
        fun create(): SharedPreferences {
            val key = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            return EncryptedSharedPreferences.create(
                context,
                FILE,
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
        return runCatching { create() }.getOrElse {
            context.deleteSharedPreferences(FILE)
            create()
        }
    }

    var accessToken: String?
        get() = prefs?.getString(ACCESS, null)
        set(value) {
            prefs?.edit()?.apply { if (value == null) remove(ACCESS) else putString(ACCESS, value) }?.apply()
        }

    var refreshToken: String?
        get() = prefs?.getString(REFRESH, null)
        set(value) {
            prefs?.edit()?.apply { if (value == null) remove(REFRESH) else putString(REFRESH, value) }?.apply()
        }

    fun clear() {
        prefs?.edit()?.remove(ACCESS)?.remove(REFRESH)?.apply()
    }
}
