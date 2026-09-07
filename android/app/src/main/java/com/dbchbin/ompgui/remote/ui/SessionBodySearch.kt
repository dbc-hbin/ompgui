package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.relay.BodySearchContext
import com.dbchbin.ompgui.remote.relay.BodySearchMatch
import com.dbchbin.ompgui.remote.relay.BodySearchPage
import com.dbchbin.ompgui.remote.relay.RelayRequester
import com.dbchbin.ompgui.remote.relay.loadSessionSearchContext
import com.dbchbin.ompgui.remote.relay.searchSessionBodies
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch

@Composable
internal fun SessionBodySearch(
    requester: RelayRequester,
    query: String,
    projectRoot: String?,
    onReset: () -> Unit,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val retryLabel = stringResource(R.string.extension_mcp_guide_disconnected)
    var from by rememberSaveable { mutableStateOf("") }
    var to by rememberSaveable { mutableStateOf("") }
    // A new identity immediately hides the previous query's results, even before effects run.
    val generation = remember(query, projectRoot, from, to, requester) { Any() }
    val currentGeneration by rememberUpdatedState(generation)
    var page by remember(generation) { mutableStateOf<BodySearchPage?>(null) }
    var loading by remember(generation) { mutableStateOf(false) }
    var error by remember(generation) { mutableStateOf<String?>(null) }
    var retry by remember(generation) { mutableStateOf(0) }
    var selected by remember(generation) { mutableStateOf<BodySearchMatch?>(null) }
    val scope = rememberCoroutineScope()
    var pagingJob by remember(generation) { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    DisposableEffect(generation) { onDispose { pagingJob?.cancel() } }
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(generation, retry) {
        if (query.isBlank()) return@LaunchedEffect
        loading = true
        error = null
        try {
            delay(300)
            val result = searchSessionBodies(requester, query, projectRoot, from.ifBlank { null }, to.ifBlank { null }, null)
            currentCoroutineContext().ensureActive()
            if (currentGeneration === generation) page = result
        } catch (_: CancellationException) {
            currentCoroutineContext().ensureActive()
            if (currentGeneration === generation) error = retryLabel
        } catch (e: Exception) {
            if (currentGeneration === generation) error = e.message ?: e.javaClass.simpleName
        } finally {
            if (currentGeneration === generation) loading = false
        }
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(from, { from = it }, Modifier.weight(1f), singleLine = true,
                label = { Text(stringResource(R.string.body_search_from)) }, textStyle = TextStyle(fontSize = 16.sp))
            OutlinedTextField(to, { to = it }, Modifier.weight(1f), singleLine = true,
                label = { Text(stringResource(R.string.body_search_to)) }, textStyle = TextStyle(fontSize = 16.sp))
        }
        Text(stringResource(R.string.body_search_dates), color = OmpColors.TextMuted, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp))
        TextButton(onClick = { from = ""; to = ""; onReset() }, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(stringResource(R.string.body_search_reset))
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (query.isBlank()) item { Text(stringResource(R.string.body_search_prompt), Modifier.padding(16.dp), color = OmpColors.TextMuted) }
            items(page?.matches.orEmpty(), key = { "${it.sessionId}:${it.entryId}" }) { match ->
                Column(Modifier.fillMaxWidth().clickable {
                    focus.clearFocus(); keyboard?.hide(); selected = match
                }.heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(match.sessionName.ifBlank { match.sessionId }, color = OmpColors.Text, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                    Text(match.cwd, color = OmpColors.TextDim, fontSize = 12.sp)
                    Text("${match.role} · ${match.timestamp}", color = OmpColors.TextMuted, fontSize = 12.sp)
                    Text(match.snippet, color = OmpColors.Text, fontSize = 14.sp)
                }
            }
            if (loading) item { Text(stringResource(R.string.body_search_loading), Modifier.padding(16.dp), color = OmpColors.TextMuted) }
            if (!loading && error == null && page?.matches?.isEmpty() == true) item {
                Text(stringResource(R.string.body_search_empty), Modifier.padding(16.dp), color = OmpColors.TextMuted)
            }
            error?.let { message -> item {
                Text(message, Modifier.padding(horizontal = 16.dp), color = OmpColors.StatusError)
                TextButton(onClick = { retry++ }, enabled = !loading, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.body_search_retry)) }
            } }
            page?.nextCursor?.let { cursor -> item {
                TextButton(enabled = !loading, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), onClick = {
                    loading = true
                    error = null
                    pagingJob = scope.launch {
                        try {
                            val result = searchSessionBodies(requester, query, projectRoot, from.ifBlank { null }, to.ifBlank { null }, cursor)
                            currentCoroutineContext().ensureActive()
                            if (currentGeneration === generation) page = result.copy(matches = (page?.matches.orEmpty() + result.matches).distinctBy { it.sessionId to it.entryId })
                        } catch (_: CancellationException) {
                            currentCoroutineContext().ensureActive()
                            if (currentGeneration === generation) error = retryLabel
                        }
                        catch (e: Exception) { if (currentGeneration === generation) error = e.message ?: e.javaClass.simpleName }
                        finally { if (currentGeneration === generation) loading = false }
                    }
                }) { Text(stringResource(R.string.body_search_more)) }
            } }
        }
    }
    selected?.let { match ->
        BodySearchContextSheet(requester, match, onDismiss = { selected = null }, onOpen = { selected = null; onOpen(match.sessionId) })
    }
}

