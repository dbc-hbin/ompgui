package com.dbchbin.ompgui.remote.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.net.ConnectionState
import com.dbchbin.ompgui.remote.relay.AttachedImage
import com.dbchbin.ompgui.remote.relay.DisplayMessage
import com.dbchbin.ompgui.remote.relay.ModelRef
import com.dbchbin.ompgui.remote.relay.RelayBranch
import com.dbchbin.ompgui.remote.relay.RelaySlashCommand
import com.dbchbin.ompgui.remote.relay.SubagentChip
import com.dbchbin.ompgui.remote.relay.TodoPhase
import com.dbchbin.ompgui.remote.relay.RelayModelOption
import com.dbchbin.ompgui.remote.relay.RelayRequester
import com.dbchbin.ompgui.remote.relay.TodoItem
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** A file or photo attached to the composer, staged before send. */
data class AttachmentItem(
    val name: String,
    val isImage: Boolean,
    val mimeType: String,
    val sizeBytes: Long,
    val base64Data: String? = null,
    val textContent: String? = null,
    val bitmap: ImageBitmap? = null,
)

private const val MAX_ATTACHMENTS = 10
private const val MAX_IMAGE_BYTES = 4 * 1024 * 1024
private const val MAX_TEXT_BYTES = 128 * 1024
private val THINKING_LEVELS = listOf("auto", "minimal", "low", "medium", "high", "xhigh", "max")

private fun guessMimeType(name: String): String {
    return when (name.substringAfterLast('.', "").lowercase(Locale.US)) {
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "gif" -> "image/gif"
        "webp" -> "image/webp"
        "bmp" -> "image/bmp"
        "heic" -> "image/heic"
        "heif" -> "image/heif"
        "txt", "md", "markdown" -> "text/plain"
        "json" -> "application/json"
        "xml" -> "application/xml"
        "html", "htm" -> "text/html"
        "css" -> "text/css"
        "csv" -> "text/csv"
        "kt", "kts", "java", "js", "mjs", "ts", "tsx", "py", "rb", "go", "rs",
        "c", "h", "cpp", "hpp", "cs", "swift", "sh", "yaml", "yml", "toml",
        "gradle", "properties", "sql", "graphql", "diff", "patch" -> "text/plain"
        else -> "application/octet-stream"
    }
}

private fun isTextish(mimeType: String, name: String): Boolean {
    if (mimeType.startsWith("text/")) return true
    if (mimeType in setOf("application/json", "application/xml", "application/javascript")) return true
    val ext = name.substringAfterLast('.', "").lowercase(Locale.US)
    return ext in setOf(
        "txt", "md", "markdown", "kt", "kts", "java", "js", "mjs", "ts", "tsx",
        "py", "rb", "go", "rs", "c", "h", "cpp", "hpp", "cs", "swift", "sh",
        "yaml", "yml", "toml", "gradle", "properties", "sql", "graphql",
        "diff", "patch", "json", "xml", "html", "htm", "css", "csv", "log",
    )
}

private fun readBounded(resolver: android.content.ContentResolver, uri: Uri, max: Int): ByteArray? {
    return try {
        resolver.openInputStream(uri)?.use { stream ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8 * 1024)
            var total = 0
            while (total < max) {
                val n = stream.read(buf, 0, minOf(buf.size, max - total))
                if (n == -1) break
                if (n == 0) continue
                out.write(buf, 0, n)
                total += n
            }
            if (stream.read() != -1) return null
            out.toByteArray()
        }
    } catch (_: Exception) {
        null
    }
}

private fun compressImageForRelay(resolver: android.content.ContentResolver, uri: Uri): Pair<ByteArray, String>? {
    return try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / sample > 1280 || bounds.outHeight / sample > 1280) {
            sample *= 2
        }
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val bitmap = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null
        try {
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 80, out)
            Pair(out.toByteArray(), "image/jpeg")
        } finally {
            bitmap.recycle()
        }
    } catch (_: Exception) {
        null
    }
}

private fun previewBitmap(bytes: ByteArray): ImageBitmap? {
    return try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (bounds.outWidth / sample > 96 || bounds.outHeight / sample > 96) {
            sample *= 2
        }
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)?.asImageBitmap()
    } catch (_: Exception) {
        null
    }
}

