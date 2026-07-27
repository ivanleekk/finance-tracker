package com.ivanlee.financetracker.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ivanlee.financetracker.BuildConfig
import com.ivanlee.financetracker.data.net.Api
import com.ivanlee.financetracker.state.SessionViewModel
import com.ivanlee.financetracker.ui.components.FormField
import com.ivanlee.financetracker.ui.theme.LocalAppTheme
import com.ivanlee.financetracker.ui.theme.luminanceIsDark
import kotlinx.coroutines.launch

/** Log In / Sign Up. Mirrors ios/FinanceTracker/Views/Auth/LoginView.swift. */
@Composable
fun LoginScreen(sessionVm: SessionViewModel) {
    var isSignUp by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var showServerField by remember { mutableStateOf(false) }
    var serverUrl by remember { mutableStateOf(Api.currentOverride() ?: "") }

    val scope = rememberCoroutineScope()
    val theme = LocalAppTheme.current
    val dark = MaterialTheme.colorScheme.background.luminanceIsDark()

    val canSubmit = email.isNotBlank() && password.length >= 6 &&
        (!isSignUp || name.isNotBlank()) && !busy

    fun submit() {
        if (!canSubmit) return
        busy = true
        error = null
        scope.launch {
            try {
                if (isSignUp) sessionVm.signup(email.trim(), password, name.trim())
                else sessionVm.login(email.trim(), password)
            } catch (e: Exception) {
                error = e.message ?: "Something went wrong. Please try again."
            } finally {
                busy = false
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(
                        theme.secondary.accent(dark).copy(alpha = 0.12f),
                        MaterialTheme.colorScheme.background,
                        theme.primary.accent(dark).copy(alpha = 0.10f),
                    )
                )
            ),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier.widthIn(max = 480.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    "Waypoint",
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                )
                Text(
                    if (isSignUp) "Create an account to start tracking."
                    else "Sign in to your finances.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center,
                )

                if (isSignUp) {
                    FormField(label = "Name", value = name, onValueChange = { name = it })
                }
                FormField(
                    label = "Email",
                    value = email,
                    onValueChange = { email = it },
                    keyboardType = KeyboardType.Email,
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    singleLine = true,
                    visualTransformation = if (showPassword) VisualTransformation.None
                    else PasswordVisualTransformation(),
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                    ),
                    trailingIcon = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(
                                if (showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                contentDescription = if (showPassword) "Hide password" else "Show password",
                            )
                        }
                    },
                    supportingText = if (isSignUp) {
                        { Text("At least 6 characters") }
                    } else null,
                    modifier = Modifier.fillMaxWidth(),
                )

                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }

                Button(
                    onClick = ::submit,
                    enabled = canSubmit,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (busy) {
                        CircularProgressIndicator(
                            modifier = Modifier.padding(end = 8.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                    }
                    Text(if (isSignUp) "Create Account" else "Log In")
                }

                TextButton(
                    onClick = {
                        isSignUp = !isSignUp
                        error = null
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        if (isSignUp) "Already have an account? Log in"
                        else "New here? Create an account"
                    )
                }

                // Debug builds only: point the app at a LAN backend from a physical device.
                // The whole control (and the read path in Api.baseUrl) compiles out of release.
                if (BuildConfig.DEBUG) {
                    TextButton(
                        onClick = { showServerField = !showServerField },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            "API server: ${Api.baseUrl}",
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    if (showServerField) {
                        FormField(
                            label = "Base URL override",
                            value = serverUrl,
                            onValueChange = {
                                serverUrl = it
                                Api.setBaseUrlOverride(it)
                            },
                            placeholder = "http://192.168.1.20:8000",
                            supportingText = "Blank uses ${BuildConfig.API_BASE_URL}",
                        )
                    }
                }
            }
        }
    }
}
