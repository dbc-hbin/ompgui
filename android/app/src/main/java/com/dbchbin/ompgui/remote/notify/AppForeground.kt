package com.dbchbin.ompgui.remote.notify

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Tracks whether any app activity is in the foreground so the ViewModel only
 * posts agent-done notifications when the user is away.
 */
object AppForeground {
    private val foreground = AtomicBoolean(false)
    private var registered = false

    @Synchronized
    fun init() {
        if (registered) return
        registered = true
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                foreground.set(true)
            }

            override fun onStop(owner: LifecycleOwner) {
                foreground.set(false)
            }
        })
    }

    fun isForeground(): Boolean = foreground.get()

    /** Test-only override. */
    fun setForegroundForTest(value: Boolean) {
        foreground.set(value)
    }
}
