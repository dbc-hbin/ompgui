package com.dbchbin.ompgui.remote.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.media.MediaPlayer
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.dbchbin.ompgui.remote.R
import com.dbchbin.ompgui.remote.relay.RelayRequester
import com.dbchbin.ompgui.remote.relay.createCachedDownload
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal fun shouldRefreshFile(loadedRevision: String, serverRevision: String, dirty: Boolean): Boolean =
    !dirty && loadedRevision.isNotBlank() && serverRevision != loadedRevision

@Composable
fun FileContentPreview(
    requester: RelayRequester,
    file: JSONObject,
    text: String,
    cached: Uri?,
    onCached: (Uri) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val path = file.getString("path")
    val revision = file.getString("revision")
    val kind = file.optString("previewKind")
    val mime = file.optString("mime")
    val extension = file.optString("name").substringAfterLast('.', "").lowercase()
    var uri by remember(path, revision) { mutableStateOf(cached) }
    var html by remember(path, revision) { mutableStateOf<String?>(null) }
    var failure by remember(path, revision) { mutableStateOf<String?>(null) }
    val latestOnCached by rememberUpdatedState(onCached)
    LaunchedEffect(requester, path, revision) {
        try {
            if (kind == "docx") {
                val result = requester.request("files", "preview", JSONObject().put("path", path).put("revision", revision))
                currentCoroutineContext().ensureActive()
                require(result.getString("revision") == revision) { context.getString(R.string.file_preview_document_changed) }
                html = result.getString("html")
            } else if (kind in setOf("image", "audio", "pdf")) {
                val downloaded = uri ?: run {
                    val begin = requester.request("files", "downloadBegin", JSONObject().put("path", path))
                    val id = begin.getString("transferId")
                    try {
                        createCachedDownload(context, begin.getString("name")) { offset ->
                            requester.request("files", "downloadChunk", JSONObject().put("transferId", id).put("offset", offset).put("length", 131072))
                        }
                    } finally {
                        withContext(NonCancellable) { runCatching { requester.request("files", "downloadClose", JSONObject().put("transferId", id)) } }
                    }
                }
                currentCoroutineContext().ensureActive()
                val current = requester.request("files", "meta", JSONObject().put("path", path))
                require(current.getString("revision") == revision) { context.getString(R.string.file_preview_file_changed) }
                currentCoroutineContext().ensureActive()
                uri = downloaded
                latestOnCached(downloaded)
                if (mime == "image/svg+xml") {
                    html = withContext(Dispatchers.IO) {
                        context.contentResolver.openInputStream(downloaded)?.bufferedReader()?.use { reader ->
                            val buffer = CharArray(1_048_577)
                            var count = 0
                            while (count < buffer.size) {
                                val read = reader.read(buffer, count, buffer.size - count)
                                if (read < 0) break
                                count += read
                            }
                            require(count <= 1_048_576) { context.getString(R.string.file_preview_svg_limit) }
                            String(buffer, 0, count)
                        } ?: error(context.getString(R.string.file_preview_cannot_read_svg))
                    }
                }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { failure = error.message ?: context.getString(R.string.file_preview_failed) }
    }
    val navigation = LocalMarkdownNavigation.current
    CompositionLocalProvider(LocalMarkdownNavigation provides navigation?.copy(cwd = path.substringBeforeLast('/', "/"))) {
    Column(modifier.fillMaxWidth().background(OmpColors.BgPanel, MaterialTheme.shapes.small), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        when {
            kind == "text" && extension in setOf("md", "markdown", "mdown") -> {
                MarkdownText(text, Modifier.fillMaxWidth().padding(12.dp))
            }
            kind == "text" -> RichPreview(text, if (extension in setOf("html", "htm")) RichPreviewKind.Html else RichPreviewKind.Code,
                Modifier.fillMaxWidth().height(420.dp), language = when (extension) {
                    "kt", "kts" -> "kotlin"; "js", "mjs", "cjs" -> "javascript"; "ts" -> "typescript"; "py" -> "python"
                    "rs" -> "rust"; "sh" -> "bash"; "yml" -> "yaml"; else -> extension
                })
            html != null -> RichPreview(checkNotNull(html), RichPreviewKind.Html, Modifier.fillMaxWidth().height(420.dp))
            uri != null && kind == "image" && mime != "image/svg+xml" -> RasterPreview(checkNotNull(uri), file.optString("name"))
            uri != null && kind == "pdf" -> PdfPreview(checkNotNull(uri))
            uri != null && kind == "audio" -> AudioPreview(checkNotNull(uri))
            kind in setOf("image", "audio", "pdf", "docx") && failure == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
            failure == null -> Text(stringResource(R.string.file_preview_none))
        }
    }
    }
}

@Composable
private fun RasterPreview(uri: Uri, name: String) {
    val context = LocalContext.current
    var bitmap by remember(uri) { mutableStateOf<Bitmap?>(null) }
    var failure by remember(uri) { mutableStateOf<String?>(null) }
    LaunchedEffect(uri) {
        try {
            bitmap = withContext(Dispatchers.IO) {
                val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
                require(options.outWidth > 0 && options.outHeight > 0) { context.getString(R.string.file_preview_corrupt_image) }
                options.inSampleSize = 1
                while (options.outWidth / options.inSampleSize > 2048 || options.outHeight / options.inSampleSize > 2048) options.inSampleSize *= 2
                options.inJustDecodeBounds = false
                context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
                    ?: error(context.getString(R.string.file_preview_cannot_decode))
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { failure = error.message }
    }
    if (bitmap == null && failure == null) LinearProgressIndicator(Modifier.fillMaxWidth())
    bitmap?.let { Image(it.asImageBitmap(), name, Modifier.fillMaxWidth().heightIn(max = 420.dp).padding(12.dp)) }
    failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
}

@Composable
private fun PdfPreview(uri: Uri) {
    val context = LocalContext.current
    var page by remember(uri) { mutableIntStateOf(0) }
    var count by remember(uri) { mutableIntStateOf(0) }
    var bitmap by remember(uri) { mutableStateOf<Bitmap?>(null) }
    var failure by remember(uri) { mutableStateOf<String?>(null) }
    LaunchedEffect(uri, page) {
        bitmap = null; failure = null
        try {
            val rendered = withContext(Dispatchers.IO) {
                val descriptor = context.contentResolver.openFileDescriptor(uri, "r") ?: error(context.getString(R.string.file_preview_cannot_open_pdf))
                descriptor.use { PdfRenderer(it).use { renderer ->
                    renderer.openPage(page).use { pdfPage ->
                        val scale = minOf(2f, 1600f / maxOf(pdfPage.width, pdfPage.height))
                        val image = Bitmap.createBitmap((pdfPage.width * scale).toInt().coerceAtLeast(1),
                            (pdfPage.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
                        image.eraseColor(android.graphics.Color.WHITE)
                        pdfPage.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        image to renderer.pageCount
                    }
                } }
            }
            bitmap = rendered.first; count = rendered.second
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) { failure = error.message ?: context.getString(R.string.file_preview_pdf_failed) }
    }
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).background(OmpColors.BgPanel), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center) {
        IconButton(enabled = page > 0, onClick = { page-- }, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Default.ChevronLeft, stringResource(R.string.file_preview_prev_page), tint = if (page > 0) OmpColors.Text else OmpColors.TextDim)
        }
        Text(if (count > 0) stringResource(R.string.file_preview_page_of, page + 1, count) else stringResource(R.string.file_preview_loading_pdf), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted)
        IconButton(enabled = page + 1 < count, onClick = { page++ }, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Default.ChevronRight, stringResource(R.string.file_preview_next_page), tint = if (page + 1 < count) OmpColors.Text else OmpColors.TextDim)
        }
    }
    if (bitmap == null && failure == null) LinearProgressIndicator(Modifier.fillMaxWidth())
    bitmap?.let { Image(it.asImageBitmap(), stringResource(R.string.file_preview_pdf_page, page + 1), Modifier.fillMaxWidth().height(420.dp).padding(4.dp)) }
    failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
}

@Composable
private fun AudioPreview(uri: Uri) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val lifecycleState by lifecycle.currentStateFlow.collectAsState()
    var player by remember(uri) { mutableStateOf<MediaPlayer?>(null) }
    var ready by remember(uri) { mutableStateOf(false) }
    var playing by remember(uri) { mutableStateOf(false) }
    var failure by remember(uri) { mutableStateOf<String?>(null) }
    DisposableEffect(uri, lifecycle) {
        val media = MediaPlayer()
        player = media
        media.setOnPreparedListener { ready = true }
        media.setOnCompletionListener { playing = false }
        media.setOnErrorListener { _, what, extra -> failure = context.getString(R.string.file_preview_audio_failed_code, what, extra); ready = false; playing = false; true }
        try { media.setDataSource(context, uri); media.prepareAsync() }
        catch (error: Exception) { failure = error.message ?: context.getString(R.string.file_preview_cannot_open_audio) }
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && playing) { media.pause(); playing = false }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); media.release(); player = null }
    }
    if (!ready && failure == null) {
        LinearProgressIndicator(Modifier.fillMaxWidth())
        Text(stringResource(R.string.file_preview_preparing_audio), style = MaterialTheme.typography.bodySmall, color = OmpColors.TextMuted, modifier = Modifier.padding(horizontal = 12.dp))
    }
    TextButton(modifier = Modifier.heightIn(min = 48.dp), enabled = ready && lifecycleState.isAtLeast(Lifecycle.State.STARTED), onClick = {
        try { if (playing) player?.pause() else player?.start(); playing = !playing }
        catch (error: Exception) { failure = error.message ?: context.getString(R.string.file_preview_audio_failed) }
    }) { Text(stringResource(if (playing) R.string.file_preview_pause else R.string.file_preview_play)) }
    failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
}
