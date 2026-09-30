package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.net.ConnectionState
import kotlinx.coroutines.delay

/** Localized relay connection status, shared by the session list banner and settings. */
@Composable
fun connectionStatusText(connection: ConnectionState): String = when (connection) {
    ConnectionState.Connected -> stringResource(R.string.chat_status_connected)
    ConnectionState.Connecting -> stringResource(R.string.status_connecting)
    ConnectionState.Failed -> stringResource(R.string.status_failed)
    ConnectionState.Idle -> stringResource(R.string.status_idle)
}

/**
 * Offline banner: status, a live "retry in Ns" countdown while a backoff is scheduled,
 * and a Reconnect action. Renders nothing while connected.
 */
@Composable
fun ConnectionBanner(
    connection: ConnectionState,
    nextRetryAtMillis: Long?,
    onReconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (connection == ConnectionState.Connected) return
    val tint = if (connection == ConnectionState.Failed) OmpColors.StatusError else OmpColors.StatusWarning
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = tint.copy(alpha = 0.12f),
        border = BorderStroke(1.dp, tint.copy(alpha = 0.4f)),
    ) {
        Row(
            modifier = Modifier.padding(start = 12.dp, end = 4.dp).heightIn(min = 48.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                Text(
                    connectionStatusText(connection),
                    color = tint,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                if (nextRetryAtMillis != null) RetryCountdown(nextRetryAtMillis)
            }
            TextButton(onClick = onReconnect, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.conn_ux_reconnect), color = tint)
            }
        }
    }
}

/** Own restart scope: the 1s clock recomposes only this line, not the whole banner. */
@Composable
private fun RetryCountdown(nextRetryAtMillis: Long) {
    // Keyed so a newly scheduled retry never renders with the previous attempt's clock.
    var now by remember(nextRetryAtMillis) { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(nextRetryAtMillis) {
        while (true) {
            now = System.currentTimeMillis()
            if (now >= nextRetryAtMillis) break
            delay(1_000L - (nextRetryAtMillis - now) % 1_000L)
        }
    }
    val retrySeconds = ((nextRetryAtMillis - now + 999) / 1_000).coerceAtLeast(0)
    if (retrySeconds > 0) {
        Text(
            stringResource(R.string.conn_ux_retry_in, retrySeconds.toInt()),
            color = OmpColors.TextMuted,
            fontSize = 12.sp,
        )
    }
}
