package com.ivanlee.financetracker

import com.ivanlee.financetracker.data.net.ApiException
import com.ivanlee.financetracker.data.net.SessionExpiredException
import com.ivanlee.financetracker.state.SessionViewModel
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Kotlin twin of iOS's `SessionBootstrapTests`.
 *
 * `bootstrap` used to show the login screen for *any* launch failure, so a cold start on a
 * flaky network logged people out while their tokens were still valid. `isAuthRejection` is
 * the rule that separates "the server says this session is dead" from "we couldn't find out".
 */
class SessionBootstrapTest {

    @Test
    fun refreshRejectionIsAnAuthFailure() {
        assertTrue(SessionViewModel.isAuthRejection(SessionExpiredException()))
    }

    @Test
    fun a401AfterRefreshIsAnAuthFailure() {
        assertTrue(SessionViewModel.isAuthRejection(ApiException(401, null)))
    }

    @Test
    fun transportFailuresKeepTheSession() {
        listOf(
            IOException("connection reset"),
            SocketTimeoutException("timeout"),
            UnknownHostException("no dns"),
        ).forEach { assertFalse(it.toString(), SessionViewModel.isAuthRejection(it)) }
    }

    @Test
    fun otherHttpStatusesKeepTheSession() {
        listOf(403, 404, 500, 502, 503).forEach {
            assertFalse("HTTP $it", SessionViewModel.isAuthRejection(ApiException(it, null)))
        }
    }

    @Test
    fun decodeFailuresKeepTheSession() {
        assertFalse(SessionViewModel.isAuthRejection(SerializationException("bad json")))
    }
}
