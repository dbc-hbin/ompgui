package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.dbchbin.ompgui.remote.R

/** Material 3 "Expanded" width class lower bound. */
internal val AdaptiveTwoPaneMinWidth = 840.dp
private val AdaptiveListPaneWidth = 360.dp

/**
 * List-detail layout. Compact widths show one pane ([detailOpen] picks which); expanded widths
 * ([twoPane]) show both. The list and detail keep the same composition slot in both modes, so
 * folding/unfolding or resizing a window preserves their remembered state (scroll, search,
 * selection, composer). In two-pane mode each pane applies its own safe-drawing padding, so the
 * inner edges consume the opposite-side insets: the list never pads for a right-hand cutout/nav
 * bar and the detail never pads for a left-hand one.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AdaptiveListDetail(
    twoPane: Boolean,
    detailOpen: Boolean,
    list: @Composable () -> Unit,
    detail: @Composable () -> Unit,
) {
    // The compact detail view removes the list from composition; keep its saveable state
    // (search, filters, pins) so returning or unfolding restores it.
    val saveableState = rememberSaveableStateHolder()
    Row(Modifier.fillMaxSize().background(OmpColors.Bg)) {
        if (twoPane || !detailOpen) {
            Box(
                if (twoPane) {
                    Modifier
                        .width(AdaptiveListPaneWidth)
                        .fillMaxHeight()
                        .consumeWindowInsets(WindowInsets.safeDrawing.only(WindowInsetsSides.End))
                } else {
                    Modifier.weight(1f).fillMaxHeight()
                },
            ) { saveableState.SaveableStateProvider("list") { list() } }
        }
        if (twoPane) VerticalDivider(color = OmpColors.Border)
        if (twoPane || detailOpen) {
            Box(
                if (twoPane) {
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .consumeWindowInsets(WindowInsets.safeDrawing.only(WindowInsetsSides.Start))
                } else {
                    Modifier.weight(1f).fillMaxHeight()
                },
            ) { detail() }
        }
    }
}

@Composable
internal fun AdaptiveEmptyDetail() {
    Column(
        Modifier.fillMaxSize().background(OmpColors.Bg).safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.adaptive_select_session_title),
            style = MaterialTheme.typography.titleMedium,
            color = OmpColors.Text,
            textAlign = TextAlign.Center,
        )
        Text(
            stringResource(R.string.adaptive_select_session_hint),
            style = MaterialTheme.typography.bodyMedium,
            color = OmpColors.TextMuted,
            textAlign = TextAlign.Center,
        )
    }
}
