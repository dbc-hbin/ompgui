package com.dbchbin.ompgui.remote

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.dbchbin.ompgui.remote.ui.OmpguiRemoteApp
import com.dbchbin.ompgui.remote.ui.RemoteViewModel
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val viewModel: RemoteViewModel by viewModels()

    private var askedNotifications = false

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { _ -> }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        askedNotifications = savedInstanceState?.getBoolean(KEY_ASKED_NOTIFICATIONS, false) ?: false
        consumePairingIntent(intent)
        consumeSessionIntent(intent)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.uiState.collect { state ->
                    if (state.paired && !askedNotifications) {
                        askedNotifications = true
                        maybeRequestNotificationPermission()
                    }
                }
            }
        }
        setContent {
            OmpguiRemoteApp(viewModel)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(KEY_ASKED_NOTIFICATIONS, askedNotifications)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        consumePairingIntent(intent)
        consumeSessionIntent(intent)
    }

    private fun consumePairingIntent(intent: Intent?) {
        val uri = intent?.dataString ?: return
        if (uri.startsWith("ompgui://pair")) {
            viewModel.consumePairingUri(uri, autoConnect = true)
            intent.data = null
        }
    }

    private fun consumeSessionIntent(intent: Intent?) {
        val sessionId = intent?.getStringExtra(EXTRA_SESSION_ID)
            ?.trim()?.takeIf { it.isNotEmpty() } ?: return
        intent.removeExtra(EXTRA_SESSION_ID)
        viewModel.openSession(sessionId)
    }

    private fun maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
    }

    companion object {
        const val EXTRA_SESSION_ID = "extra_session_id"
        private const val KEY_ASKED_NOTIFICATIONS = "asked_notifications"
    }
}