private fun loadAttachment(context: Context, uri: Uri): AttachmentItem? {
    val resolver = context.contentResolver
    var name = "file"
    var size = 0L
    try {
        resolver.query(uri, null, null, null, null)?.use { cursor ->
            val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (cursor.moveToFirst()) {
                if (nameIdx >= 0) cursor.getString(nameIdx)?.takeIf { it.isNotBlank() }?.let { name = it }
                if (sizeIdx >= 0) {
                    try {
                        size = cursor.getLong(sizeIdx)
                    } catch (_: Exception) {
                        size = 0L
                    }
                }
            }
        }
    } catch (_: Exception) {
    }
    val resolved = try {
        resolver.getType(uri)
    } catch (_: Exception) {
        null
    }
    val mime = if (resolved.isNullOrBlank()) guessMimeType(name) else resolved
    val isImage = mime.startsWith("image/")
    return try {
        if (isImage) {
            val (compressedBytes, actualMime) = compressImageForRelay(resolver, uri) ?: return null
            if (compressedBytes.size > MAX_IMAGE_BYTES) return null
            AttachmentItem(
                name = name,
                isImage = true,
                mimeType = actualMime,
                sizeBytes = compressedBytes.size.toLong(),
                base64Data = Base64.encodeToString(compressedBytes, Base64.NO_WRAP),
                bitmap = previewBitmap(compressedBytes),
            )
        } else if (isTextish(mime, name)) {
            val bytes = readBounded(resolver, uri, MAX_TEXT_BYTES) ?: return null
            val text = try {
                bytes.toString(Charsets.UTF_8)
            } catch (_: Exception) {
                return AttachmentItem(
                    name = name,
                    isImage = false,
                    mimeType = mime,
                    sizeBytes = if (size > 0) size else bytes.size.toLong(),
                )
            }
            AttachmentItem(
                name = name,
                isImage = false,
                mimeType = mime,
                sizeBytes = if (size > 0) size else bytes.size.toLong(),
                textContent = text,
            )
        } else {
            null
        }
    } catch (_: Exception) {
        null
    }
}

private fun formatAttachmentSize(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return "${if (kb >= 100) kb.toInt() else String.format(Locale.US, "%.1f", kb)} KB"
    val mb = kb / 1024.0
    return "${if (mb >= 100) mb.toInt() else String.format(Locale.US, "%.1f", mb)} MB"
}

