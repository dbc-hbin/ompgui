package com.dbchbin.ompgui.remote.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.dbchbin.ompgui.remote.relay.RelayRequester
import com.dbchbin.ompgui.remote.relay.createCachedDownload
import com.dbchbin.ompgui.remote.relay.openFilePreview
import com.dbchbin.ompgui.remote.relay.shareFile
import com.dbchbin.ompgui.remote.relay.uploadLocalFile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun FileBrowserSheet(
    requester: RelayRequester,
    path: String,
    cwd: String = "",
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var directory by remember(path) { mutableStateOf(path.ifBlank { cwd }) }
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
    var reloadConfirm by remember { mutableStateOf(false) }
    var uploadConflict by remember { mutableStateOf(false) }
    var pendingUpload by remember { mutableStateOf<Uri?>(null) }
    var cached by remember { mutableStateOf<Uri?>(null) }
    val dirty = draft != base

    fun runOperation(block: suspend () -> Unit) {
        scope.launch {
            busy = true
            error = null
            notice = null
            try { block() } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message ?: "File operation failed" }
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
        if (mode == "git") notice = if (result.getBoolean("isGitRepository")) result.optString("repositoryRoot") else "Not a Git repository"
    }
    suspend fun loadText(filePath: String) {
        val result = requester.request("files", "read", JSONObject().put("path", filePath))
        draft = result.getString("text")
        base = draft
        revision = result.getString("revision")
        complete = result.getBoolean("complete")
        nextOffset = result.getLong("nextOffset")
        hash = result.optString("contentHash")
    }
    suspend fun download(): Uri {
        val file = checkNotNull(selected)
        val begin = requester.request("files", "downloadBegin", JSONObject().put("path", file.getString("path")))
        val id = begin.getString("transferId")
        return try {
            createCachedDownload(context, begin.getString("name")) { position ->
                requester.request("files", "downloadChunk", JSONObject().put("transferId", id).put("offset", position).put("length", 131072))
            }.also { cached = it }
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
        notice = if (result.optBoolean("skipped")) "Existing file kept" else "Uploaded ${result.optString("name") }"
        loadPage(0)
    }
    val saveDocument = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { target ->
        if (target != null) runOperation {
            val source = checkNotNull(cached) { "Download is no longer available" }
            withContext(Dispatchers.IO) {
                context.contentResolver.openInputStream(source)?.use { input ->
                    context.contentResolver.openOutputStream(target, "wt")?.use { output -> input.copyTo(output, 64 * 1024) }
                        ?: error("Cannot write selected document")
                } ?: error("Cannot read downloaded file")
            }
            notice = "Saved to selected document"
        }
    }
    val chooseUpload = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) upload(uri, "error")
    }
    LaunchedEffect(path, cwd) {
        busy = true
        try { loadPage(0) } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = failure.message } finally { busy = false }
    }

    ModalBottomSheet(onDismissRequest = { if (dirty || busy) discard = true else onDismiss() }, containerColor = OmpColors.BgPanel) {
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 680.dp).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Text("Files", style = MaterialTheme.typography.titleLarge)
                Text(directory, style = MaterialTheme.typography.bodySmall)
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                notice?.let { Text(it) }
            }
            if (selected == null) {
                item {
                    Row {
                        TextButton(enabled = !busy, onClick = { mode = "list"; runOperation { loadPage(0) } }) { Text("Browse") }
                        TextButton(enabled = !busy, onClick = { mode = "git"; runOperation { loadPage(0) } }) { Text("Git") }
                        TextButton(enabled = !busy, onClick = { chooseUpload.launch(arrayOf("*/*")) }) { Text("Upload") }
                    }
                    OutlinedTextField(query, { query = it }, label = { Text("Search files") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                    Row {
                        TextButton(enabled = !busy && query.isNotBlank(), onClick = { mode = "search"; runOperation { loadPage(0) } }) { Text("Search") }
                        TextButton(enabled = !busy && directory != "/", onClick = {
                            directory = directory.trimEnd('/').substringBeforeLast('/', "/").ifBlank { "/" }
                            mode = "list"; runOperation { loadPage(0) }
                        }) { Text("Parent directory") }
                    }
                }
                items(rows) { row ->
                    val filePath = row.optString("path", row.optString("filePath"))
                    TextButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = {
                        runOperation {
                            if (mode == "git") {
                                val result = requester.request("files", "gitDiff", JSONObject().put("cwd", directory).put("path", filePath))
                                patch = if (!result.getBoolean("supported")) "Diff is not supported for this file." else result.optString("patch").ifBlank { "No differences" } +
                                    if (result.optBoolean("truncated")) "\n\nDiff truncated by server; download the file for complete content." else ""
                            } else if (row.optBoolean("dir")) {
                                directory = filePath; mode = "list"; loadPage(0)
                            } else {
                                val meta = requester.request("files", "meta", JSONObject().put("path", filePath))
                                selected = meta; cached = null; complete = false; hash = ""; revision = ""; nextOffset = 0; draft = ""; base = ""
                                if (meta.optString("kind") == "file" && meta.optString("previewKind") == "text") loadText(filePath)
                            }
                        }
                    }) {
                        Text((if (row.optBoolean("dir")) "Directory: " else "") + row.optString("name", filePath) +
                            if (mode == "git") " ${row.optString("status")}" else "")
                    }
                }
                item {
                    Row {
                        TextButton(enabled = !busy && offset > 0, onClick = { runOperation { loadPage((offset - 100).coerceAtLeast(0)) } }) { Text("Previous") }
                        Text("Page ${offset / 100 + 1}", modifier = Modifier.padding(12.dp))
                        TextButton(enabled = !busy && hasMore, onClick = { runOperation { loadPage(offset + 100) } }) { Text("Next") }
                    }
                    if (rows.isEmpty() && !busy) Text("No files")
                    patch?.let { Text(it, fontFamily = FontFamily.Monospace) }
                }
            } else {
                item {
                    val file = checkNotNull(selected)
                    Text(file.optString("name"), style = MaterialTheme.typography.titleMedium)
                    Text("${file.optLong("size")} bytes · ${file.optString("mime", "application/octet-stream")}")
                    FlowRow {
                        TextButton(enabled = !busy, onClick = { if (dirty) discard = true else { selected = null; patch = null } }) { Text("Back") }
                        TextButton(enabled = !busy, onClick = { runOperation { val uri = cached ?: download(); openFilePreview(context, uri, file.optString("mime", "application/octet-stream")) } }) { Text("Open") }
                        TextButton(enabled = !busy, onClick = { runOperation { val uri = cached ?: download(); shareFile(context, uri, file.optString("mime", "application/octet-stream")) } }) { Text("Share") }
                        TextButton(enabled = !busy, onClick = { runOperation { download(); saveDocument.launch(file.optString("name", "download")) } }) { Text("Save as") }
                    }
                    if (file.optString("kind") == "file" && file.optString("previewKind") == "text") {
                        if (!complete || hash.isBlank()) {
                            Text("Read-only preview. Load the complete file before editing.")
                            TextButton(enabled = !busy, onClick = { runOperation {
                                if (revision.isBlank()) loadText(file.getString("path"))
                                val builder = StringBuilder(draft)
                                var position = nextOffset
                                var finished = complete
                                var fullHash = hash
                                while (!finished) {
                                    val part = requester.request("files", "readChunk", JSONObject().put("path", file.getString("path"))
                                        .put("revision", revision).put("offset", position).put("length", 98304))
                                    val next = part.getLong("nextOffset")
                                    require(next > position || part.getBoolean("complete")) { "Text read made no progress" }
                                    builder.append(part.getString("text"))
                                    position = next
                                    finished = part.getBoolean("complete")
                                    if (finished) fullHash = part.getString("contentHash")
                                }
                                require(fullHash.isNotBlank()) { "Server did not supply a complete content hash" }
                                draft = builder.toString(); base = draft
                                nextOffset = position; complete = finished; hash = fullHash
                            } }) { Text("Load complete text") }
                        }
                        OutlinedTextField(draft, { draft = it }, readOnly = !complete || hash.isBlank() || busy,
                            label = { Text(if (complete) "File contents" else "Read-only preview") },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 380.dp))
                        Button(enabled = !busy && complete && hash.isNotBlank() && revision.isNotBlank() && dirty, onClick = { runOperation {
                            val result = requester.request("files", "write", JSONObject().put("path", file.getString("path"))
                                .put("text", draft).put("revision", revision).put("baseContentHash", hash))
                            base = draft
                            // A successful write invalidates the old base. Fetch the committed revision before enabling another save.
                            revision = ""; hash = ""; complete = false
                            loadText(result.optString("path", file.getString("path")))
                            cached = null; notice = "Saved"
                        } }) { Text("Save changes") }
                        Row {
                            TextButton(enabled = !busy, onClick = {
                                val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                                clipboard.setPrimaryClip(android.content.ClipData.newPlainText(file.optString("name"), draft))
                                notice = "Draft copied"
                            }) { Text("Copy draft") }
                            TextButton(enabled = !busy, onClick = { if (dirty) reloadConfirm = true else runOperation { loadText(file.getString("path")) } }) { Text("Reload server file") }
                        }
                        Text("Conflicts reject the save and keep your draft. Copy the draft before reloading a changed server file.", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            item { Spacer(Modifier.height(28.dp)) }
        }
    }
    if (discard) AlertDialog(onDismissRequest = { discard = false }, title = { Text(if (busy) "Operation in progress" else "Discard unsaved changes?") },
        text = { Text(if (busy) "Wait for the current operation before leaving." else "Your unsaved text will be lost.") },
        confirmButton = { TextButton(onClick = { discard = false; if (!busy) { if (selected != null) { selected = null; draft = base } else onDismiss() } }) { Text(if (busy) "Keep open" else "Discard") } },
        dismissButton = { if (!busy) TextButton(onClick = { discard = false }) { Text("Keep editing") } })
    if (reloadConfirm) AlertDialog(onDismissRequest = { reloadConfirm = false },
        title = { Text("Replace draft with server contents?") }, text = { Text("This discards your unsaved changes. Copy your draft first if you want to keep it.") },
        confirmButton = { TextButton(onClick = { reloadConfirm = false; runOperation { loadText(checkNotNull(selected).getString("path")) } }) { Text("Discard and reload") } },
        dismissButton = { TextButton(onClick = { reloadConfirm = false }) { Text("Keep draft") } })
    if (pendingUpload != null && uploadConflict && !busy && error != null) AlertDialog(onDismissRequest = { pendingUpload = null },
        title = { Text("Upload failed") }, text = { Text("${error}\nIf the destination already exists, explicitly choose whether to replace it or keep it.") },
        confirmButton = { TextButton(onClick = { pendingUpload?.let { upload(it, "overwrite") } }) { Text("Replace existing") } },
        dismissButton = { Row { TextButton(onClick = { pendingUpload?.let { upload(it, "skip") } }) { Text("Keep existing") }; TextButton(onClick = { pendingUpload = null }) { Text("Cancel") } } })
}