@Composable
private fun BodySearchContextSheet(requester: RelayRequester, match: BodySearchMatch, onDismiss: () -> Unit, onOpen: () -> Unit) {
    val retryLabel = stringResource(R.string.extension_mcp_guide_disconnected)
    var context by remember(match) { mutableStateOf<BodySearchContext?>(null) }
    var error by remember(match) { mutableStateOf<String?>(null) }
    var retry by remember(match) { mutableStateOf(0) }
    val listState = rememberLazyListState()
    LaunchedEffect(requester, match, retry) {
        error = null
        try {
            val result = loadSessionSearchContext(requester, match.sessionId, match.entryId)
            currentCoroutineContext().ensureActive()
            context = result
        } catch (_: CancellationException) {
            currentCoroutineContext().ensureActive()
            error = retryLabel
        }
        catch (e: Exception) { error = e.message ?: e.javaClass.simpleName }
    }
    LaunchedEffect(context) { context?.let { listState.scrollToItem(it.matchIndex + 1) } }
    OmpModalSheet(onDismissRequest = onDismiss, fullHeight = true) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.body_search_back)) }
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.body_search_close)) }
        }
        Text(stringResource(R.string.body_search_preview), Modifier.padding(horizontal = 16.dp), color = OmpColors.Accent, fontWeight = FontWeight.SemiBold)
        Text(match.sessionName.ifBlank { match.sessionId }, Modifier.padding(16.dp), color = OmpColors.Text, fontSize = 16.sp)
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                if (context == null && error == null) Text(stringResource(R.string.body_search_loading), Modifier.padding(16.dp))
                error?.let { Text(it, Modifier.padding(16.dp), color = OmpColors.StatusError) }
                if (error != null) TextButton(onClick = { retry++ }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.body_search_retry)) }
                if (context?.let { it.hasMoreBefore || it.hasMoreAfter } == true) Text(stringResource(R.string.body_search_context_bound), Modifier.padding(16.dp), color = OmpColors.TextMuted)
            }
            itemsIndexed(context?.messages.orEmpty(), key = { _, message -> message.entryId }) { index, message ->
                val matched = index == context?.matchIndex
                Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)
                    .background(if (matched) OmpColors.BgHover else OmpColors.Bg)
                    .then(if (matched) Modifier.border(1.dp, OmpColors.Accent, RoundedCornerShape(8.dp)) else Modifier)
                    .padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (matched) Text(stringResource(R.string.body_search_match), color = OmpColors.Accent, fontWeight = FontWeight.Bold)
                    Text("${message.role} · ${message.timestamp}", color = OmpColors.TextMuted, fontSize = 12.sp)
                    MessageText(message.content)
                }
            }
        }
        TextButton(onClick = onOpen, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(stringResource(R.string.body_search_open)) }
    }
}