private fun trimFileName(name: String, max: Int = 16): String {
    if (name.length <= max) return name
    return name.take(max) + "…"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    requester: RelayRequester,
    onOpenSession: (String) -> Unit,
    extensionDialogs: List<com.dbchbin.ompgui.remote.relay.EventProjector.ChatExtensionRequest>,
    chatNotices: List<com.dbchbin.ompgui.remote.relay.EventProjector.ChatNotice>,
    extensionStatus: Map<String, String>,
    extensionWidgets: Map<String, List<String>>,
    onDismissExtensionDialog: (String) -> Unit,
    onDismissChatNotice: (String) -> Unit,
    title: String,
    messages: List<DisplayMessage>,
    draft: String,
    running: Boolean,
    connection: ConnectionState,
    error: String?,
    models: List<RelayModelOption>,
    currentModel: ModelRef?,
    pickerOpen: Boolean,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onAbort: () -> Unit,
    onBack: () -> Unit,
    onOpenPicker: () -> Unit,
    onClosePicker: () -> Unit,
    onSelectModel: (RelayModelOption) -> Unit,
    onSendWithAttachments: ((String, List<AttachedImage>) -> Boolean)? = null,
    onOpenUsage: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    thinkingLevel: String = "auto",
    onThinkingLevelChange: (String) -> Unit = {},
    usageFraction: Double? = null,
    slashCommands: List<RelaySlashCommand> = emptyList(),
    todos: List<TodoPhase> = emptyList(),
    subagents: List<SubagentChip> = emptyList(),
    filesPath: String = "",
    sessionId: String = "",
    sessionCwd: String = "",
    branches: List<RelayBranch> = emptyList(),
    branchLeafId: String? = null,
    onSetLeaf: (String, String) -> Unit = { _, _ -> },
    onFetchBranches: (String) -> Unit = {},
    queueSteering: List<String> = emptyList(),
    queueFollowUp: List<String> = emptyList(),
    fastMode: Boolean? = null,
    autoRetry: Boolean? = null,
    interruptMode: String? = null,
    autoCompaction: Boolean? = null,
    steeringMode: String? = null,
    followUpMode: String? = null,
    onOpenPalette: () -> Unit,
) {
    val listState = rememberLazyListState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var attachedFiles by remember { mutableStateOf<List<AttachmentItem>>(emptyList()) }
    var attachWarning by remember { mutableStateOf<String?>(null) }
    var thinkingPickerOpen by remember { mutableStateOf(false) }
    var filesOpen by remember { mutableStateOf(false) }
    var branchesOpen by remember { mutableStateOf(false) }
    var followLocked by remember(sessionId) { mutableStateOf(true) }
    var historicalView by remember(sessionId) { mutableStateOf(false) }
    var commandError by remember(sessionId) { mutableStateOf<String?>(null) }
    var runtimeState by remember(sessionId) { mutableStateOf(JSONObject()) }
    val commandScope = androidx.compose.runtime.key(sessionId) { rememberCoroutineScope() }
    fun execute(command: JSONObject, completed: (JSONObject) -> Unit = {}) {
        commandScope.launch {
            commandError = null
            try {
                val response = com.dbchbin.ompgui.remote.relay.ChatRequests.command(requester, sessionId, command)
                completed(response.optJSONObject("result") ?: response)
                val stateResponse = com.dbchbin.ompgui.remote.relay.ChatRequests.sessionState(requester, sessionId)
                runtimeState = stateResponse.optJSONObject("state") ?: stateResponse
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                commandError = failure.message ?: "Command failed"
            }
        }
    }
    LaunchedEffect(sessionId) {
        attachedFiles = emptyList()
        attachWarning = null
        filesOpen = false
        branchesOpen = false
    }
    LaunchedEffect(sessionId, running) {
        try {
            val response = com.dbchbin.ompgui.remote.relay.ChatRequests.sessionState(requester, sessionId)
            runtimeState = response.optJSONObject("state") ?: response
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            commandError = failure.message ?: "Session state unavailable"
        }
    }
    val korean = remember { Locale.getDefault().language == "ko" }
    val pickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetMultipleContents(),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val loaded = withContext(Dispatchers.IO) {
                uris.mapNotNull { uri -> loadAttachment(context, uri) }
            }
            val remaining = MAX_ATTACHMENTS - attachedFiles.size
            attachWarning = when {
                loaded.size != uris.size -> "Some files could not be attached. Text must be at most 128 KiB; use Files to upload larger or binary files (up to 25 MiB)."
                loaded.size > remaining -> "Only $MAX_ATTACHMENTS attachments are allowed. Extra selections were not attached."
                else -> null
            }
            attachedFiles = attachedFiles + loaded.take(remaining)
        }
    }
    val sendWithComposer: () -> Unit = {
        if (attachedFiles.isEmpty()) {
            onSend()
        } else {
            val textFiles = attachedFiles.filter { it.textContent != null }
            val imageFiles = attachedFiles.filter { it.isImage && it.base64Data != null }
            val inline = textFiles.joinToString("\n\n") { f ->
                "--- file: ${f.name} ---\n${f.textContent}\n--- end file ---"
            }
            val finalText = when {
                draft.isBlank() -> inline
                inline.isBlank() -> draft
                else -> "$draft\n\n$inline"
            }
            val images = imageFiles.map { AttachedImage(data = it.base64Data!!, mimeType = it.mimeType) }
            if (onSendWithAttachments != null) {
                val sent = onSendWithAttachments(finalText, images)
                if (sent) {
                    attachedFiles = emptyList()
                    onDraftChange("")
                }
            } else {
                attachedFiles = emptyList()
                onDraftChange(finalText)
                onSend()
            }
        }
    }
    val scrollIntent = remember(sessionId) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source == NestedScrollSource.UserInput && available.y > 0f) followLocked = false
                return Offset.Zero
            }
        }
    }
    LaunchedEffect(messages.size, messages.lastOrNull()?.text, followLocked) {
        if (messages.isNotEmpty() && followLocked) listState.scrollToItem(messages.lastIndex)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OmpColors.Bg)
            .safeDrawingPadding()
            .imePadding(),
    ) {
        ChatTopBar(
            title = title,
            currentModel = currentModel,
            connection = connection,
            running = running,
            modelsAvailable = models.isNotEmpty(),
            onBack = onBack,
            onAbort = onAbort,
            onOpenPicker = onOpenPicker,
            onOpenSettings = onOpenSettings,
            branchesAvailable = branches.isNotEmpty(),
            branchLabel = branches.firstOrNull { it.id == branchLeafId }?.label
                ?: branches.firstOrNull()?.label,
            onOpenBranches = {
                if (sessionId.isNotBlank()) onFetchBranches(sessionId)
                branchesOpen = true
            },
        )
        if (!error.isNullOrBlank()) {
            Text(
                error,
                color = OmpColors.StatusError,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        if (!attachWarning.isNullOrBlank()) {
            Text(
                attachWarning!!,
                color = OmpColors.StatusWarning,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        if (commandError != null) {
            Text(commandError!!, color = OmpColors.StatusError, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ChatHistoryHost(requester = requester, sessionId = sessionId, leafId = if (historicalView) branchLeafId else null, onOpenSession = onOpenSession, onEditMessage = onDraftChange)
            ChatStatsHost(requester = requester, sessionId = sessionId)
            ChatSlashHost(requester = requester, sessionCwd = sessionCwd, slashCommands = slashCommands, draft = draft, onInsertSlash = onDraftChange)
        }
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .nestedScroll(scrollIntent),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            itemsIndexed(
                items = messages,
                key = { index, message -> "${message.role}_${message.timestamp ?: index}_$index" },
            ) { _, message ->
                if (message.role == "user") {
                    UserMessage(message)
                } else {
                    AssistantMessage(
                        message = message,
                        requester = requester,
                        sessionId = sessionId,
                    )
                }
            }
        }
        if (!followLocked) {
            androidx.compose.material3.TextButton(onClick = { followLocked = true }) {
                Text("Jump to latest", color = OmpColors.Accent)
            }
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp)
                .padding(bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().heightIn(max = 240.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
            ChatExtensionHost(
                requester = requester, sessionId = sessionId,
                requests = extensionDialogs, notices = chatNotices,
                status = extensionStatus, widgets = extensionWidgets,
                onDismissNotice = onDismissChatNotice,
                onDismissRequest = onDismissExtensionDialog,
            )
            TodoPanel(todos = todos)
            SubagentPanel(
                requester = requester,
                sessionId = sessionId,
                subagents = subagents,
            )
            if (!historicalView) {
            QueuePanel(
                running = running,
                steering = queueSteering,
                followUp = queueFollowUp,
                draft = draft,
                onSteer = { text -> execute(JSONObject().put("type", "steer").put("message", text)) { onDraftChange("") } },
                onFollowUp = { text -> execute(JSONObject().put("type", "follow_up").put("message", text)) { onDraftChange("") } },
                onInterrupt = { text -> execute(JSONObject().put("type", "abort_and_prompt").put("message", text)) { onDraftChange("") } },

            )
            RuntimePanel(
                requester = requester,
                sessionId = sessionId,
                running = running,
                fastMode = if (runtimeState.has("fastModeEnabled")) runtimeState.optBoolean("fastModeEnabled") else fastMode,
                autoRetry = if (runtimeState.has("autoRetryEnabled")) runtimeState.optBoolean("autoRetryEnabled") else autoRetry,
                interruptMode = runtimeState.optString("interruptMode").takeIf { it.isNotBlank() } ?: interruptMode,
                autoCompaction = if (runtimeState.has("autoCompactionEnabled")) runtimeState.optBoolean("autoCompactionEnabled") else autoCompaction,
                steeringMode = runtimeState.optString("steeringMode").takeIf { it.isNotBlank() } ?: steeringMode,
                followUpMode = runtimeState.optString("followUpMode").takeIf { it.isNotBlank() } ?: followUpMode,
                onFastModeChange = { execute(JSONObject().put("type", "set_fast_mode").put("enabled", it)) },
                onAutoRetryChange = { execute(JSONObject().put("type", "set_auto_retry").put("enabled", it)) },
                onInterruptModeChange = { execute(JSONObject().put("type", "set_interrupt_mode").put("mode", it)) },
                onAutoCompactionChange = { execute(JSONObject().put("type", "set_auto_compaction").put("enabled", it)) },
                onSteeringModeChange = { execute(JSONObject().put("type", "set_steering_mode").put("mode", it)) },
                onFollowUpModeChange = { execute(JSONObject().put("type", "set_follow_up_mode").put("mode", it)) },
                onCycleModel = { execute(JSONObject().put("type", "cycle_model")) },
                onBash = { execute(JSONObject().put("type", "bash").put("command", it.removePrefix("!")).put("excludeFromContext", it.startsWith("!!"))) },
                onHandoff = { execute(JSONObject().put("type", "handoff")) },
                onReload = { execute(JSONObject().put("type", "reload")) },
                onRetryAbort = { execute(JSONObject().put("type", "abort_retry")) },
                onAbortBash = { execute(JSONObject().put("type", "abort_bash")) },
                onCompact = { execute(JSONObject().put("type", "compact")) },
                onCustomCompact = { execute(JSONObject().put("type", "compact").put("customInstructions", it)) },

                onCopyLast = {
                    execute(JSONObject().put("type", "get_last_assistant_text")) { result ->
                        val text = result.optString("text")
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Assistant message", text))
                    }
                },
                onExport = {
                    commandScope.launch {
                        try {
                            shareSessionExport(context, requester, sessionId)
                        } catch (cancelled: kotlinx.coroutines.CancellationException) {
                            throw cancelled
                        } catch (failure: Exception) {
                            commandError = failure.message ?: "Export failed"
                        }
                    }
                },
                onOpenPalette = onOpenPalette,
                onAbort = { execute(JSONObject().put("type", "abort")) },
            )
            }
            }
            if (historicalView) {
                Text("Historical branch — read only. Fork a user entry in History to continue separately.", color = OmpColors.TextMuted)
                androidx.compose.material3.TextButton(onClick = {
                    historicalView = false
                    onOpenSession(sessionId)
                }) { Text("Return to live session", color = OmpColors.Accent) }
            } else {
            ComposerCard(
                draft = draft,
                running = running,
                currentModel = currentModel,
                attachedFiles = attachedFiles,
                thinkingLevel = thinkingLevel,
                usageFraction = usageFraction,
                onDraftChange = onDraftChange,
                onSend = sendWithComposer,
                onAbort = onAbort,
                onOpenPicker = onOpenPicker,
                onPickFiles = { pickerLauncher.launch("*/*") },
                onRemoveAttachment = { item -> attachedFiles = attachedFiles - item },
                onOpenUsage = onOpenUsage,
                onOpenThinkingPicker = { thinkingPickerOpen = true },
                onCompact = { execute(JSONObject().put("type", "compact")) },
                onOpenFiles = { filesOpen = true },
            )
            }
        }
    }
    if (pickerOpen) {
        ModelPickerSheet(
            models = models,
            currentModel = currentModel,
            running = running,
            onClosePicker = onClosePicker,
            onSelectModel = onSelectModel,
        )
    }
    if (thinkingPickerOpen) {
        ThinkingPickerSheet(
            selected = thinkingLevel,
            running = running,
            onClose = { thinkingPickerOpen = false },
            onSelect = {
                onThinkingLevelChange(it)
                thinkingPickerOpen = false
            },
        )
    }
    if (filesOpen) {
        FileBrowserSheet(
            requester = requester,
            path = filesPath.ifBlank { sessionCwd },
            cwd = sessionCwd,
            onDismiss = { filesOpen = false },
        )
    }
    if (branchesOpen) {
        BranchSheet(
            branches = branches,
            leafId = branchLeafId,
            korean = korean,
            onPick = { branch ->
                if (sessionId.isNotBlank()) {
                    onSetLeaf(sessionId, branch.id)
                    historicalView = true
                }
                branchesOpen = false
            },
            onDismiss = { branchesOpen = false },
        )
    }

}

// ---------------------------------------------------------------------------
// Top app bar.
// ---------------------------------------------------------------------------

@Composable
private fun ChatTopBar(
    title: String,
    currentModel: ModelRef?,
    connection: ConnectionState,
    running: Boolean,
    modelsAvailable: Boolean,
    onBack: () -> Unit,
    onAbort: () -> Unit,
    onOpenPicker: () -> Unit,
    onOpenSettings: () -> Unit,
    branchesAvailable: Boolean = false,
    branchLabel: String? = null,
    onOpenBranches: () -> Unit = {},
) {
    val korean = remember { Locale.getDefault().language == "ko" }
    Column(modifier = Modifier.fillMaxWidth().background(OmpColors.Bg)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                onClick = onBack,
                modifier = Modifier.size(44.dp).clip(CircleShape),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.chat_back),
                    tint = OmpColors.Text,
                )
            }
            Column(
                modifier = Modifier.weight(1f).padding(end = 8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    title,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = OmpColors.Text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(OmpColors.BgHover)
                            .border(1.dp, OmpColors.Border, RoundedCornerShape(6.dp))
                            .clickable(
                                enabled = !running && modelsAvailable,
                                onClick = onOpenPicker,
                            )
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Filled.AutoAwesome,
                            contentDescription = null,
                            modifier = Modifier.size(12.dp),
                            tint = OmpColors.Accent,
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            currentModel?.displayName() ?: stringResource(R.string.chat_model),
                            fontSize = 12.sp,
                            color = OmpColors.TextMuted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Icon(
                            Icons.Filled.KeyboardArrowDown,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = OmpColors.TextMuted,
                        )
                    }
                    Text(
                        " · ",
                        fontSize = 12.sp,
                        color = OmpColors.TextDim,
                    )
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(OmpColors.BgHover)
                            .border(1.dp, OmpColors.Border, RoundedCornerShape(6.dp))
                            .clickable(onClick = onOpenBranches)
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            branchLabel?.takeIf { it.isNotBlank() }
                                ?: if (korean) "가지" else "Branches",
                            fontSize = 12.sp,
                            color = OmpColors.TextMuted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (branchesAvailable) {
                            Text(" ▾", fontSize = 12.sp, color = OmpColors.TextMuted)
                        }
                    }
                    Text(
                        " · ",
                        fontSize = 12.sp,
                        color = OmpColors.TextDim,
                    )
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(
                                when (connection) {
                                    ConnectionState.Connected -> OmpColors.StatusSuccess
                                    ConnectionState.Connecting -> OmpColors.StatusWarning
                                    else -> OmpColors.TextDim
                                },
                            ),
                    )
                }
            }
            if (running) {
                Box(
                    modifier = Modifier
                        .padding(end = 8.dp)
                        .clip(RoundedCornerShape(50))
                        .background(OmpColors.AccentStrong)
                        .clickable(onClick = onAbort)
                        .padding(horizontal = 14.dp, vertical = 7.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        stringResource(R.string.chat_abort),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = androidx.compose.ui.graphics.Color.White,
                    )
                }
            }
            IconButton(
                onClick = onOpenSettings,
                modifier = Modifier.size(44.dp).clip(CircleShape),
            ) {
                Icon(
                    Icons.Filled.Settings,
                    contentDescription = "Settings",
                    tint = OmpColors.TextMuted,
                )
            }
        }
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
    }
}

