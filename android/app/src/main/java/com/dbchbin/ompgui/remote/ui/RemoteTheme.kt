package com.dbchbin.ompgui.remote.ui

import android.content.SharedPreferences
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import com.dbchbin.ompgui.remote.store.AppPreferences

object OmpColors {
    internal var dark by mutableStateOf(true)
    internal var warm by mutableStateOf(true)
    // Match globals.css: Warm paper/ember and OMP birch/graphite are full palettes.
    val Bg get() = if (warm) { if (dark) Color(0xFF1B1916) else Color(0xFFFAF9F6) } else { if (dark) Color(0xFF18181E) else Color(0xFFF9F7F1) }
    val BgPanel get() = if (warm) { if (dark) Color(0xFF231F1B) else Color(0xFFF2F0EA) } else { if (dark) Color(0xFF1E1E24) else Color(0xFFF1EEE6) }
    val BgHover get() = if (warm) { if (dark) Color(0xFF2B2721) else Color(0xFFEAE7DF) } else { if (dark) Color(0xFF272A31) else Color(0xFFEBE7DC) }
    val BgSelected get() = if (warm) { if (dark) Color(0xFF332E26) else Color(0xFFE5E0D4) } else { if (dark) Color(0xFF31363F) else Color(0xFFEDE9DF) }
    val Border get() = if (warm) { if (dark) Color(0xFF38322B) else Color(0xFFE2DDD2) } else { if (dark) Color(0xFF3D424A) else Color(0xFFC8C4B8) }
    val Text get() = if (warm) { if (dark) Color(0xFFEBE6DC) else Color(0xFF2B2823) } else { if (dark) Color(0xFFE7E8EA) else Color(0xFF3A3832) }
    val TextMuted get() = if (warm) { if (dark) Color(0xFFA39B8E) else Color(0xFF69635A) } else { if (dark) Color(0xFFA0A4AC) else Color(0xFF68645C) }
    val TextDim get() = if (warm) { if (dark) Color(0xFF938C81) else Color(0xFF6A6458) } else { if (dark) Color(0xFF858B96) else Color(0xFF746F65) }
    val Accent get() = if (warm) { if (dark) Color(0xFFE07B54) else Color(0xFFB03E22) } else { if (dark) Color(0xFFFEBC38) else Color(0xFF608058) }
    val AccentStrong get() = if (warm) { if (dark) Color(0xFFC2542E) else Color(0xFFB03E22) } else { if (dark) Color(0xFF956000) else Color(0xFF4A603F) }
    val AccentHover get() = if (warm) { if (dark) Color(0xFFE89371) else Color(0xFF96331B) } else { if (dark) Color(0xFFFFD06A) else Color(0xFF526F4B) }
    val UserBg get() = if (warm) { if (dark) Color(0xFF2C2721) else Color(0xFFF5EDE1) } else { if (dark) Color(0xFF221D1A) else Color(0xFFF2EFE7) }
    val ToolBg get() = if (warm) { if (dark) Color(0xFF26221D) else Color(0xFFF6F3ED) } else { if (dark) Color(0xFF1D2129) else Color(0xFFEEF0ED) }
    val CodeBg get() = lerp(Bg, BgPanel, 0.12f)
    val StatusSuccess get() = if (warm) { if (dark) Color(0xFF69D5A5) else Color(0xFF18794E) } else { if (dark) Color(0xFF89D281) else Color(0xFF4A713F) }
    val StatusError get() = if (warm) { if (dark) Color(0xFFFF8A80) else Color(0xFFB42318) } else { if (dark) Color(0xFFFF6B78) else Color(0xFFA8463E) }
    val StatusWarning get() = if (warm) { if (dark) Color(0xFFF0C36A) else Color(0xFF8A5A00) } else { if (dark) Color(0xFFE4C00F) else Color(0xFF876A20) }
}

private val RemoteTypography = Typography(
    headlineLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.SemiBold),
    headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold),
    headlineSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 13.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 12.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 12.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
)

