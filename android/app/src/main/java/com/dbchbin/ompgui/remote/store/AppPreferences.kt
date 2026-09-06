package com.dbchbin.ompgui.remote.store

import android.content.Context
import android.content.SharedPreferences

/**
 * Persisted native app preferences (GeneralSettings owns this file).
 *
 * These are UI-local behaviors that live outside the native OMP config
 * (mirroring desktop `lib/sound-prefs.ts`, `lib/composer-prefs.ts`,
 * `hooks/useTheme.ts` and `TOOL_CALLS_COLLAPSED_STORAGE_KEY` in
 * `components/AppShell.tsx`):
 * - theme mode: system | light | dark (desktop `ompgui-theme`)
 * - palette: warm | omp (desktop `ompgui-palette`)
 * - language: system default persisted as 한국어/English/日本語/简体中文
 * - completion chime (desktop `ompgui-sound-enabled`, default true)
 * - submit during run: steer | queue (desktop `omp-web:submit-during-run`)
 * - tool calls collapsed (desktop `ompgui:tool-calls-collapsed`, default true)
 *
 * Backed by `ompgui_app_prefs` to preserve the existing SettingsSheet keys
 * (`language`, `soundChime`, `submissionMode`).
 */
object AppPreferences {
    const val PREFS_NAME = "ompgui_app_prefs"
    const val KEY_THEME = "theme"
    const val KEY_PALETTE = "palette"
    const val KEY_LANGUAGE = "language"
    const val KEY_SOUND_CHIME = "soundChime"
    const val KEY_SUBMISSION_MODE = "submissionMode"
    const val KEY_TOOL_CALLS_COLLAPSED = "toolCallsCollapsed"

    const val THEME_SYSTEM = "system"
    const val THEME_LIGHT = "light"
    const val THEME_DARK = "dark"

    const val PALETTE_WARM = "warm"
    const val PALETTE_OMP = "omp"

    const val SUBMIT_STEER = "steer"
    const val SUBMIT_QUEUE = "queue"

    fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getTheme(context: Context): String =
        prefs(context).getString(KEY_THEME, THEME_SYSTEM)?.takeIf {
            it == THEME_LIGHT || it == THEME_DARK || it == THEME_SYSTEM
        } ?: THEME_SYSTEM

    fun setTheme(context: Context, value: String) {
        val next = when (value) {
            THEME_LIGHT, THEME_DARK -> value
            else -> THEME_SYSTEM
        }
        prefs(context).edit().putString(KEY_THEME, next).apply()
    }

    fun getPalette(context: Context): String =
        prefs(context).getString(KEY_PALETTE, PALETTE_WARM)?.takeIf {
            it == PALETTE_OMP || it == PALETTE_WARM
        } ?: PALETTE_WARM

    fun setPalette(context: Context, value: String) {
        prefs(context).edit()
            .putString(KEY_PALETTE, if (value == PALETTE_OMP) PALETTE_OMP else PALETTE_WARM)
            .apply()
    }

    fun getLanguage(context: Context, systemLanguage: String): String {
        val stored = prefs(context).getString(KEY_LANGUAGE, null)
        if (stored == "한국어" || stored == "English") return stored
        return if (systemLanguage == "ko") "한국어" else "English"
    }

    fun languageCode(value: String): String = if (value == "한국어") "ko" else "en"

    fun setLanguage(context: Context, value: String) {
        prefs(context).edit().putString(KEY_LANGUAGE, if (value == "한국어") value else "English").apply()
    }

    fun isSoundChime(context: Context): Boolean =
        prefs(context).getBoolean(KEY_SOUND_CHIME, true)

    fun setSoundChime(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_SOUND_CHIME, enabled).apply()
    }

    /** Desktop only supports steer/queue; legacy enter/shift-enter values migrate to steer. */
    fun getSubmitBehavior(context: Context): String =
        when (prefs(context).getString(KEY_SUBMISSION_MODE, SUBMIT_STEER)) {
            SUBMIT_QUEUE -> SUBMIT_QUEUE
            else -> SUBMIT_STEER
        }

    fun setSubmitBehavior(context: Context, value: String) {
        prefs(context).edit()
            .putString(KEY_SUBMISSION_MODE, if (value == SUBMIT_QUEUE) SUBMIT_QUEUE else SUBMIT_STEER)
            .apply()
    }

    fun isToolCallsCollapsed(context: Context): Boolean =
        prefs(context).getBoolean(KEY_TOOL_CALLS_COLLAPSED, true)

    fun setToolCallsCollapsed(context: Context, collapsed: Boolean) {
        prefs(context).edit().putBoolean(KEY_TOOL_CALLS_COLLAPSED, collapsed).apply()
    }
}