// ---------------------------------------------------------------------------
// Messages.
// ---------------------------------------------------------------------------

private fun formatTimestamp(ts: Long?): String {
    if (ts == null) return ""
    val ms = when {
        ts > 1_000_000_000_000L -> ts
        ts > 1_000_000_000L -> ts * 1000L
        else -> ts * 1000L
    }
    return try {
        SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))
    } catch (_: Exception) {
        ""
    }
}

@Composable
private fun AssistantMessage(
    message: DisplayMessage,
    requester: RelayRequester,
    sessionId: String,
) {
    val stamp = remember(message.timestamp) { formatTimestamp(message.timestamp) }
    val needsFull = remember(message.text) {
        com.dbchbin.ompgui.remote.relay.EventProjector.needsFullText(message.text)
    }
    Column(modifier = Modifier.fillMaxWidth()) {
        if (needsFull) {
            LongMessageText(message = message, requester = requester, sessionId = sessionId)
        } else {
            MarkdownText(text = message.text, modifier = Modifier.fillMaxWidth())
        }
        if (stamp.isNotEmpty()) {
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                Text(stamp, fontSize = 11.sp, color = OmpColors.TextDim)
            }
        }
    }
}

@Composable
private fun UserMessage(message: DisplayMessage) {
    val stamp = remember(message.timestamp) { formatTimestamp(message.timestamp) }
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val bubbleMax = maxWidth * 0.85f
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.End,
        ) {
            Box(
                modifier = Modifier
                    .width(bubbleMax)
                    .clip(RoundedCornerShape(14.dp))
                    .background(OmpColors.UserBg)
                    .border(1.dp, OmpColors.Border, RoundedCornerShape(14.dp))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                Text(
                    message.text,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    color = OmpColors.Text,
                )
            }
            if (stamp.isNotEmpty()) {
                Text(
                    stamp,
                    fontSize = 11.sp,
                    color = OmpColors.TextDim,
                    modifier = Modifier.padding(top = 4.dp, end = 4.dp),
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Floating composer card.
// ---------------------------------------------------------------------------

@Composable
private fun ComposerCard(
    draft: String,
    running: Boolean,
    currentModel: ModelRef?,
    attachedFiles: List<AttachmentItem>,
    thinkingLevel: String,
    usageFraction: Double?,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onAbort: () -> Unit,
    onOpenPicker: () -> Unit,
    onPickFiles: () -> Unit,
    onRemoveAttachment: (AttachmentItem) -> Unit,
    onOpenUsage: () -> Unit,
    onOpenThinkingPicker: () -> Unit,
    onCompact: () -> Unit = {},
    onOpenFiles: () -> Unit = {},
) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(OmpColors.BgPanel)
            .border(1.dp, OmpColors.Border, shape)
            .padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 8.dp),
    ) {
        if (attachedFiles.isNotEmpty()) {
            LazyRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(bottom = 8.dp),
            ) {
                items(attachedFiles, key = { "${it.name}_${it.sizeBytes}_${it.mimeType}" }) { item ->
                    AttachmentChip(item = item, onRemove = { onRemoveAttachment(item) })
                }
            }
        }
        BasicTextField(
            value = draft,
            onValueChange = onDraftChange,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 24.dp, max = 144.dp),
            textStyle = TextStyle(fontSize = 14.sp, color = OmpColors.Text),
            cursorBrush = SolidColor(OmpColors.Accent),
            maxLines = 6,
            decorationBox = { inner ->
                Box(modifier = Modifier.fillMaxWidth()) {
                    if (draft.isEmpty()) {
                        Text(
                            "메시지… 명령어는 /, 파일은 @ 입력",
                            fontSize = 14.sp,
                            color = OmpColors.TextDim,
                        )
                    }
                    inner()
                }
            },
        )
        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth().height(44.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onPickFiles),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Filled.AttachFile,
                    contentDescription = "Attach file",
                    modifier = Modifier.size(20.dp),
                    tint = OmpColors.TextMuted,
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            Row(
                modifier = Modifier
                    .height(32.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(OmpColors.BgHover)
                    .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                    .clickable(onClick = onOpenPicker)
                    .padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Filled.AutoAwesome,
                    contentDescription = null,
                    modifier = Modifier.size(12.dp),
                    tint = OmpColors.Accent,
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    currentModel?.displayName() ?: stringResource(R.string.chat_model),
                    fontSize = 12.sp,
                    color = OmpColors.Text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Icon(
                    Icons.Filled.KeyboardArrowDown,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = OmpColors.TextMuted,
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            Box(
                modifier = Modifier
                    .height(32.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(OmpColors.BgHover)
                    .border(1.dp, OmpColors.Border, RoundedCornerShape(8.dp))
                    .clickable(onClick = onOpenThinkingPicker)
                    .padding(horizontal = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("$thinkingLevel ▾", fontSize = 12.sp, color = OmpColors.TextMuted)
            }
            Spacer(modifier = Modifier.weight(1f))
            Box(
                modifier = Modifier
                    .height(32.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(onClick = onOpenFiles)
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("files", fontSize = 11.sp, color = OmpColors.TextMuted)
            }
            Box(
                modifier = Modifier
                    .height(32.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(enabled = !running, onClick = onCompact)
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("compact", fontSize = 11.sp, color = OmpColors.TextMuted)
            }
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onOpenUsage),
                contentAlignment = Alignment.Center,
            ) {
                ContextRingContent(fraction = usageFraction)
            }
            Spacer(modifier = Modifier.width(8.dp))
            val canSend = (draft.isNotBlank() || attachedFiles.isNotEmpty()) && !running
            val active = running || canSend
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(if (active) OmpColors.AccentStrong else OmpColors.BgHover)
                    .clickable(
                        enabled = active,
                        onClick = { if (running) onAbort() else onSend() },
                    ),
                contentAlignment = Alignment.Center,
            ) {
                if (running) {
                    Icon(
                        Icons.Filled.Stop,
                        contentDescription = stringResource(R.string.chat_abort),
                        modifier = Modifier.size(16.dp),
                        tint = androidx.compose.ui.graphics.Color.White,
                    )
                } else {
                    Icon(
                        Icons.Filled.ArrowUpward,
                        contentDescription = stringResource(R.string.chat_send),
                        modifier = Modifier.size(18.dp),
                        tint = if (canSend) {
                            androidx.compose.ui.graphics.Color.White
                        } else {
                            OmpColors.TextDim
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun AttachmentChip(item: AttachmentItem, onRemove: () -> Unit) {
    val chipShape = RoundedCornerShape(8.dp)
    Row(
        modifier = Modifier
            .clip(chipShape)
            .background(OmpColors.BgHover)
            .border(1.dp, OmpColors.Border, chipShape)
            .padding(start = 4.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (item.isImage && item.bitmap != null) {
            Image(
                bitmap = item.bitmap,
                contentDescription = null,
                modifier = Modifier
                    .size(20.dp)
                    .clip(RoundedCornerShape(4.dp)),
            )
        } else if (item.isImage) {
            Icon(
                Icons.Filled.PhotoLibrary,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = OmpColors.TextMuted,
            )
        } else {
            Icon(
                Icons.Filled.Description,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = OmpColors.TextMuted,
            )
        }
        Spacer(modifier = Modifier.width(4.dp))
        Column {
            Text(
                trimFileName(item.name),
                fontSize = 12.sp,
                color = OmpColors.Text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                formatAttachmentSize(item.sizeBytes),
                fontSize = 11.sp,
                color = OmpColors.TextMuted,
                maxLines = 1,
            )
        }
        Spacer(modifier = Modifier.width(4.dp))
        Box(
            modifier = Modifier
                .sizeIn(minWidth = 36.dp, minHeight = 36.dp)
                .clip(CircleShape)
                .clickable(onClick = onRemove),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.Close,
                contentDescription = "Remove attachment",
                modifier = Modifier.size(14.dp),
                tint = OmpColors.TextMuted,
            )
        }
    }
}

@Composable
private fun ContextRingContent(fraction: Double?) {
    val clamped = fraction?.coerceIn(0.0, 1.0)
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawCircle(color = OmpColors.Border, style = Stroke(width = 3f))
            if (clamped != null) {
                drawArc(
                    color = OmpColors.Accent,
                    startAngle = -90f,
                    sweepAngle = (360f * clamped).toFloat(),
                    useCenter = false,
                    style = Stroke(width = 3f),
                )
            }
        }
        Text(
            text = if (clamped == null) "—" else "${(clamped * 100).toInt()}%",
            fontSize = 7.sp,
            color = OmpColors.TextMuted,
        )
    }
}

// ---------------------------------------------------------------------------
// Model picker bottom sheet.
// ---------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ModelPickerSheet(
    models: List<RelayModelOption>,
    currentModel: ModelRef?,
    running: Boolean,
    onClosePicker: () -> Unit,
    onSelectModel: (RelayModelOption) -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onClosePicker,
        containerColor = OmpColors.BgPanel,
        contentColor = OmpColors.Text,
    ) {
        Text(
            "모델 선택",
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            color = OmpColors.Text,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
        LazyColumn(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (models.isEmpty()) {
                item {
                    Text(
                        stringResource(R.string.chat_model_empty),
                        fontSize = 14.sp,
                        color = OmpColors.TextMuted,
                        modifier = Modifier.padding(vertical = 8.dp),
                    )
                }
            }
            items(models, key = { "${it.provider}/${it.id}" }) { option ->
                val selected = currentModel?.provider == option.provider &&
                    currentModel?.id == option.id
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (selected) OmpColors.BgHover else OmpColors.BgPanel)
                        .clickable(enabled = !running) { onSelectModel(option) }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(option.name, fontSize = 14.sp, color = OmpColors.Text)
                        Text(
                            "${option.provider}/${option.id}",
                            fontSize = 12.sp,
                            color = OmpColors.TextMuted,
                        )
                    }
                    if (selected) {
                        Icon(
                            Icons.Filled.Check,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                            tint = OmpColors.Accent,
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ThinkingPickerSheet(
    selected: String,
    running: Boolean,
    onClose: () -> Unit,
    onSelect: (String) -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onClose,
        containerColor = OmpColors.BgPanel,
        contentColor = OmpColors.Text,
    ) {
        Text(
            "Thinking level",
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            color = OmpColors.Text,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            THINKING_LEVELS.forEach { level ->
                val isSelected = level == selected
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (isSelected) OmpColors.BgHover else OmpColors.BgPanel)
                        .clickable(enabled = !running) { onSelect(level) }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        level,
                        fontSize = 14.sp,
                        color = OmpColors.Text,
                        modifier = Modifier.weight(1f),
                    )
                    if (isSelected) {
                        Icon(
                            Icons.Filled.Check,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                            tint = OmpColors.Accent,
                        )
                    }
                }
            }
        }
    }
}



@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BranchSheet(
    branches: List<RelayBranch>,
    leafId: String?,
    korean: Boolean,
    onPick: (RelayBranch) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = OmpColors.BgPanel,
        contentColor = OmpColors.Text,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                if (korean) "가지" else "Branches",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = OmpColors.Text,
                modifier = Modifier.padding(vertical = 8.dp),
            )
            if (branches.isEmpty()) {
                Text(
                    if (korean) "가지가 없습니다" else "No branches",
                    fontSize = 14.sp,
                    color = OmpColors.TextMuted,
                )
            } else {
                branches.forEach { branch ->
                    val selected = branch.id == leafId
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (selected) OmpColors.BgHover else OmpColors.BgPanel)
                            .clickable { onPick(branch) }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(branch.label.ifBlank { branch.id }, fontSize = 14.sp, color = OmpColors.Text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (!branch.role.isNullOrBlank()) {
                                Text(branch.role, fontSize = 12.sp, color = OmpColors.TextMuted, maxLines = 1)
                            }
                        }
                        if (selected) {
                            Text("✓", fontSize = 14.sp, color = OmpColors.Accent)
                        }
                    }
                }
            }
        }
    }
}

