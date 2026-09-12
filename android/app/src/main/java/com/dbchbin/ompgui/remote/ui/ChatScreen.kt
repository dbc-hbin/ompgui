package com.dbchbin.ompgui.remote.ui

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.scrollBy
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
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
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
import com.dbchbin.ompgui.remote.relay.AttachmentSource
import com.dbchbin.ompgui.remote.relay.AttachmentTransfer
import com.dbchbin.ompgui.remote.relay.RelayProtocol
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
    val source: AttachmentSource? = null,
    val textContent: String? = null,
    val bitmap: ImageBitmap? = null,
)

private const val MAX_ATTACHMENTS = AttachmentTransfer.MAX_PER_KIND
private const val MAX_IMAGE_BYTES = AttachmentTransfer.MAX_IMAGE_BYTES
private const val MAX_TEXT_BYTES = AttachmentTransfer.MAX_TEXT_BYTES
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

private fun previewBitmap(open: () -> java.io.InputStream?): ImageBitmap? {
    return try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        open()?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / sample > 96 || bounds.outHeight / sample > 96) sample *= 2
        open()?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
        }
    } catch (_: Exception) { null }
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
            // Count without retaining the image; provider metadata is not a trusted size.
            val actualSize = resolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArray(8192)
                var total = 0L
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > MAX_IMAGE_BYTES) return null
                }
                total
            } ?: return null
            if (actualSize <= 0) return null
            AttachmentItem(
                name = name,
                isImage = true,
                mimeType = mime,
                sizeBytes = actualSize,
                source = AttachmentSource(mime, actualSize) {
                    resolver.openInputStream(uri) ?: throw java.io.IOException("Cannot reopen $name; select it again")
                },
                bitmap = previewBitmap { resolver.openInputStream(uri) },
            )
        } else if (isTextish(mime, name)) {
            val bytes = readBounded(resolver, uri, MAX_TEXT_BYTES) ?: return null
            val text = try {
                Charsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString()
            } catch (_: Exception) {
                return null
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

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(
    requester: RelayRequester,
    onOpenSession: (String) -> Unit,
    onOpenFork: (String, String, List<com.dbchbin.ompgui.remote.relay.AttachedImage>) -> Unit,
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
    onSendWithAttachments: (suspend (String, List<AttachmentSource>, String) -> Boolean)? = null,
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
    fastMode: Boolean? = null,
    autoRetry: Boolean? = null,
    interruptMode: String? = null,
    autoCompaction: Boolean? = null,
    steeringMode: String? = null,
    followUpMode: String? = null,
    onOpenPalette: () -> Unit,
    messageQueue: com.dbchbin.ompgui.remote.relay.RelayMessageQueue,
    queueOperationPending: Boolean,
    recalledDraft: com.dbchbin.ompgui.remote.relay.RelayRecalledDraft?,
    onRefreshQueue: () -> Unit,
    onRecallQueuedMessage: suspend (String) -> Boolean,
    onDeleteQueuedMessage: (String) -> Unit,
    onPromoteQueuedMessage: (String) -> Unit,
    onConsumeRecalledDraft: (String) -> Unit,
) {
    var queueOpen by remember(sessionId) { mutableStateOf(false) }
    var recallConfirmation by remember(sessionId) { mutableStateOf<String?>(null) }
    val keyboardController = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    fun openQueue() {
        focusManager.clearFocus()
        keyboardController?.hide()
        queueOpen = true
        onRefreshQueue()
    }
    var historyOpen by remember(sessionId) { mutableStateOf(false) }
    var statsOpen by remember(sessionId) { mutableStateOf(false) }
    var commandsOpen by remember(sessionId) { mutableStateOf(false) }
    var runtimeExpanded by remember(sessionId) { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val context = LocalContext.current
    var submitBehavior by remember(context) {
        mutableStateOf(com.dbchbin.ompgui.remote.store.AppPreferences.getSubmitBehavior(context))
    }
    androidx.compose.runtime.DisposableEffect(context) {
        val preferences = com.dbchbin.ompgui.remote.store.AppPreferences.prefs(context)
        val listener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == com.dbchbin.ompgui.remote.store.AppPreferences.KEY_SUBMISSION_MODE) {
                submitBehavior = com.dbchbin.ompgui.remote.store.AppPreferences.getSubmitBehavior(context)
            }
        }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        onDispose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    val latestDraft by androidx.compose.runtime.rememberUpdatedState(draft)
    var attachedFiles by remember(sessionId) { mutableStateOf<List<AttachmentItem>>(emptyList()) }
    var attachWarning by remember(sessionId) { mutableStateOf<String?>(null) }
    var sending by remember(sessionId) { mutableStateOf(false) }
    var sendJob by remember(sessionId) { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    var thinkingPickerOpen by remember { mutableStateOf(false) }
    var filesOpen by remember { mutableStateOf(false) }
    var branchesOpen by remember { mutableStateOf(false) }
    var followLocked by remember(sessionId) { mutableStateOf(true) }
    var historicalView by remember(sessionId) { mutableStateOf(false) }
    var commandError by remember(sessionId) { mutableStateOf<String?>(null) }
    var runtimeState by remember(sessionId) { mutableStateOf(JSONObject()) }
    val commandScope = androidx.compose.runtime.key(sessionId) { rememberCoroutineScope() }
    var messageActionPending by remember(sessionId) { mutableStateOf(false) }
    var messageActionConfirmation by remember(sessionId) { mutableStateOf<(() -> Unit)?>(null) }
    val latestRunning by androidx.compose.runtime.rememberUpdatedState(running)
    val latestSending by androidx.compose.runtime.rememberUpdatedState(sending)
    val latestQueuePending by androidx.compose.runtime.rememberUpdatedState(queueOperationPending || recalledDraft != null)
    val latestSessionId by androidx.compose.runtime.rememberUpdatedState(sessionId)
    val messageActionsEnabled = sessionId.isNotBlank() && !running && !sending && !messageActionPending && !queueOperationPending && recalledDraft == null && connection == ConnectionState.Connected
    suspend fun messageImages(message: DisplayMessage, entry: JSONObject): List<com.dbchbin.ompgui.remote.relay.AttachedImage> {
        val content = entry.optJSONArray("content")
        val images = mutableListOf<JSONObject>()
        if (content != null) for (index in 0 until content.length()) {
            content.optJSONObject(index)?.takeIf { it.optString("type") == "image" }?.let { images.add(it) }
        }
        if (message.deferredImages != null || images.any { it.optString("data").isBlank() }) {
            images.clear()
            var offset = 0
            do {
                val args = JSONObject().put("id", sessionId).put("entryId", requireNotNull(message.entryId)).put("offset", offset).put("limit", 1)
                if (!branchLeafId.isNullOrBlank()) args.put("leafId", branchLeafId)
                val page = requester.request("sessions", "media", args)
                check(page.optInt("missingCount") == 0) { context.getString(R.string.chat_message_images_unavailable) }
                val found = page.getJSONArray("images")
                for (index in 0 until found.length()) images.add(found.getJSONObject(index))
                if (!page.optBoolean("hasMore")) break
                val next = page.getInt("nextOffset")
                check(next > offset) { context.getString(R.string.chat_message_images_unavailable) }
                offset = next
            } while (true)
        }
        return images.map { image ->
            val data = image.getString("data")
            check(data.isNotEmpty()) { context.getString(R.string.chat_message_images_unavailable) }
            com.dbchbin.ompgui.remote.relay.AttachedImage(data, image.getString("mimeType"))
        }
    }

    fun messageAction(message: DisplayMessage, entry: JSONObject?, fork: Boolean) {
        if (!messageActionsEnabled || messageActionPending || latestRunning) return
        messageActionPending = true
        val sourceSession = sessionId
        val originalDraft = latestDraft
        val originalFiles = attachedFiles
        commandScope.launch {
            var forkStarted = false
            try {
                val complete = entry ?: if (message.truncated) com.dbchbin.ompgui.remote.relay.ChatRequests.fullEntry(requester, sessionId, requireNotNull(message.entryId), branchLeafId)
                    else JSONObject().put("content", message.content ?: message.text)
                val text = com.dbchbin.ompgui.remote.relay.ChatRequests.messageText(complete)
                val images = messageImages(message, complete)
                val restored = withContext(Dispatchers.IO) {
                    images.mapIndexed { index, image ->
                        val bytes = android.util.Base64.decode(image.data, android.util.Base64.DEFAULT)
                        check(bytes.isNotEmpty()) { context.getString(R.string.chat_message_images_unavailable) }
                        AttachmentItem(context.getString(R.string.chat_queue_image_name, index + 1), true, image.mimeType, bytes.size.toLong(),
                            source = AttachmentSource(image.mimeType, bytes.size.toLong()) { bytes.inputStream() }, bitmap = previewBitmap { bytes.inputStream() })
                    }
                }
                if (latestSessionId != sourceSession || latestRunning) return@launch
                val apply: () -> Unit = {
                    if (!forkStarted && latestSessionId == sourceSession && !latestRunning && !latestSending && !latestQueuePending) {
                        if (fork) {
                            messageActionPending = true
                            forkStarted = true
                            commandScope.launch {
                                try {
                                    val command = JSONObject().put("type", "fork").put("entryId", requireNotNull(message.entryId))
                                    if (!branchLeafId.isNullOrBlank()) command.put("leafId", branchLeafId)
                                    val response = com.dbchbin.ompgui.remote.relay.ChatRequests.command(requester, sourceSession, command)
                                    val result = response.optJSONObject("result") ?: response
                                    if (!result.optBoolean("cancelled") && latestSessionId == sourceSession) {
                                        onOpenFork(result.getString("newSessionId"), result.optString("text", text), images)
                                    }
                                } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                                catch (failure: Exception) { commandError = failure.message ?: context.getString(R.string.chat_error_command_failed) }
                                finally { messageActionPending = false }
                            }
                        } else {
                            attachedFiles = restored
                            onDraftChange(text)
                            attachWarning = null
                        }
                    }
                }
                if (latestDraft.isNotEmpty() || attachedFiles.isNotEmpty() || latestDraft != originalDraft || attachedFiles != originalFiles) {
                    messageActionConfirmation = apply
                } else apply()
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (failure: Exception) { commandError = failure.message ?: context.getString(R.string.chat_error_command_failed) }
            finally { if (!forkStarted) messageActionPending = false }
        }
    }
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
                commandError = failure.message ?: context.getString(R.string.chat_error_command_failed)
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
            commandError = failure.message ?: context.getString(R.string.chat_error_session_state)
        }
    }
    LaunchedEffect(recalledDraft?.id) {
        val recalled = recalledDraft ?: return@LaunchedEffect
        try {
            val restored = withContext(Dispatchers.IO) {
                recalled.images.mapIndexed { index, image ->
                    val bytes = android.util.Base64.decode(image.data, android.util.Base64.DEFAULT)
                    AttachmentItem(
                        name = context.getString(R.string.chat_queue_image_name, index + 1),
                        isImage = true,
                        mimeType = image.mimeType,
                        sizeBytes = bytes.size.toLong(),
                        source = AttachmentSource(image.mimeType, bytes.size.toLong()) { bytes.inputStream() },
                        bitmap = previewBitmap { bytes.inputStream() },
                    )
                }
            }
            attachedFiles = restored
            onDraftChange(recalled.text)
            attachWarning = null
            onConsumeRecalledDraft(recalled.id)
            queueOpen = false
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            attachWarning = context.getString(R.string.chat_queue_restore_failed)
        }
    }
    messageActionConfirmation?.let { action ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { messageActionConfirmation = null },
            containerColor = OmpColors.BgPanel,
            title = { Text(stringResource(R.string.chat_queue_replace_title)) },
            text = { Text(stringResource(R.string.chat_message_replace_draft)) },
            confirmButton = { androidx.compose.material3.TextButton(enabled = messageActionsEnabled, onClick = { messageActionConfirmation = null; action() }) { Text(stringResource(R.string.extension_confirm)) } },
            dismissButton = { androidx.compose.material3.TextButton(onClick = { messageActionConfirmation = null }) { Text(stringResource(R.string.chat_queue_cancel)) } },
        )
    }
    val pickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetMultipleContents(),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        commandScope.launch {
            val loaded = withContext(Dispatchers.IO) {
                uris.mapNotNull { uri -> loadAttachment(context, uri) }
            }
            val combined = attachedFiles + loaded
            attachWarning = when {
                loaded.size != uris.size -> context.getString(R.string.chat_error_attach_selection)
                combined.count { it.isImage } > MAX_ATTACHMENTS || combined.count { !it.isImage } > MAX_ATTACHMENTS ->
                    context.getString(R.string.chat_error_attach_limit)
                else -> null
            }
            if (attachWarning == null) attachedFiles = combined
        }
    }
    val sendWithComposer: () -> Unit = {
        if (!sending && !messageActionPending && !queueOperationPending && recalledDraft == null) {
            val commandType = when {
                !running -> "prompt"
                submitBehavior == com.dbchbin.ompgui.remote.store.AppPreferences.SUBMIT_QUEUE -> "follow_up"
                else -> "steer"
            }
            sending = true
            val sendFiles = attachedFiles
            sendJob = commandScope.launch {
                try {
                    val inline = sendFiles.filter { it.textContent != null }.joinToString("\n\n") { f ->
                        "--- file: ${f.name} ---\n${f.textContent}\n--- end file ---"
                    }
                    val finalText = when {
                        draft.isBlank() -> inline
                        inline.isBlank() -> draft
                        else -> "$draft\n\n$inline"
                    }
                    require(finalText.length <= RelayProtocol.MAX_PROMPT_CHARS) { "Composed prompt exceeds 3 Mi characters" }
                    val sender = onSendWithAttachments ?: throw IllegalStateException("Acknowledged sending is unavailable")
                    val accepted = sender(finalText, sendFiles.mapNotNull { it.source }, commandType)
                    if (accepted) {
                        attachedFiles = attachedFiles.filterNot { it in sendFiles }
                        if (latestDraft == draft || latestDraft.isEmpty()) onDraftChange("")
                        attachWarning = null
                    } else {
                        attachWarning = context.getString(R.string.chat_error_prompt_rejected)
                    }
                } catch (cancelled: kotlinx.coroutines.CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    attachWarning = failure.message ?: context.getString(R.string.chat_error_send_failed)
                } finally {
                    sending = false
                }
            }
        }
    }
    val results = remember(messages) { messages.filter { it.role == "toolResult" || it.role == "tool" }
                .mapNotNull { result -> result.toolCallId?.let { it to result } }.toMap() }
    val callIds = remember(messages) { messages.flatMap { message ->
                val content = message.content
                if (content == null) emptyList() else (0 until content.length()).mapNotNull { index ->
                    content.optJSONObject(index)?.takeIf { it.optString("type") == "toolCall" }
                        ?.optString("toolCallId")?.takeIf { it.isNotBlank() }
                }
            }.toSet() }
    val transcriptMessages = remember(messages, callIds) {
        val turns = mutableListOf<MutableList<DisplayMessage>>()
        for (message in messages) {
            if ((message.role == "toolResult" || message.role == "tool") && message.toolCallId in callIds) continue
            if (message.role == "user" || turns.lastOrNull()?.firstOrNull()?.role == "user" || turns.isEmpty()) {
                turns.add(mutableListOf(message))
            } else {
                turns.last().add(message)
            }
        }
        turns
    }
    suspend fun scrollToLatest() {
        if (transcriptMessages.isEmpty()) return
        listState.scrollToItem(transcriptMessages.lastIndex)
        // A final message can be taller than the viewport: its top is not the end.
        val layout = listState.layoutInfo
        val lastItem = layout.visibleItemsInfo.lastOrNull() ?: return
        val remaining = lastItem.offset + lastItem.size + layout.afterContentPadding - layout.viewportEndOffset
        if (remaining > 0) listState.scrollBy(remaining.toFloat())
    }
    val scrollIntent = remember(sessionId) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source == NestedScrollSource.UserInput && available.y > 0f) followLocked = false
                return Offset.Zero
            }

            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (source == NestedScrollSource.UserInput && !listState.canScrollForward) followLocked = true
                return Offset.Zero
            }
        }
    }
    LaunchedEffect(messages.size, messages.lastOrNull(), followLocked, listState.layoutInfo.viewportSize.height) {
        if (followLocked) scrollToLatest()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(OmpColors.Bg)
            .safeDrawingPadding()
            .imePadding(),
    ) {
        Column(Modifier.fillMaxSize()) {
        ChatTopBar(
            title = title,
            connection = connection,
            running = running,
            onBack = onBack,
            onOpenSettings = onOpenSettings,
            onOpenHistory = { historyOpen = true },
            onOpenStats = { statsOpen = true },
            onOpenCommands = { commandsOpen = true },
            runtimeEnabled = !historicalView,
            navigationEnabled = !queueOperationPending && recalledDraft == null,
            onOpenRuntime = { runtimeExpanded = true },
            onOpenQueue = ::openQueue,
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
        if (sending) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (attachedFiles.any { it.isImage }) stringResource(R.string.chat_status_uploading)
                    else stringResource(R.string.chat_status_sending),
                    color = OmpColors.TextDim,
                    modifier = Modifier.weight(1f).padding(12.dp),
                )
                IconButton(onClick = {
                    attachWarning = context.getString(R.string.chat_error_send_cancelled)
                    sendJob?.cancel()
                }) {
                    Icon(Icons.Default.Close, contentDescription = stringResource(R.string.chat_status_cancel_send), tint = OmpColors.TextDim)
                }
            }
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
        Box(Modifier.weight(1f).fillMaxWidth()) {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .nestedScroll(scrollIntent),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            itemsIndexed(
                items = transcriptMessages,
                key = { index, turn -> turn.first().let { message -> message.entryId ?: "${message.role}_${message.toolCallId ?: message.timestamp ?: index}_$index" } },
            ) { _, turn ->
                val message = turn.first()
                if (message.role == "user") {
                    UserMessage(message, requester, sessionId, branchLeafId, messageActionsEnabled, onEdit = { messageAction(message, it, false) }, onFork = { messageAction(message, null, true) })
                } else {
                    AssistantTurn(turn, requester, sessionId, branchLeafId, results)
                }
            }
        }
        if (listState.canScrollForward) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .padding(vertical = 2.dp),
                contentAlignment = Alignment.Center,
            ) {
                IconButton(
                    onClick = {
                        followLocked = true
                        commandScope.launch { scrollToLatest() }
                    },
                    modifier = Modifier.size(48.dp),
                ) {
                    Icon(
                        Icons.Filled.KeyboardArrowDown,
                        contentDescription = stringResource(R.string.chat_jump_to_latest),
                        tint = OmpColors.Accent,
                        modifier = Modifier.size(28.dp),
                    )
                }
            }
        }
        }
        ChatHistoryHost(requester = requester, sessionId = sessionId, leafId = if (historicalView) branchLeafId else null, onOpenSession = onOpenSession, onEditMessage = onDraftChange, expanded = historyOpen, onDismiss = { historyOpen = false })
        ChatStatsHost(requester = requester, sessionId = sessionId, open = statsOpen, onDismiss = { statsOpen = false })
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp)
                .padding(bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            ChatExtensionHost(
                requester = requester, sessionId = sessionId,
                requests = extensionDialogs, notices = chatNotices,
                status = extensionStatus, widgets = extensionWidgets,
                onDismissNotice = onDismissChatNotice,
                onDismissRequest = onDismissExtensionDialog,
            )
            // Todo and subagent details open in modal workspaces.
            TodoPanel(todos = todos)
            SubagentPanel(
                requester = requester,
                sessionId = sessionId,
                subagents = subagents,
            )
            RuntimePanel(
                expanded = runtimeExpanded && !historicalView,
                onExpandedChange = { runtimeExpanded = it },
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
                        clipboard.setPrimaryClip(android.content.ClipData.newPlainText(context.getString(R.string.chat_clipboard_assistant), text))
                    }
                },
                onExport = {
                    commandScope.launch {
                        try {
                            shareSessionExport(context, requester, sessionId)
                        } catch (cancelled: kotlinx.coroutines.CancellationException) {
                            throw cancelled
                        } catch (failure: Exception) {
                            commandError = failure.message ?: context.getString(R.string.chat_error_export_failed)
                        }
                    }
                },
                onOpenPalette = onOpenPalette,
                onOpenQueue = { runtimeExpanded = false; openQueue() },
                onAbort = { execute(JSONObject().put("type", "abort")) },
            )
            ChatSlashHost(requester = requester, sessionCwd = sessionCwd, slashCommands = slashCommands, draft = draft, onInsertSlash = onDraftChange, expanded = commandsOpen, onDismiss = { commandsOpen = false })
            if (historicalView) {
                Text(stringResource(R.string.chat_historical_readonly), color = OmpColors.TextMuted)
                androidx.compose.material3.TextButton(onClick = {
                    historicalView = false
                    onOpenSession(sessionId)
                }) { Text(stringResource(R.string.chat_return_live), color = OmpColors.Accent) }
            } else {
            ComposerCard(
                draft = draft,
                running = running,
                submitBehavior = submitBehavior,
                currentModel = currentModel,
                attachedFiles = attachedFiles,
                thinkingLevel = thinkingLevel,
                usageFraction = usageFraction,
                onDraftChange = { if (!sending && !messageActionPending && !queueOperationPending && recalledDraft == null) onDraftChange(it) },
                sending = sending || messageActionPending || queueOperationPending || recalledDraft != null,
                onSend = sendWithComposer,
                onAbort = onAbort,
                onOpenPicker = onOpenPicker,
                onPickFiles = { if (!sending && !messageActionPending && !queueOperationPending && recalledDraft == null) pickerLauncher.launch("*/*") },
                onRemoveAttachment = { item -> if (!sending && !messageActionPending && !queueOperationPending && recalledDraft == null) attachedFiles = attachedFiles - item },
                onOpenUsage = onOpenUsage,
                onOpenThinkingPicker = { thinkingPickerOpen = true },
                onCompact = { execute(JSONObject().put("type", "compact")) },
                onOpenFiles = { filesOpen = true },
            )
            }
        }
        }
    }
    if (queueOpen) {
        QueueScreen(
            queue = messageQueue,
            busy = queueOperationPending || sending || recalledDraft != null || connection != ConnectionState.Connected,
            error = error ?: attachWarning,
            onDismiss = { queueOpen = false },
            onRefresh = onRefreshQueue,
            onRecall = { id ->
                if (draft.isNotEmpty() || attachedFiles.isNotEmpty()) recallConfirmation = id
                else commandScope.launch { onRecallQueuedMessage(id) }
            },
            onDelete = onDeleteQueuedMessage,
            onPromote = onPromoteQueuedMessage,
        )
    }
    recallConfirmation?.let { id ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { recallConfirmation = null },
            containerColor = OmpColors.BgPanel,
            title = { Text(stringResource(R.string.chat_queue_replace_title), color = OmpColors.Text) },
            text = { Text(stringResource(R.string.chat_queue_replace_message), color = OmpColors.TextMuted) },
            confirmButton = {
                androidx.compose.material3.TextButton(
                    enabled = !queueOperationPending && !sending && recalledDraft == null && connection == ConnectionState.Connected,
                    onClick = { recallConfirmation = null; commandScope.launch { onRecallQueuedMessage(id) } },
                ) { Text(stringResource(R.string.chat_queue_replace)) }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { recallConfirmation = null }) {
                    Text(stringResource(R.string.chat_queue_cancel))
                }
            },
        )
    }
    if (pickerOpen) {
        androidx.compose.runtime.key(sessionId) {
            ModelPickerSheet(
                models = models,
                currentModel = currentModel,
                running = running,
                onClosePicker = onClosePicker,
                onSelectModel = onSelectModel,
            )
        }
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
            onPick = { branch ->
                if (sessionId.isNotBlank() && !queueOperationPending && recalledDraft == null) {
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
    connection: ConnectionState,
    running: Boolean,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenBranches: () -> Unit = {},
    onOpenHistory: () -> Unit,
    onOpenStats: () -> Unit,
    onOpenCommands: () -> Unit,
    onOpenRuntime: () -> Unit,
    onOpenQueue: () -> Unit,
    runtimeEnabled: Boolean,
    navigationEnabled: Boolean,
) {
    var menuOpen by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(OmpColors.Bg)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack, enabled = navigationEnabled, modifier = Modifier.size(48.dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.chat_back), tint = OmpColors.Text)
            }
            Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = OmpColors.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(when (connection) {
                    ConnectionState.Connected -> if (running) stringResource(R.string.chat_status_running) else stringResource(R.string.chat_status_connected)
                    ConnectionState.Connecting -> stringResource(R.string.chat_status_connecting)
                    else -> stringResource(R.string.chat_status_disconnected)
                }, fontSize = 12.sp, color = OmpColors.TextMuted)
            }
            IconButton(onClick = onOpenRuntime, enabled = runtimeEnabled, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Filled.Tune, stringResource(R.string.chat_menu_session_controls),
                    tint = if (runtimeEnabled) OmpColors.TextMuted else OmpColors.TextDim)
            }
            IconButton(onClick = onOpenBranches, enabled = navigationEnabled, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Filled.AccountTree, stringResource(R.string.chat_menu_branches), tint = OmpColors.TextMuted)
            }
            Box {
                IconButton(onClick = { menuOpen = true }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Filled.MoreHoriz, stringResource(R.string.chat_menu_session_menu), tint = OmpColors.TextMuted)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.chat_menu_history)) }, leadingIcon = { Icon(Icons.Filled.History, null, Modifier.size(20.dp)) }, onClick = { menuOpen = false; onOpenHistory() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.chat_menu_session_info)) }, leadingIcon = { Icon(Icons.Filled.Info, null, Modifier.size(20.dp)) }, onClick = { menuOpen = false; onOpenStats() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.chat_menu_commands)) }, leadingIcon = { Icon(Icons.Filled.Terminal, null, Modifier.size(20.dp)) }, onClick = { menuOpen = false; onOpenCommands() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.chat_menu_session_controls)) }, leadingIcon = { Icon(Icons.Filled.Tune, null, Modifier.size(20.dp)) }, enabled = runtimeEnabled, onClick = { menuOpen = false; onOpenRuntime() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.chat_queue_title)) }, enabled = runtimeEnabled, onClick = { menuOpen = false; onOpenQueue() })
                    HorizontalDivider(color = OmpColors.Border)
                    DropdownMenuItem(text = { Text(stringResource(R.string.chat_menu_settings)) }, leadingIcon = { Icon(Icons.Filled.Settings, null, Modifier.size(20.dp)) }, onClick = { menuOpen = false; onOpenSettings() })
                }
            }
        }
        HorizontalDivider(color = OmpColors.Border)
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
private fun AssistantTurn(
    messages: List<DisplayMessage>,
    requester: RelayRequester,
    sessionId: String,
    leafId: String?,
    results: Map<String, DisplayMessage>,
) {
    var expanded by remember(sessionId, leafId, messages.first().entryId) { mutableStateOf(false) }
    val thinkingShown = LocalThinkingShown.current
    var hasActivity = false
    var pending = false
    var failed = false
    for (message in messages) {
        pending = pending || message.streaming
        hasActivity = hasActivity || message.streaming
        val standaloneTool = message.role == "toolResult" || message.role == "tool" || message.role == "bashExecution"
        if (standaloneTool) {
            hasActivity = true
            failed = failed || message.isError
        }
        val content = message.content ?: continue
        for (index in 0 until content.length()) {
            val block = content.optJSONObject(index) ?: continue
            when (block.optString("type")) {
                "thinking" -> if (thinkingShown) hasActivity = true
                "toolCall" -> {
                    hasActivity = true
                    val result = results[block.optString("toolCallId")]
                    pending = pending || result == null || result.streaming
                    failed = failed || result?.isError == true
                }
            }
        }
    }
    Column(Modifier.fillMaxWidth()) {
        if (hasActivity) {
            val status = when {
                failed -> stringResource(R.string.chat_tool_failed)
                pending -> stringResource(R.string.chat_tool_progress)
                else -> stringResource(R.string.chat_tool_complete)
            }
            TranscriptDisclosure(
                label = if (thinkingShown) "${stringResource(R.string.thinking_title)} · ${stringResource(R.string.new_session_tools)} · $status" else "${stringResource(R.string.new_session_tools)} · $status",
                expanded = expanded,
                loading = pending,
                failed = failed,
                onClick = { expanded = !expanded },
            )
        }
        for ((index, message) in messages.withIndex()) {
            androidx.compose.runtime.key(message.entryId ?: index) {
                AssistantMessage(message, requester, sessionId, leafId, results, expanded)
            }
        }
    }
}

