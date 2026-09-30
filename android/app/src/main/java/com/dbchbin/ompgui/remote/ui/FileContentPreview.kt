package com.dbchbin.ompgui.remote.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.media.MediaPlayer
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlin.math.abs
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
            kind == "text" -> RichPreviewViewer(text, if (extension in setOf("html", "htm")) RichPreviewKind.Html else RichPreviewKind.Code,
                file.optString("name"), language = when (extension) {
                    "kt", "kts" -> "kotlin"; "js", "mjs", "cjs" -> "javascript"; "ts" -> "typescript"; "py" -> "python"
                    "rs" -> "rust"; "sh" -> "bash"; "yml" -> "yaml"; else -> extension
                })
            html != null -> RichPreviewViewer(checkNotNull(html), RichPreviewKind.Html, file.optString("name"))
            uri != null && kind == "image" && mime != "image/svg+xml" -> RasterPreview(checkNotNull(uri), file.optString("name"))
            uri != null && kind == "pdf" -> PdfPreview(checkNotNull(uri))
            uri != null && kind == "audio" -> AudioPreview(checkNotNull(uri))
            kind in setOf("image", "audio", "pdf", "docx") && failure == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
            failure == null -> Text(stringResource(R.string.file_preview_none))
        }
    }
    }
}

/** Sheet-sized rich viewer with a wrap toggle (code) and a fullscreen dialog sharing the same state. */
@Composable
private fun RichPreviewViewer(content: String, kind: RichPreviewKind, name: String, language: String = "") {
    var wrapLines by rememberSaveable { mutableStateOf(false) }
    var fullscreen by rememberSaveable { mutableStateOf(false) }
    val wrapToggle: @Composable () -> Unit = {
        if (kind == RichPreviewKind.Code) FilterChip(selected = wrapLines, onClick = { wrapLines = !wrapLines },
            label = { Text(stringResource(R.string.file_ux_wrap_lines)) }, modifier = Modifier.heightIn(min = 48.dp))
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.End) {
        wrapToggle()
        IconButton(onClick = { fullscreen = true }, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Default.Fullscreen, stringResource(R.string.file_ux_fullscreen), tint = OmpColors.TextMuted)
        }
    }
    // The inline WebView stays composed underneath so returning keeps its scroll position.
    RichPreview(content, kind, Modifier.fillMaxWidth().height(420.dp), language = language, wrapLines = wrapLines)
    if (fullscreen) Dialog(onDismissRequest = { fullscreen = false },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        OmpDialogSystemBars(edgeToEdgeSheet = true)
        Column(Modifier.fillMaxSize().background(OmpColors.Bg).windowInsetsPadding(WindowInsets.safeDrawing)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(horizontal = 8.dp))
                wrapToggle()
                IconButton(onClick = { fullscreen = false }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Close, stringResource(R.string.file_ux_close_fullscreen), tint = OmpColors.TextMuted)
                }
            }
            HorizontalDivider(color = OmpColors.Border)
            RichPreview(content, kind, Modifier.fillMaxWidth().weight(1f), language = language, wrapLines = wrapLines)
        }
    }
}

private const val MaxZoom = 5f
private const val DoubleTapZoom = 2.5f

/**
 * Pinch-zoom (1x..5x), clamped pan and double-tap 1x/2.5x for a bitmap. State is keyed by the
 * bitmap, so a new page/image always starts unzoomed. At 1x single-finger drags are left to the
 * parent list; [onSwipe] (-1 previous, +1 next) fires for a clear one-finger horizontal fling.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun ZoomableBitmap(bitmap: Bitmap, description: String, modifier: Modifier, onSwipe: ((Int) -> Unit)? = null) {
    var scale by remember(bitmap) { mutableFloatStateOf(1f) }
    var offset by remember(bitmap) { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    val image = remember(bitmap) { bitmap.asImageBitmap() }
    val swipeThreshold = with(LocalDensity.current) { 64.dp.toPx() }
    val latestSwipe by rememberUpdatedState(onSwipe)
    fun clamp(value: Offset, zoom: Float): Offset {
        val maxX = viewport.width * (zoom - 1f) / 2f
        val maxY = viewport.height * (zoom - 1f) / 2f
        return Offset(value.x.coerceIn(-maxX, maxX), value.y.coerceIn(-maxY, maxY))
    }
    val transform = rememberTransformableState { zoomChange, panChange, _ ->
        val next = (scale * zoomChange).coerceIn(1f, MaxZoom)
        offset = clamp(offset * (next / scale) + panChange, next)
        scale = next
    }
    // Installed once per bitmap; zoom is checked when the gesture ends so pinch frames never
    // recompose this function (scale is read only in layer/gesture lambdas).
    val swipe = if (onSwipe == null) Modifier else Modifier.pointerInput(bitmap) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            var total = Offset.Zero
            var multiTouch = false
            while (true) {
                val event = awaitPointerEvent()
                if (event.changes.count { it.pressed } > 1) multiTouch = true
                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                total = change.position - down.position
                if (!change.pressed) break
            }
            // Observe only: vertical list scrolling and pinch keep their own consumers.
            if (scale == 1f && !multiTouch && abs(total.x) > swipeThreshold && abs(total.x) > 2 * abs(total.y)) {
                latestSwipe?.invoke(if (total.x < 0) 1 else -1)
            }
        }
    }
    Image(image, description, modifier
        .clipToBounds()
        .onSizeChanged { viewport = it }
        .pointerInput(bitmap) {
            detectTapGestures(onDoubleTap = { tap ->
                if (scale > 1f) { scale = 1f; offset = Offset.Zero }
                else {
                    // Keep the tapped point under the finger while zooming in.
                    val center = Offset(viewport.width / 2f, viewport.height / 2f)
                    offset = clamp((center - tap) * (DoubleTapZoom - 1f), DoubleTapZoom)
                    scale = DoubleTapZoom
                }
            })
        }
        .then(swipe)
        .transformable(transform, canPan = { scale > 1f })
        .graphicsLayer { scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y })
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
    bitmap?.let { ZoomableBitmap(it, name, Modifier.fillMaxWidth().heightIn(max = 420.dp).padding(12.dp)) }
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
    bitmap?.let { ZoomableBitmap(it, stringResource(R.string.file_preview_pdf_page, page + 1), Modifier.fillMaxWidth().height(420.dp).padding(4.dp),
        onSwipe = { delta -> if (page + delta in 0 until count) page += delta }) }
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
