package com.dbchbin.ompgui.remote.ui

import android.content.SharedPreferences
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.dbchbin.ompgui.remote.store.AppPreferences

object OmpColors {
    internal var dark by mutableStateOf(true)
    internal var warm by mutableStateOf(true)
    val Bg get() = if (dark) Color(0xFF1B1916) else Color(0xFFFAF8F4)
    val BgPanel get() = if (dark) Color(0xFF231F1B) else Color(0xFFFFFDFA)
    val BgHover get() = if (dark) Color(0xFF2B2721) else Color(0xFFF0EBE3)
    val BgSelected get() = if (dark) Color(0xFF332E26) else Color(0xFFE6DDD1)
    val Border get() = if (dark) Color(0xFF514A41) else Color(0xFFCCC2B5)
    val Text get() = if (dark) Color(0xFFEBE6DC) else Color(0xFF29251F)
    val TextMuted get() = if (dark) Color(0xFFBBB3A6) else Color(0xFF625A4F)
    val TextDim get() = if (dark) Color(0xFFA69E92) else Color(0xFF6D6357)
    val Accent get() = if (warm) { if (dark) Color(0xFFE07B54) else Color(0xFFA94323) } else { if (dark) Color(0xFF9BAAFF) else Color(0xFF4355B9) }
    val AccentStrong get() = if (warm) Color(0xFFAA4524) else Color(0xFF4355B9)
    val AccentHover get() = if (warm) { if (dark) Color(0xFFE89371) else Color(0xFF913719) } else { if (dark) Color(0xFFB6C0FF) else Color(0xFF354399) }
    val UserBg get() = if (dark) Color(0xFF2C2721) else Color(0xFFF0E8DC)
    val CodeBg get() = if (dark) Color(0xFF181715) else Color(0xFFF2EEE7)
    val StatusSuccess get() = if (dark) Color(0xFF69D5A5) else Color(0xFF167448)
    val StatusError get() = if (dark) Color(0xFFFF8A80) else Color(0xFFB3261E)
    val StatusWarning get() = if (dark) Color(0xFFF0C36A) else Color(0xFF855600)
}

@Composable
fun RemoteTheme(
    themeMode: String? = null,
    palette: String? = null,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    var storedTheme by remember(context) { mutableStateOf(AppPreferences.getTheme(context)) }
    var storedPalette by remember(context) { mutableStateOf(AppPreferences.getPalette(context)) }
    DisposableEffect(context) {
        val preferences = AppPreferences.prefs(context)
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == AppPreferences.KEY_THEME) storedTheme = AppPreferences.getTheme(context)
            if (key == AppPreferences.KEY_PALETTE) storedPalette = AppPreferences.getPalette(context)
        }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        onDispose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    val dark = when (themeMode ?: storedTheme) {
        "light" -> false
        "dark" -> true
        else -> isSystemInDarkTheme()
    }
    OmpColors.dark = dark
    OmpColors.warm = (palette ?: storedPalette) != "omp"
    val base = if (dark) darkColorScheme() else lightColorScheme()
    val scheme = base.copy(
        primary = OmpColors.AccentStrong, onPrimary = Color.White,
        primaryContainer = OmpColors.BgSelected, onPrimaryContainer = OmpColors.Text,
        secondary = OmpColors.Accent, onSecondary = Color.White,
        background = OmpColors.Bg, onBackground = OmpColors.Text,
        surface = OmpColors.BgPanel, onSurface = OmpColors.Text,
        surfaceVariant = OmpColors.BgHover, onSurfaceVariant = OmpColors.TextMuted,
        outline = OmpColors.Border, error = OmpColors.StatusError,
        surfaceContainer = OmpColors.BgHover,
    )
    MaterialTheme(colorScheme = scheme, content = content)
}