@Composable
private fun AssistantMessage(
    message: DisplayMessage,
    requester: RelayRequester,
    sessionId: String,
    leafId: String?,
    results: Map<String, DisplayMessage>,
    activityExpanded: Boolean,
) {
    val standaloneTool = message.role == "toolResult" || message.role == "tool" || message.role == "bashExecution"
    val content = message.content
    val activityOnly = content != null && content.length() > 0 && (0 until content.length()).all {
        val type = content.optJSONObject(it)?.optString("type")
        type == "thinking" || type == "toolCall"
    }
    if (!activityExpanded && (standaloneTool || (activityOnly && message.details == null && !message.truncated && message.deferredImages == null))) return
    val stamp = remember(message.timestamp) { formatTimestamp(message.timestamp) }
    Column(Modifier.fillMaxWidth()) {
        if (standaloneTool) {
            TranscriptTool(requester, sessionId, leafId, null, message)
        } else {
            TranscriptContent(requester, sessionId, leafId, message, results, activityExpanded = activityExpanded)
        }
        if (stamp.isNotEmpty()) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
            Text(stamp, fontSize = 12.sp, color = OmpColors.TextDim)
        }
    }
}

@Composable
private fun UserMessage(message: DisplayMessage, requester: RelayRequester, sessionId: String, leafId: String?, actionsEnabled: Boolean, onEdit: (JSONObject) -> Unit, onFork: () -> Unit) {
    val stamp = remember(message.timestamp) { formatTimestamp(message.timestamp) }
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val bubbleMax = maxWidth * 0.85f
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.End,
        ) {
            Box(Modifier.widthIn(max = bubbleMax)) {
                TranscriptContent(
                    requester, sessionId, leafId, message,
                    actionsEnabled = actionsEnabled,
                    onEdit = onEdit,
                    onFork = onFork,
                    contentModifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(OmpColors.UserBg)
                        .border(1.dp, OmpColors.Border, RoundedCornerShape(12.dp))
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
            if (stamp.isNotEmpty()) {
                Text(
                    stamp,
                    fontSize = 12.sp,
                    color = OmpColors.TextDim,
                    modifier = Modifier.padding(end = 4.dp),
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Floating composer card.
// ---------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ComposerCard(
    draft: String,
    running: Boolean,
    submitBehavior: String,
    currentModel: ModelRef?,
    attachedFiles: List<AttachmentItem>,
    sending: Boolean,
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
    var utilitiesOpen by remember { mutableStateOf(false) }
    val utilitiesDesc = stringResource(R.string.chat_composer_utilities)
    val usageLabel = usageFraction?.let { "${(it.coerceIn(0.0, 1.0) * 100).toInt()}%" } ?: "—"
    val shape = androidx.compose.material3.MaterialTheme.shapes.medium
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(OmpColors.BgPanel)
            .border(1.dp, OmpColors.Border, shape)
            .padding(top = 8.dp, bottom = 4.dp),
    ) {
        if (attachedFiles.isNotEmpty()) {
            LazyRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(bottom = 8.dp),
            ) {
                items(attachedFiles) { item ->
                    AttachmentChip(item = item, onRemove = { onRemoveAttachment(item) })
                }
            }
        }
        BasicTextField(
            value = draft,
            onValueChange = onDraftChange,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            textStyle = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, color = OmpColors.Text),
            cursorBrush = SolidColor(OmpColors.Accent),
            maxLines = 6,
            decorationBox = { inner ->
                Box(modifier = Modifier.fillMaxWidth()) {
                    if (draft.isEmpty()) {
                        Text(
                            stringResource(R.string.chat_composer_placeholder),
                            fontSize = 16.sp,
                            lineHeight = 24.sp,
                            color = OmpColors.TextDim,
                        )
                    }
                    inner()
                }
            },
        )
        FlowRow(Modifier.fillMaxWidth()) {
            IconButton(onClick = onPickFiles, enabled = !sending, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Filled.AttachFile, stringResource(R.string.chat_composer_attach), Modifier.size(20.dp), tint = OmpColors.TextMuted)
            }
            Row(
                // FlowRow uses this intrinsic basis to wrap controls, then weight
                // assigns the model all remaining space on its line.
                Modifier.weight(1f).width(96.dp).heightIn(min = 48.dp)
                    .clip(androidx.compose.material3.MaterialTheme.shapes.small)
                    .clickable(enabled = !running && !sending, onClick = onOpenPicker),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(currentModel?.displayName() ?: stringResource(R.string.chat_model), modifier = Modifier.weight(1f), style = androidx.compose.material3.MaterialTheme.typography.bodySmall, color = OmpColors.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Icon(Icons.Filled.KeyboardArrowDown, null, Modifier.size(16.dp), tint = OmpColors.TextMuted)
            }
            Box(Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .clip(androidx.compose.material3.MaterialTheme.shapes.small)
                .clickable(enabled = !running && !sending, onClick = onOpenThinkingPicker)
                .padding(horizontal = 4.dp), contentAlignment = Alignment.Center) {
                Text("$thinkingLevel ▾", style = androidx.compose.material3.MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
            }
            Box {
                IconButton(onClick = { utilitiesOpen = true }, modifier = Modifier.size(48.dp)) {
                    Box(Modifier.size(28.dp).semantics { contentDescription = utilitiesDesc }, contentAlignment = Alignment.Center) {
                        androidx.compose.foundation.Canvas(Modifier.fillMaxSize().padding(1.dp)) {
                            val stroke = androidx.compose.ui.graphics.drawscope.Stroke(width = 2.dp.toPx())
                            drawCircle(color = OmpColors.Border, style = stroke)
                            usageFraction?.let { fraction ->
                                drawArc(color = OmpColors.TextMuted, startAngle = -90f,
                                    sweepAngle = (fraction.coerceIn(0.0, 1.0) * 360).toFloat(),
                                    useCenter = false, style = stroke)
                            }
                        }
                        Text(usageLabel, fontSize = 9.sp, color = OmpColors.TextMuted, maxLines = 1)
                    }
                }
                DropdownMenu(expanded = utilitiesOpen, onDismissRequest = { utilitiesOpen = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.chat_composer_files)) }, onClick = { utilitiesOpen = false; onOpenFiles() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.chat_composer_compact)) }, enabled = !running && !sending, onClick = { utilitiesOpen = false; onCompact() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.chat_composer_context_usage, usageLabel)) }, onClick = { utilitiesOpen = false; onOpenUsage() })
                }
            }
            val canSend = draft.isNotBlank() || attachedFiles.isNotEmpty()
            val stop = running && !canSend
            val active = !sending && (stop || canSend)
            val actionLabel = stringResource(when {
                stop -> R.string.chat_abort
                !running -> R.string.chat_send
                submitBehavior == com.dbchbin.ompgui.remote.store.AppPreferences.SUBMIT_QUEUE -> R.string.chat_submit_queue
                else -> R.string.chat_submit_steer
            })
            androidx.compose.material3.TextButton(
                onClick = { if (stop) onAbort() else onSend() },
                enabled = active,
                modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp),
                contentPadding = PaddingValues(horizontal = 8.dp),
            ) {
                if (running && canSend) {
                    Text(actionLabel, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                } else {
                    Box(Modifier.size(32.dp).clip(CircleShape).background(if (active) OmpColors.AccentStrong else OmpColors.BgHover), contentAlignment = Alignment.Center) {
                        Icon(if (stop) Icons.Filled.Stop else Icons.Filled.ArrowUpward,
                            actionLabel, Modifier.size(18.dp),
                            tint = if (active) androidx.compose.material3.MaterialTheme.colorScheme.onPrimary else OmpColors.TextDim)
                    }
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
            .padding(start = 8.dp),
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
                fontSize = 12.sp,
                color = OmpColors.TextMuted,
                maxLines = 1,
            )
        }
        Spacer(modifier = Modifier.width(4.dp))
        Box(
            modifier = Modifier
                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                .clip(CircleShape)
                .clickable(onClick = onRemove),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.Close,
                contentDescription = stringResource(R.string.chat_composer_remove_attachment),
                modifier = Modifier.size(14.dp),
                tint = OmpColors.TextMuted,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Model picker bottom sheet.
// ---------------------------------------------------------------------------

@Composable
private fun ModelPickerSheet(
    models: List<RelayModelOption>,
    currentModel: ModelRef?,
    running: Boolean,
    onClosePicker: () -> Unit,
    onSelectModel: (RelayModelOption) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val filteredModels = remember(models, query) {
        val q = query.trim()
        models.filter { q.isEmpty() || it.name.contains(q, ignoreCase = true) || it.id.contains(q, ignoreCase = true) || it.provider.contains(q, ignoreCase = true) }
    }
    OmpModalSheet(
        onDismissRequest = onClosePicker,
        fullHeight = true,
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        Column(Modifier.fillMaxWidth().weight(1f)) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.chat_model_picker), fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold, color = OmpColors.Text, modifier = Modifier.weight(1f))
                IconButton(onClick = onClosePicker) { Icon(Icons.Filled.Close, stringResource(R.string.chat_model_close), tint = OmpColors.TextMuted) }
            }
            ModelSearchField(query, { query = it }, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            LazyColumn(
                modifier = Modifier.fillMaxWidth().weight(1f),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (filteredModels.isEmpty()) {
                    item {
                        Text(
                            if (query.isBlank()) stringResource(R.string.chat_model_empty) else stringResource(R.string.chat_model_no_matches),
                            fontSize = 14.sp,
                            color = OmpColors.TextMuted,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    }
                }
                items(filteredModels, key = { "${it.provider}/${it.id}" }) { option ->
                    val selected = currentModel?.provider == option.provider &&
                        currentModel?.id == option.id
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (selected) OmpColors.BgHover else OmpColors.BgPanel)
                            .clickable(enabled = !running) { onSelectModel(option) }
                            .heightIn(min = 48.dp)
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
}

@Composable
private fun ThinkingPickerSheet(
    selected: String,
    running: Boolean,
    onClose: () -> Unit,
    onSelect: (String) -> Unit,
) {
    OmpModalSheet(
        onDismissRequest = onClose,
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        Column(Modifier.fillMaxWidth().weight(1f, fill = false)) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.chat_thinking_level), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = OmpColors.Text, modifier = Modifier.weight(1f))
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, stringResource(R.string.chat_thinking_close), tint = OmpColors.TextMuted) }
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false).verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                THINKING_LEVELS.forEach { level ->
                    val isSelected = level == selected
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (isSelected) OmpColors.BgHover else OmpColors.BgPanel)
                            .clickable(enabled = !running) { onSelect(level) }.heightIn(min = 48.dp)
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
}



@Composable
private fun BranchSheet(
    branches: List<RelayBranch>,
    leafId: String?,
    onPick: (RelayBranch) -> Unit,
    onDismiss: () -> Unit,
) {
    OmpModalSheet(
        onDismissRequest = onDismiss,
        fullHeight = true,
        containerColor = OmpColors.Bg,
        contentColor = OmpColors.Text,
    ) {
        Column(Modifier.fillMaxWidth().weight(1f)) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.chat_menu_branches), fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                    color = OmpColors.Text, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, stringResource(R.string.chat_branches_close), tint = OmpColors.TextMuted) }
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f).verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp)
                    .padding(bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (branches.isEmpty()) {
                    Text(
                        stringResource(R.string.chat_branches_empty),
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
                                .clickable { onPick(branch) }.heightIn(min = 48.dp)
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
}

