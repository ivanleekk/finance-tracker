package com.ivanlee.financetracker.state

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel

/**
 * Shared state for the Quick Add command sheet. Mirrors
 * ios/FinanceTracker/State/QuickAddStore.swift.
 *
 * [reloadToken] is the whole point of hoisting this: any screen can `LaunchedEffect` on it
 * and reload when something is logged from anywhere else in the app.
 */
class QuickAddViewModel : ViewModel() {
    var isPresented by mutableStateOf(false)
        private set

    var reloadToken by mutableIntStateOf(0)
        private set

    fun open() {
        isPresented = true
    }

    fun dismiss() {
        isPresented = false
    }

    fun requestReload() {
        reloadToken++
    }
}
