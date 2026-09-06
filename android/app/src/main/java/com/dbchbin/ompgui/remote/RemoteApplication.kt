package com.dbchbin.ompgui.remote

import android.app.Application
import com.dbchbin.ompgui.remote.net.RelayClient
import com.dbchbin.ompgui.remote.notify.AppForeground

class RemoteApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        AppForeground.init()
        RelayClient.get(this)
    }
}