private val RemoteShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(16.dp),
)

@Composable
internal fun OmpSheetDragHandle() {
    Box(Modifier.fillMaxWidth().height(20.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(32.dp, 4.dp).background(OmpColors.Border, RoundedCornerShape(2.dp)))
    }
}

/**
 * Non-swipe modal sheet: native [Dialog] + bottom-aligned [Surface].
 *
 * Replaces Material3 [androidx.compose.material3.ModalBottomSheet] for scrollable
 * sheets so nested-scroll overscroll cannot dismiss, while system Back / outside
 * dismiss use standard [Dialog] [onDismissRequest] (no custom Back plumbing).
 *
 * The dialog window owns Back and system/IME insets. Compact sheets wrap their
 * content; full-height sheets give weighted scroll content the remaining space.
 */
@Composable
fun OmpModalSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    fullHeight: Boolean = false,
    containerColor: Color = OmpColors.Bg,
    contentColor: Color = OmpColors.Text,
    dragHandle: @Composable (() -> Unit)? = { OmpSheetDragHandle() },
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = true,
            dismissOnBackPress = true,
            dismissOnClickOutside = false,
        ),
    ) {
        OmpDialogSystemBars()
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val sheetHeight = maxHeight * 0.94f
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.32f))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onDismissRequest,
                    ),
            )
            Surface(
                modifier = modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .then(if (fullHeight) Modifier.height(sheetHeight) else Modifier.heightIn(max = sheetHeight)),
                shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
                color = containerColor,
                contentColor = contentColor,
                tonalElevation = 0.dp,
                shadowElevation = 6.dp,
            ) {
                Column(Modifier.fillMaxWidth()) {
                    dragHandle?.invoke()
                    content()
                }
            }
        }
    }
}

/** Sheets and dialogs own separate windows; changing the activity window is insufficient. */
@Composable
internal fun OmpDialogSystemBars() {
    val view = LocalView.current
    val dark = OmpColors.dark
    SideEffect {
        var parent = view.parent
        var window = (view as? DialogWindowProvider)?.window
        while (window == null && parent != null) {
            window = (parent as? DialogWindowProvider)?.window
            parent = parent.parent
        }
        window?.let {
            val controller = WindowCompat.getInsetsController(it, view)
            controller.isAppearanceLightStatusBars = !dark
            controller.isAppearanceLightNavigationBars = !dark
        }
    }
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
        secondary = OmpColors.AccentStrong, onSecondary = Color.White,
        secondaryContainer = OmpColors.BgSelected, onSecondaryContainer = OmpColors.Text,
        tertiary = OmpColors.AccentStrong, onTertiary = Color.White,
        tertiaryContainer = OmpColors.BgSelected, onTertiaryContainer = OmpColors.Text,
        background = OmpColors.Bg, onBackground = OmpColors.Text,
        surface = OmpColors.BgPanel, onSurface = OmpColors.Text,
        surfaceVariant = OmpColors.BgHover, onSurfaceVariant = OmpColors.TextMuted,
        surfaceTint = Color.Transparent,
        outline = OmpColors.TextDim, outlineVariant = OmpColors.Border,
        error = OmpColors.StatusError, onError = OmpColors.Bg,
        errorContainer = lerp(OmpColors.Bg, OmpColors.StatusError, 0.12f), onErrorContainer = OmpColors.Text,
        inverseSurface = OmpColors.Text, inverseOnSurface = OmpColors.Bg,
        inversePrimary = OmpColors.Bg,
        surfaceBright = OmpColors.BgHover, surfaceDim = OmpColors.Bg,
        surfaceContainerLowest = OmpColors.Bg,
        surfaceContainerLow = OmpColors.BgPanel,
        surfaceContainer = OmpColors.BgHover,
        surfaceContainerHigh = OmpColors.BgHover,
        surfaceContainerHighest = OmpColors.BgSelected,
    )
    MaterialTheme(colorScheme = scheme, typography = RemoteTypography, shapes = RemoteShapes, content = content)
}
