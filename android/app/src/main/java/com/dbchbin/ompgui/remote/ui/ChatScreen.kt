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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.net.ConnectionState
import com.dbchbin.ompgui.remote.relay.AttachedImage
import com.dbchbin.ompgui.remote.relay.DisplayMessage
import com.dbchbin.ompgui.remote.relay.ModelRef
import com.dbchbin.ompgui.remote.relay.RelayModelOption
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
            AttachmentItem(
                name = name,
                isImage = false,
                mimeType = mime,
                sizeBytes = size,
            )
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
) {
    val listState = rememberLazyListState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var attachedFiles by remember { mutableStateOf<List<AttachmentItem>>(emptyList()) }
    var thinkingPickerOpen by remember { mutableStateOf(false) }
    val pickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetMultipleContents(),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val items = withContext(Dispatchers.IO) {
                uris.mapNotNull { uri -> loadAttachment(context, uri) }
            }
            attachedFiles = (attachedFiles + items).take(MAX_ATTACHMENTS)
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
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }
    LaunchedEffect(messages.lastOrNull()?.text) {
        if (messages.isNotEmpty() && !listState.canScrollForward) {
            listState.scrollToItem(messages.lastIndex)
        }
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
        )
        if (!error.isNullOrBlank()) {
            Text(
                error,
                color = OmpColors.StatusError,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            itemsIndexed(
                items = messages,
                key = { index, message -> "${message.role}_${message.timestamp ?: index}_$index" },
            ) { _, message ->
                if (message.role == "user") UserMessage(message) else AssistantMessage(message)
            }
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp)
                .padding(bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
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
            )
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
) {
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
private fun AssistantMessage(message: DisplayMessage) {
    val stamp = remember(message.timestamp) { formatTimestamp(message.timestamp) }
    Column(modifier = Modifier.fillMaxWidth()) {
        MarkdownText(text = message.text, modifier = Modifier.fillMaxWidth())
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
