package com.dbchbin.ompgui.remote.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Download
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.relay.RelayRequester
import com.dbchbin.ompgui.remote.relay.createCachedDownload
import com.dbchbin.ompgui.remote.relay.openFilePreview
import com.dbchbin.ompgui.remote.relay.shareFile
import com.dbchbin.ompgui.remote.relay.uploadLocalFile
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun FileBrowserSheet(
    requester: RelayRequester,
    path: String,
    cwd: String = "",
    initialGit: Boolean = false,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var initialTarget by remember { mutableStateOf(path to cwd) }
    var pendingTarget by remember { mutableStateOf<Pair<String, String>?>(null) }
    var operation by remember { mutableStateOf<Job?>(null) }
    var directory by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf(emptyList<JSONObject>()) }
    var mode by remember { mutableStateOf("list") }
    var query by remember { mutableStateOf("") }
    var offset by remember { mutableIntStateOf(0) }
    var hasMore by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<JSONObject?>(null) }
    var draft by remember { mutableStateOf("") }
    var base by remember { mutableStateOf("") }
    var revision by remember { mutableStateOf("") }
    var hash by remember { mutableStateOf("") }
    var complete by remember { mutableStateOf(false) }
    var nextOffset by remember { mutableLongStateOf(0L) }
    var patch by remember { mutableStateOf<String?>(null) }
    var discard by remember { mutableStateOf(false) }
    var dismissAfterDiscard by remember { mutableStateOf(false) }
    var actionsExpanded by remember { mutableStateOf(false) }
    var reloadConfirm by remember { mutableStateOf(false) }
    var uploadConflict by remember { mutableStateOf(false) }
    var pendingUpload by remember { mutableStateOf<Uri?>(null) }
    var cached by remember { mutableStateOf<Uri?>(null) }
    val dirty = draft != base
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var serverNotice by remember { mutableStateOf<String?>(null) }
    var previewMode by remember { mutableStateOf(true) }
    var previewReload by remember { mutableIntStateOf(0) }
    val latestDirty by rememberUpdatedState(dirty)
    val latestBusy by rememberUpdatedState(busy)

    fun runOperation(block: suspend () -> Unit) {
        operation = scope.launch {
            busy = true
            error = null
            notice = null
            try { block() } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message ?: context.getString(R.string.file_browser_op_failed) }
            finally { busy = false }
        }
    }
    suspend fun loadPage(pageOffset: Int) {
        val args = JSONObject().put("offset", pageOffset).put("limit", 100)
        val action = when (mode) {
            "search" -> { args.put("cwd", directory).put("query", query); "search" }
            "git" -> { args.put("cwd", directory); "gitStatus" }
            else -> { args.put("path", directory); "list" }
        }
        val result = requester.request("files", action, args)
        currentCoroutineContext().ensureActive()
        val array = result.optJSONArray(when (mode) { "search" -> "matches"; "git" -> "files"; else -> "entries" })
        rows = if (array == null) emptyList() else List(array.length()) { index ->
            val row = array.getJSONObject(index)
            if (mode == "search") {
                val relative = row.getString("path")
                row.put("name", relative).put("path", if (relative.startsWith('/')) relative else "${directory.trimEnd('/')}/$relative")
                    .put("dir", row.optBoolean("isDir"))
            }
            row
        }
        offset = pageOffset
        hasMore = result.optBoolean("hasMore")
        if (mode == "list") directory = result.optString("path", directory)
        if (mode == "git") notice = if (result.getBoolean("isGitRepository")) result.optString("repositoryRoot") else context.getString(R.string.file_browser_not_git)
    }
    suspend fun loadText(filePath: String) {
        val result = requester.request("files", "read", JSONObject().put("path", filePath))
        currentCoroutineContext().ensureActive()
        draft = result.getString("text")
        base = draft
        revision = result.getString("revision")
        complete = result.getBoolean("complete")
        nextOffset = result.getLong("nextOffset")
        hash = result.optString("contentHash")
        selected = selected?.let { JSONObject(it.toString()).put("revision", revision) }
        cached = null
        serverNotice = null
    }
    suspend fun download(): Uri {
        val file = checkNotNull(selected)
        val begin = requester.request("files", "downloadBegin", JSONObject().put("path", file.getString("path")))
        val id = begin.getString("transferId")
        return try {
            createCachedDownload(context, begin.getString("name")) { position ->
                requester.request("files", "downloadChunk", JSONObject().put("transferId", id).put("offset", position).put("length", 131072))
            }.also {
                currentCoroutineContext().ensureActive()
                check(selected?.optString("path") == file.optString("path")) { context.getString(R.string.file_browser_selection_changed) }
                cached = it
            }
        } finally {
            withContext(NonCancellable) {
                requester.request("files", "downloadClose", JSONObject().put("transferId", id))
            }
        }
    }
    fun upload(uri: Uri, conflict: String) = runOperation {
        pendingUpload = uri
        uploadConflict = false
        val result = try {
            uploadLocalFile(context, requester, uri, directory, conflict)
        } catch (failure: com.dbchbin.ompgui.remote.relay.RelayRequestException) {
            uploadConflict = failure.code == "upload_conflict"
            throw failure
        }
        pendingUpload = null
        notice = if (result.optBoolean("skipped")) context.getString(R.string.file_browser_existing_kept) else context.getString(R.string.file_browser_uploaded, result.optString("name"))
        loadPage(0)
    }
    val saveDocument = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { target ->
        if (target != null) runOperation {
            val source = checkNotNull(cached) { context.getString(R.string.file_browser_download_unavailable) }
            withContext(Dispatchers.IO) {
                context.contentResolver.openInputStream(source)?.use { input ->
                    context.contentResolver.openOutputStream(target, "wt")?.use { output -> input.copyTo(output, 64 * 1024) }
                        ?: error(context.getString(R.string.file_browser_cannot_write))
                } ?: error(context.getString(R.string.file_browser_cannot_read_download))
            }
            notice = context.getString(R.string.file_browser_saved_document)
        }
    }
    val chooseUpload = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) upload(uri, "error")
    }
    LaunchedEffect(path, cwd) {
        val requested = path to cwd
        if (requested == initialTarget) pendingTarget = null
        else if (dirty || operation?.isActive == true) pendingTarget = requested
        else {
            pendingTarget = null
            initialTarget = requested
        }
    }
    LaunchedEffect(initialTarget, requester) {
        operation?.cancel()
        operation?.join()
        busy = true
        error = null; notice = null
        selected = null; rows = emptyList(); patch = null; cached = null
        serverNotice = null; previewMode = true
        draft = ""; base = ""; revision = ""; hash = ""; complete = false; nextOffset = 0
        mode = if (initialGit) "git" else "list"; query = ""; offset = 0; hasMore = false
        reloadConfirm = false; uploadConflict = false; pendingUpload = null
        directory = ""
        try {
            val (requestedPath, requestedCwd) = initialTarget
            val target = when {
                requestedPath.isBlank() -> requestedCwd
                requestedPath.startsWith('/') -> requestedPath
                else -> {
                    require(requestedCwd.startsWith('/')) { context.getString(R.string.file_browser_absolute_required_relative) }
                    "${requestedCwd.trimEnd('/')}/$requestedPath"
                }
            }
            if (target.isBlank()) {
                // Keep the relay's allowed-root default when no target was supplied.
                loadPage(0)
            } else {
                require(target.startsWith('/')) { context.getString(R.string.file_browser_absolute_required) }
                val meta = requester.request("files", "meta", JSONObject().put("path", target))
                currentCoroutineContext().ensureActive()
                val canonicalPath = meta.getString("path")
                when (meta.getString("kind")) {
                    "dir" -> { directory = canonicalPath; loadPage(0) }
                    "file" -> {
                        directory = canonicalPath.substringBeforeLast('/', "/").ifBlank { "/" }
                        selected = meta
                        if (meta.optString("previewKind") == "text") loadText(canonicalPath)
                    }
                    else -> error(context.getString(R.string.file_browser_unsupported_type))
                }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: com.dbchbin.ompgui.remote.relay.RelayRequestException) {
            error = "${failure.code}: ${failure.message ?: context.getString(R.string.file_browser_op_failed)}"
        }
        catch (failure: Exception) { error = failure.message ?: context.getString(R.string.file_browser_op_failed) }
        finally { busy = false }
    }

    LaunchedEffect(requester, initialTarget, selected?.optString("path"), lifecycle) {
        val watchedPath = selected?.optString("path") ?: return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay(2_000)
                if (latestBusy) continue
                try {
                    val loadedRevision = selected?.optString("revision").orEmpty()
                    val meta = requester.request("files", "meta", JSONObject().put("path", watchedPath))
                    currentCoroutineContext().ensureActive()
                    if (latestBusy || selected?.optString("path") != watchedPath) continue
                    require(meta.optString("kind") == "file") { context.getString(R.string.file_browser_path_not_file) }
                    val changed = meta.getString("revision") != loadedRevision
                    if (changed && latestDirty) {
                        serverNotice = context.getString(R.string.file_browser_server_changed)
                    } else if (shouldRefreshFile(loadedRevision, meta.getString("revision"), latestDirty)) {
                        val result = if (meta.optString("previewKind") == "text")
                            requester.request("files", "read", JSONObject().put("path", watchedPath)) else null
                        currentCoroutineContext().ensureActive()
                        if (latestDirty || latestBusy || selected?.optString("revision") != loadedRevision) continue
                        if (result != null) {
                            require(result.getString("revision") == meta.getString("revision")) { context.getString(R.string.file_browser_changed_retry) }
                            draft = result.getString("text"); base = draft
                            revision = result.getString("revision"); hash = result.optString("contentHash")
                            complete = result.getBoolean("complete"); nextOffset = result.getLong("nextOffset")
                        } else { draft = ""; base = ""; revision = ""; hash = ""; complete = false }
                        cached = null; selected = meta
                        serverNotice = context.getString(R.string.file_browser_preview_refreshed)
                    } else if (!changed) serverNotice = null
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) {
                    serverNotice = context.getString(R.string.file_browser_server_unavailable, failure.message ?: context.getString(R.string.file_browser_refresh_failed))
                }
            }
        }
    }

    OmpModalSheet(
        onDismissRequest = { if (dirty || busy) { dismissAfterDiscard = true; discard = true } else onDismiss() },
        containerColor = OmpColors.Bg,
    ) {
        OmpDialogSystemBars()
        Column(Modifier.fillMaxWidth().heightIn(max = 740.dp)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                if (selected != null) IconButton(modifier = Modifier.size(48.dp), enabled = !busy, onClick = {
                    if (dirty) { dismissAfterDiscard = false; discard = true }
                    else { selected = null; patch = null; runOperation { loadPage(0) } }
                }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.file_browser_back), tint = OmpColors.TextMuted) }
                Column(Modifier.weight(1f)) {
                    Text(selected?.optString("name") ?: stringResource(R.string.file_browser_title), style = MaterialTheme.typography.titleMedium,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(directory.ifBlank { stringResource(R.string.file_browser_workspace) }, style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace, color = OmpColors.TextMuted,
                        modifier = Modifier.horizontalScroll(rememberScrollState()), maxLines = 1)
                }
                IconButton(modifier = Modifier.size(48.dp), onClick = {
                    if (dirty || busy) { dismissAfterDiscard = true; discard = true } else onDismiss()
                }) { Icon(Icons.Default.Close, stringResource(R.string.file_browser_close), tint = OmpColors.TextMuted) }
            }
            HorizontalDivider(color = OmpColors.Border)
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (selected == null) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.Center) {
                        FilterChip(selected = mode == "list", enabled = !busy, onClick = { mode = "list"; runOperation { loadPage(0) } }, label = { Text(stringResource(R.string.file_browser_browse)) }, modifier = Modifier.heightIn(min = 48.dp))
                        FilterChip(selected = mode == "git", enabled = !busy, onClick = { mode = "git"; runOperation { loadPage(0) } }, label = { Text(stringResource(R.string.file_browser_git)) }, modifier = Modifier.heightIn(min = 48.dp))
                        IconButton(enabled = !busy, onClick = { runOperation { loadPage(0) } }, modifier = Modifier.size(48.dp)) {
                            Icon(Icons.Default.Refresh, stringResource(R.string.file_browser_refresh), Modifier.size(20.dp), tint = OmpColors.TextMuted)
                        }
                        TextButton(enabled = !busy, onClick = { chooseUpload.launch(arrayOf("*/*")) }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.file_browser_upload)) }
                    }
                    OutlinedTextField(query, { query = it }, placeholder = { Text(stringResource(R.string.file_browser_search)) },
                        leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(20.dp)) },
                        trailingIcon = {
                            IconButton(enabled = !busy && query.isNotBlank(), onClick = { mode = "search"; runOperation { loadPage(0) } }) {
                                Icon(Icons.AutoMirrored.Filled.ArrowForward, stringResource(R.string.file_browser_search), Modifier.size(20.dp))
                            }
                        },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = {
                            if (!busy && query.isNotBlank()) { mode = "search"; runOperation { loadPage(0) } }
                        }),
                        modifier = Modifier.fillMaxWidth(), singleLine = true,
                        textStyle = MaterialTheme.typography.bodyLarge)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(enabled = !busy && directory != "/", onClick = {
                            directory = directory.trimEnd('/').substringBeforeLast('/', "/").ifBlank { "/" }
                            mode = "list"; runOperation { loadPage(0) }
                        }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.file_browser_parent))
                        }
                        Text(stringResource(when (mode) { "search" -> R.string.file_browser_search_results; "git" -> R.string.file_browser_changed_files; else -> R.string.file_browser_title }),
                            style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted,
                            modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                HorizontalDivider(color = OmpColors.Border)
            }
        LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            item {
                error?.let { Text(it, color = OmpColors.StatusError, style = MaterialTheme.typography.bodySmall) }
                notice?.let { Text(it, color = OmpColors.TextMuted, style = MaterialTheme.typography.bodySmall) }
            }
            if (selected == null) {
                items(rows) { row ->
                    val filePath = row.optString("path", row.optString("filePath"))
                    TextButton(enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                        colors = ButtonDefaults.textButtonColors(contentColor = OmpColors.Text),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp), onClick = {
                        runOperation {
                            if (mode == "git") {
                                val result = requester.request("files", "gitDiff", JSONObject().put("cwd", directory).put("path", filePath))
                                patch = if (!result.getBoolean("supported")) context.getString(R.string.file_browser_diff_unsupported) else result.optString("patch").ifBlank { context.getString(R.string.file_browser_no_differences) } +
                                    if (result.optBoolean("truncated")) context.getString(R.string.file_browser_diff_truncated) else ""
                            } else if (row.optBoolean("dir")) {
                                directory = filePath; mode = "list"; loadPage(0)
                            } else {
                                val meta = requester.request("files", "meta", JSONObject().put("path", filePath))
                                selected = meta; cached = null; complete = false; hash = ""; revision = ""; nextOffset = 0; draft = ""; base = ""
                                if (meta.optString("kind") == "file" && meta.optString("previewKind") == "text") loadText(meta.getString("path"))
                            }
                        }
                    }) {
                        Icon(if (row.optBoolean("dir")) Icons.Default.Folder else Icons.Default.Description,
                            if (row.optBoolean("dir")) stringResource(R.string.file_browser_folder) else null, Modifier.size(18.dp), tint = OmpColors.TextMuted)
                        Spacer(Modifier.width(10.dp))
                        Text(row.optString("name", filePath), Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Start)
                        if (mode == "git") Text(row.optString("status"), color = OmpColors.StatusWarning, style = MaterialTheme.typography.labelMedium)
                    }
                }
                item {
                    FlowRow(verticalArrangement = Arrangement.Center) {
                        TextButton(enabled = !busy && offset > 0, onClick = { runOperation { loadPage((offset - 100).coerceAtLeast(0)) } }) { Text(stringResource(R.string.file_browser_previous)) }
                        Text(stringResource(R.string.file_browser_page, offset / 100 + 1), modifier = Modifier.padding(12.dp))
                        TextButton(enabled = !busy && hasMore, onClick = { runOperation { loadPage(offset + 100) } }) { Text(stringResource(R.string.file_browser_next)) }
                    }
                    if (rows.isEmpty() && !busy && error == null) Text(stringResource(when (mode) { "search" -> R.string.file_browser_empty_search; "git" -> R.string.file_browser_empty_git; else -> R.string.file_browser_empty }),
                        style = MaterialTheme.typography.bodyLarge, color = OmpColors.TextMuted, modifier = Modifier.padding(vertical = 16.dp))
                    patch?.let { RichPreview(it, RichPreviewKind.Code, Modifier.fillMaxWidth().height(360.dp), language = "diff") }
                }
            } else {
                item {
                    val file = checkNotNull(selected)
                    Text(stringResource(R.string.file_browser_meta, file.optLong("size"), file.optString("mime", "application/octet-stream")),
                        style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted,
                        modifier = Modifier.padding(top = 8.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (file.optString("previewKind") == "text") {
                        Row(Modifier.fillMaxWidth().selectableGroup(), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.weight(1f).heightIn(min = 48.dp)
                                .selectable(previewMode, role = Role.Tab, onClick = { previewMode = true }), contentAlignment = Alignment.Center) {
                                Text(stringResource(R.string.file_browser_preview), style = MaterialTheme.typography.labelLarge,
                                    modifier = Modifier.fillMaxWidth().background(if (previewMode) OmpColors.BgSelected else OmpColors.Bg, MaterialTheme.shapes.small)
                                        .padding(horizontal = 8.dp, vertical = 6.dp), textAlign = TextAlign.Center)
                            }
                            Box(Modifier.weight(1f).heightIn(min = 48.dp)
                                .selectable(!previewMode, role = Role.Tab, onClick = { previewMode = false }), contentAlignment = Alignment.Center) {
                                Text(stringResource(R.string.file_browser_source_edit), style = MaterialTheme.typography.labelLarge,
                                    modifier = Modifier.fillMaxWidth().background(if (!previewMode) OmpColors.BgSelected else OmpColors.Bg, MaterialTheme.shapes.small)
                                        .padding(horizontal = 8.dp, vertical = 6.dp), textAlign = TextAlign.Center)
                            }
                        }
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                        if (file.optString("previewKind") != "text") {
                            Text(stringResource(R.string.file_browser_preview), style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                        }
                        IconButton(modifier = Modifier.size(48.dp), enabled = !busy, onClick = {
                            if (dirty) reloadConfirm = true else runOperation {
                                val meta = requester.request("files", "meta", JSONObject().put("path", file.getString("path")))
                                if (meta.optString("previewKind") == "text") loadText(meta.getString("path"))
                                cached = null; selected = meta; serverNotice = null; previewReload++
                            }
                        }) { Icon(Icons.Default.Refresh, stringResource(R.string.file_browser_reload_preview), tint = OmpColors.TextMuted) }
                        IconButton(modifier = Modifier.size(48.dp), enabled = !busy, onClick = {
                            runOperation { cached ?: download(); saveDocument.launch(file.optString("name", "download")) }
                        }) { Icon(Icons.Default.Download, stringResource(R.string.file_browser_download), Modifier.size(20.dp), tint = OmpColors.TextMuted) }
                        Box {
                            IconButton(modifier = Modifier.size(48.dp), enabled = !busy, onClick = { actionsExpanded = true }) {
                                Icon(Icons.Default.MoreVert, stringResource(R.string.file_browser_actions), tint = OmpColors.TextMuted)
                            }
                            DropdownMenu(expanded = actionsExpanded, onDismissRequest = { actionsExpanded = false }) {
                                DropdownMenuItem(text = { Text(stringResource(R.string.file_browser_open_external)) }, onClick = { actionsExpanded = false; runOperation { val uri = cached ?: download(); openFilePreview(context, uri, file.optString("mime", "application/octet-stream")) } })
                                DropdownMenuItem(text = { Text(stringResource(R.string.file_browser_share)) }, onClick = { actionsExpanded = false; runOperation { val uri = cached ?: download(); shareFile(context, uri, file.optString("mime", "application/octet-stream")) } })
                            }
                        }
                    }
                    if (dirty) Text(stringResource(R.string.file_browser_unsaved), style = MaterialTheme.typography.labelMedium, color = OmpColors.StatusWarning)
                    serverNotice?.let { Text(it, color = OmpColors.TextMuted, style = MaterialTheme.typography.bodySmall) }
                    if (previewMode) {
                        if (file.optString("previewKind") == "text" && !complete) {
                            Text(stringResource(R.string.file_browser_partial_preview), style = MaterialTheme.typography.bodySmall)
                        }
                        key(file.getString("path"), file.optString("revision"), previewReload) {
                            CompositionLocalProvider(LocalMarkdownNavigation provides MarkdownNavigation(directory) { linkedPath ->
                                val target = linkedPath to directory
                                if (dirty || busy) pendingTarget = target else initialTarget = target
                            }) {
                                FileContentPreview(requester, file, draft, cached, { cached = it })
                            }
                        }
                    }
                    if (!previewMode && file.optString("kind") == "file" && file.optString("previewKind") == "text") {
                        if (!complete || hash.isBlank()) {
                            Text(stringResource(R.string.file_browser_readonly_hint))
                            TextButton(enabled = !busy, onClick = { runOperation {
                                if (revision.isBlank()) loadText(file.getString("path"))
                                val builder = StringBuilder(draft)
                                var position = nextOffset
                                var finished = complete
                                var fullHash = hash
                                while (!finished) {
                                    val part = requester.request("files", "readChunk", JSONObject().put("path", file.getString("path"))
                                        .put("revision", revision).put("offset", position).put("length", 98304))
                                    currentCoroutineContext().ensureActive()
                                    val next = part.getLong("nextOffset")
                                    require(next > position || part.getBoolean("complete")) { context.getString(R.string.file_browser_text_no_progress) }
                                    builder.append(part.getString("text"))
                                    position = next
                                    finished = part.getBoolean("complete")
                                    if (finished) fullHash = part.getString("contentHash")
                                }
                                require(fullHash.isNotBlank()) { context.getString(R.string.file_browser_no_content_hash) }
                                draft = builder.toString(); base = draft
                                nextOffset = position; complete = finished; hash = fullHash
                            } }) { Text(stringResource(R.string.file_browser_load_complete)) }
                        }
                        OutlinedTextField(draft, { draft = it }, readOnly = !complete || hash.isBlank() || busy,
                            label = { Text(stringResource(if (complete) R.string.file_browser_contents else R.string.file_browser_readonly_label)) },
                            textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace, lineHeight = MaterialTheme.typography.bodyLarge.fontSize * 1.6f),
                            modifier = Modifier.fillMaxWidth().heightIn(min = 280.dp, max = 420.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.Center) {
                        Button(shape = MaterialTheme.shapes.small, modifier = Modifier.heightIn(min = 48.dp), enabled = !busy && complete && hash.isNotBlank() && revision.isNotBlank() && dirty, onClick = { runOperation {
                            val result = requester.request("files", "write", JSONObject().put("path", file.getString("path"))
                                .put("text", draft).put("revision", revision).put("baseContentHash", hash))
                            base = draft
                            // A successful write invalidates the old base. Fetch the committed revision before enabling another save.
                            revision = ""; hash = ""; complete = false
                            loadText(result.optString("path", file.getString("path")))
                            cached = null; notice = context.getString(R.string.file_browser_saved)
                        } }) { Text(stringResource(R.string.file_browser_save)) }
                            TextButton(modifier = Modifier.heightIn(min = 48.dp), enabled = !busy, onClick = {
                                val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                                clipboard.setPrimaryClip(android.content.ClipData.newPlainText(file.optString("name"), draft))
                                notice = context.getString(R.string.file_browser_draft_copied)
                            }) { Text(stringResource(R.string.file_browser_copy_draft)) }
                            TextButton(modifier = Modifier.heightIn(min = 48.dp), enabled = !busy, onClick = { if (dirty) reloadConfirm = true else runOperation { loadText(file.getString("path")) } }) { Text(stringResource(R.string.file_browser_reload_server)) }
                        }
                        Text(stringResource(R.string.file_browser_conflicts_hint), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
        }
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { OmpDialogSystemBars(); Text(stringResource(if (busy) R.string.file_browser_op_in_progress else R.string.file_browser_discard_title)) },
        text = { Text(stringResource(if (busy) R.string.file_browser_wait_leaving else R.string.file_browser_discard_message)) },
        confirmButton = { TextButton(onClick = { discard = false; if (!busy) { if (dismissAfterDiscard) onDismiss() else if (selected != null) { selected = null; draft = base; patch = null; runOperation { loadPage(0) } } else onDismiss() } }) { Text(stringResource(if (busy) R.string.file_browser_keep_open else R.string.file_browser_discard)) } },
        dismissButton = { if (!busy) TextButton(onClick = { discard = false }) { Text(stringResource(R.string.file_browser_keep_editing)) } })
    pendingTarget?.let { target ->
        AlertDialog(onDismissRequest = { pendingTarget = null },
            title = { OmpDialogSystemBars(); Text(stringResource(R.string.file_browser_open_other_title)) },
            text = {
                val location = target.first.ifBlank { target.second }
                Text(when {
                    busy -> stringResource(R.string.file_browser_wait_open)
                    dirty -> stringResource(R.string.file_browser_open_discard, location)
                    else -> stringResource(R.string.file_browser_open_confirm, location)
                })
            },
            confirmButton = { TextButton(enabled = !busy, onClick = {
                pendingTarget = null
                initialTarget = target
            }) { Text(stringResource(if (dirty) R.string.file_browser_discard_and_open else R.string.file_browser_open)) } },
            dismissButton = { TextButton(onClick = { pendingTarget = null }) { Text(stringResource(R.string.file_browser_keep_current)) } })
    }
    if (reloadConfirm) AlertDialog(onDismissRequest = { reloadConfirm = false },
        title = { OmpDialogSystemBars(); Text(stringResource(R.string.file_browser_replace_draft_title)) }, text = { Text(stringResource(R.string.file_browser_replace_draft_message)) },
        confirmButton = { TextButton(colors = ButtonDefaults.textButtonColors(contentColor = OmpColors.StatusError), onClick = { reloadConfirm = false; runOperation { loadText(checkNotNull(selected).getString("path")) } }) { Text(stringResource(R.string.file_browser_discard_and_reload)) } },
        dismissButton = { TextButton(onClick = { reloadConfirm = false }) { Text(stringResource(R.string.file_browser_keep_draft)) } })
    if (pendingUpload != null && uploadConflict && !busy && error != null) AlertDialog(onDismissRequest = { pendingUpload = null },
        title = { OmpDialogSystemBars(); Text(stringResource(R.string.file_browser_upload_failed)) }, text = { Text(stringResource(R.string.file_browser_upload_conflict, error.orEmpty())) },
        confirmButton = { TextButton(colors = ButtonDefaults.textButtonColors(contentColor = OmpColors.StatusError), onClick = { pendingUpload?.let { upload(it, "overwrite") } }) { Text(stringResource(R.string.file_browser_replace_existing)) } },
        dismissButton = { FlowRow { TextButton(onClick = { pendingUpload?.let { upload(it, "skip") } }) { Text(stringResource(R.string.file_browser_keep_existing)) }; TextButton(onClick = { pendingUpload = null }) { Text(stringResource(R.string.file_browser_cancel)) } } })
}
