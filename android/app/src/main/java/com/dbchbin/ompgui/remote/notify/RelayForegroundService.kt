package com.dbchbin.ompgui.remote.notify

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps the relay WebSocket alive while the app is backgrounded so
 * agent-done notifications can fire. Started on Connected, stopped on unpair.
 */
class RelayForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        RelayNotifications.ensureChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
        }
        val notification = RelayNotifications.relayStatusNotification(this)
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                RelayNotifications.NOTIFY_RELAY_STATUS,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(RelayNotifications.NOTIFY_RELAY_STATUS, notification)
        }
        return START_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "com.dbchbin.ompgui.remote.STOP_RELAY"

        fun start(context: Context) {
            val intent = Intent(context, RelayForegroundService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= 26) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (_: Exception) {
                // Foreground start can fail when backgrounded on new Android
                // versions; the socket reconnect path still covers the session.
            }
        }

        fun stop(context: Context) {
            // Never startForegroundService here: if the service is not already
            // running, Android 8+ requires startForeground() within 5s and the
            // ACTION_STOP path would crash. startService is enough to deliver
            // ACTION_STOP to a live FGS; stopService covers the rest.
            try {
                context.startService(
                    Intent(context, RelayForegroundService::class.java).setAction(ACTION_STOP),
                )
            } catch (_: Exception) {
                // ignore; fall through to stopService below
            }
            try {
                context.stopService(Intent(context, RelayForegroundService::class.java))
            } catch (_: Exception) {
                // ignore
            }
        }
    }
}
