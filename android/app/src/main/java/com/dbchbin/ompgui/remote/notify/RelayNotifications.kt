package com.dbchbin.ompgui.remote.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.dbchbin.ompgui.remote.MainActivity
import com.dbchbin.ompgui.remote.R

object RelayNotifications {
    const val CHANNEL_AGENT = "ompgui_agent"
    const val CHANNEL_RELAY = "ompgui_relay"
    const val NOTIFY_AGENT_DONE = 1001
    const val NOTIFY_RELAY_STATUS = 1002

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_AGENT,
                context.getString(R.string.notify_agent_channel),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = context.getString(R.string.notify_agent_channel_desc) },
        )
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_RELAY,
                context.getString(R.string.notify_relay_channel),
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = context.getString(R.string.notify_relay_channel_desc) },
        )
    }

    fun showAgentDone(context: Context, sessionId: String, title: String) {
        ensureChannels(context)
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            putExtra(MainActivity.EXTRA_SESSION_ID, sessionId)
        }
        val pending = PendingIntent.getActivity(
            context,
            sessionId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_AGENT)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(context.getString(R.string.notify_agent_done_title))
            .setContentText(context.getString(R.string.notify_agent_done_text, title))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        context.getSystemService(NotificationManager::class.java)
            ?.notify(sessionId.hashCode(), notification)
    }

    fun cancelAgentDone(context: Context, sessionId: String) {
        context.getSystemService(NotificationManager::class.java)
            ?.cancel(sessionId.hashCode())
    }

    fun relayStatusNotification(context: Context): android.app.Notification {
        ensureChannels(context)
        return NotificationCompat.Builder(context, CHANNEL_RELAY)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.notify_relay_active))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    fun hasPostPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
    }
}
