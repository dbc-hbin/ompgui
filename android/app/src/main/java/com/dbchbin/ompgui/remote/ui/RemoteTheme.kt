package com.dbchbin.ompgui.remote.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object OmpColors {
    val Bg = Color(0xFF1B1916)           // --bg
    val BgPanel = Color(0xFF231F1B)      // --bg-panel
    val BgHover = Color(0xFF2B2721)      // --bg-hover
    val BgSelected = Color(0xFF332E26)   // --bg-selected
    val Border = Color(0xFF38322B)       // --border
    val Text = Color(0xFFEBE6DC)         // --text
    val TextMuted = Color(0xFFA39B8E)    // --text-muted
    val TextDim = Color(0xFF938C81)      // --text-dim
    val Accent = Color(0xFFE07B54)       // --accent (terracotta highlight)
    val AccentStrong = Color(0xFFC2542E) // --accent-strong (buttons)
    val AccentHover = Color(0xFFE89371)  // --accent-hover
    val UserBg = Color(0xFF2C2721)       // --user-bg
    val CodeBg = Color(0xFF181715)       // code block background
    val StatusSuccess = Color(0xFF69D5A5)// --status-success
    val StatusError = Color(0xFFFF8A80)  // --status-error
    val StatusWarning = Color(0xFFF0C36A)// --status-warning
}

private val Scheme = darkColorScheme(
    primary = OmpColors.AccentStrong,
    onPrimary = Color.White,
    primaryContainer = OmpColors.BgHover,
    onPrimaryContainer = OmpColors.Text,
    secondary = OmpColors.Accent,
    onSecondary = Color.White,
    background = OmpColors.Bg,
    onBackground = OmpColors.Text,
    surface = OmpColors.BgPanel,
    onSurface = OmpColors.Text,
    surfaceVariant = OmpColors.BgHover,
    onSurfaceVariant = OmpColors.TextMuted,
    outline = OmpColors.Border,
    error = OmpColors.StatusError,
    onError = Color.White,
)

@Composable
fun RemoteTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, content = content)
}
