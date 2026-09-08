package com.dbchbin.ompgui.remote.ui

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.key
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

enum class RichPreviewKind { Html, Code, Mermaid }

private const val PreviewOrigin = "https://preview.invalid/"

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun RichPreview(
    content: String,
    kind: RichPreviewKind,
    modifier: Modifier = Modifier,
    language: String = "",
    compactCode: Boolean = false,
) {
    val context = LocalContext.current
    val textZoom = (LocalDensity.current.fontScale * 100).toInt()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val navigation = LocalMarkdownNavigation.current
    val currentNavigation = rememberUpdatedState(navigation)
    val uriHandler = rememberUpdatedState(LocalUriHandler.current)
    // Interception runs off the UI thread; publish the URL and bytes together.
    val localDocument = remember(context, kind) { AtomicReference<Pair<String, ByteArray>?>(null) }
    val webView = remember(context, kind) {
        WebView(context).apply {
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            contentDescription = when (kind) {
                RichPreviewKind.Html -> "Document preview"
                RichPreviewKind.Code -> "Highlighted code"
                RichPreviewKind.Mermaid -> "Mermaid diagram and source"
            }
            settings.apply {
                javaScriptEnabled = kind != RichPreviewKind.Html
                allowFileAccess = false
                allowContentAccess = false
                domStorageEnabled = false
                databaseEnabled = false
                blockNetworkLoads = true
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
                mediaPlaybackRequiresUserGesture = true
                builtInZoomControls = true
                displayZoomControls = false
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                    val url = request.url.toString()
                    val current = localDocument.get()
                    if (request.isForMainFrame && request.method == "GET" && current != null && url == current.first) {
                        return WebResourceResponse("text/html", "UTF-8", 200, "OK",
                            mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(current.second))
                    }
                    val asset = when {
                        kind == RichPreviewKind.Mermaid && url == "${PreviewOrigin}mermaid.min.js" -> "preview/mermaid.min.js"
                        kind == RichPreviewKind.Code && url == "${PreviewOrigin}prism.min.js" -> "preview/prism.min.js"
                        else -> null
                    }
                    if (asset != null) {
                        try {
                            return WebResourceResponse("application/javascript", "UTF-8", context.assets.open(asset))
                        } catch (_: java.io.IOException) {
                            // The visible source/error state remains usable if packaging failed.
                        }
                    }
                    return WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                }
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.isForMainFrame && request.hasGesture()) {
                        val url = request.url.toString()
                        val target = if (url.startsWith(PreviewOrigin)) {
                            if (url.substringBefore('#') == localDocument.get()?.first) return true
                            "/" + url.removePrefix(PreviewOrigin)
                        } else url
                        when (val resolved = resolveMarkdownLink(target, currentNavigation.value?.cwd)) {
                            is MarkdownTarget.File -> currentNavigation.value?.openFile?.invoke(resolved.path)
                            is MarkdownTarget.Web -> try { uriHandler.value.openUri(resolved.url) } catch (_: IllegalArgumentException) { }
                            null -> Unit
                        }
                    }
                    return true
                }
            }
        }
    }
    val document = remember(content, kind, language, compactCode, OmpColors.dark, OmpColors.warm) {
        richPreviewDocument(content, kind, language, compactCode)
    }
    DisposableEffect(webView, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> webView.onResume()
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> webView.onPause()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (!lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) webView.onPause()
        onDispose {
            lifecycle.removeObserver(observer)
            webView.stopLoading()
            webView.onPause()
            webView.removeAllViews()
            webView.destroy()
        }
    }
    // Code never wraps: match its 13px × 1.6 CSS line height, body padding
    // and 8px scrollbar clearance without allocating a line list.
    // Caller constraints still win (the file viewer deliberately reserves a viewport).
    val previewModifier = if (kind == RichPreviewKind.Code) {
        val lineCount = remember(content) { 1 + content.count { it == '\n' } }
        val verticalInsets = if (compactCode) 20f else 32f
        val codeHeight = (verticalInsets + lineCount * 13f * 1.6f * textZoom / 100f)
            .coerceIn(if (compactCode) 32f else 48f, 420f)
        modifier.height(codeHeight.dp)
    } else modifier.heightIn(min = 160.dp)
    key(webView) {
    AndroidView(
        factory = { webView },
        modifier = previewModifier,
        update = { view ->
            if (view.settings.textZoom != textZoom) view.settings.textZoom = textZoom
            val documentKey = document to navigation?.cwd
            if (view.tag != documentKey) {
                view.tag = documentKey
                // loadDataWithBaseURL's synthetic main request also reaches interception;
                // denying it replaces the document with Chromium's HTTP error page.
                // Give each document an exact local URL instead of exempting arbitrary data URLs.
                val url = android.net.Uri.parse(PreviewOrigin).buildUpon()
                    .path(navigation?.cwd?.trimEnd('/').orEmpty() + "/")
                    .appendQueryParameter("document", UUID.randomUUID().toString()).build().toString()
                localDocument.set(url to document.toByteArray(Charsets.UTF_8))
                view.loadUrl(url)
            }
        },
    )
    }
}

private fun escapePreviewHtml(value: String): String = value.replace("&", "&amp;")
    .replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")

internal fun richPreviewDocument(content: String, kind: RichPreviewKind, language: String, compactCode: Boolean = false): String {
    val nonce = UUID.randomUUID().toString()
    val background = "#%06x".format((if (kind == RichPreviewKind.Code) OmpColors.CodeBg else OmpColors.BgPanel).toArgb() and 0xffffff)
    val foreground = "#%06x".format(OmpColors.Text.toArgb() and 0xffffff)
    val accent = "#%06x".format(OmpColors.Accent.toArgb() and 0xffffff)
    val muted = "#%06x".format(OmpColors.TextMuted.toArgb() and 0xffffff)
    val success = "#%06x".format(OmpColors.StatusSuccess.toArgb() and 0xffffff)
    val warning = "#%06x".format(OmpColors.StatusWarning.toArgb() and 0xffffff)
    val border = "#%06x".format(OmpColors.Border.toArgb() and 0xffffff)
    val panel = "#%06x".format(OmpColors.BgPanel.toArgb() and 0xffffff)
    val style = "html{background:$background;color-scheme:${if (OmpColors.dark) "dark" else "light"}}body{margin:0;padding:${if (compactCode && kind == RichPreviewKind.Code) "6px 12px" else "12px"};background:$background;color:$foreground;font:14px/1.6 system-ui,sans-serif;overflow-wrap:anywhere}pre{margin:0;padding:${if (kind == RichPreviewKind.Html) "12px" else "0"};white-space:pre;overflow:auto;overflow-wrap:normal;tab-size:4;font:13px/1.6 monospace;background:$background}code{font-family:monospace}img,svg{max-width:100%;height:auto}a{color:$accent}h1,h2,h3{line-height:1.3}h1{font-size:22px}h2{font-size:18px}h3{font-size:16px}table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}td,th{padding:6px 10px;border:1px solid $border}blockquote{margin:12px 0;padding:0 12px;border-left:2px solid $border;color:$muted}#status{font-size:12px;color:$muted}#diagram-output:not(:empty){padding:12px;background:$panel;border:1px solid $border;border-radius:8px;margin-bottom:12px;overflow:auto}*{animation:none!important;transition:none!important;scroll-behavior:auto!important}.token.comment,.token.prolog{color:$muted}.token.keyword,.token.operator{color:$accent}.token.string,.token.attr-value{color:$success}.token.number,.token.boolean{color:$warning}.token.function,.token.tag{color:$accent}iframe{border:0;width:100%;height:100vh}"
    val policy = "default-src 'none'; script-src ${if (kind == RichPreviewKind.Html) "'none'" else "'nonce-$nonce'"}; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    val label = when (kind) {
        RichPreviewKind.Code -> "Highlighted code"
        RichPreviewKind.Mermaid -> "Mermaid diagram"
        RichPreviewKind.Html -> "Document preview"
    }
    val head = "<!doctype html><html><head><title>$label</title><meta name=viewport content=\"width=device-width,initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"$policy\"><style>$style</style></head><body role=document aria-label=\"$label\">"
    if (kind == RichPreviewKind.Html) return head + content + "</body></html>"
    // JSON strings additionally escape HTML delimiters: a closing script tag can never escape data.
    val source = JSONObject.quote(content).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    val lang = JSONObject.quote(language.lowercase().takeIf { it.matches(Regex("[a-z0-9_-]{0,40}")) } ?: "")
    val script = if (kind == RichPreviewKind.Code) {
        "const source=$source;const code=document.getElementById('source');code.textContent=source;const language=$lang;if(window.Prism){const grammar=Prism.languages[language];if(grammar)code.innerHTML=Prism.highlight(source,grammar,language);document.getElementById('status').remove();}"
    } else {
        """const source=$source;document.getElementById('source').textContent=source;
        (async()=>{try{if(!window.mermaid)throw new Error('Offline renderer unavailable');
        mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:'base',themeVariables:{darkMode:${OmpColors.dark},background:'$background',primaryColor:'$panel',primaryTextColor:'$foreground',primaryBorderColor:'$border',lineColor:'$muted',secondaryColor:'$panel',tertiaryColor:'$background',fontFamily:'system-ui, sans-serif',fontSize:'14px'},maxTextSize:100000,flowchart:{htmlLabels:false},secure:['securityLevel','startOnLoad','maxTextSize','suppressErrorRendering']});
        const result=await mermaid.render('diagram',source);document.getElementById('diagram-output').innerHTML=result.svg;
        document.getElementById('status').remove();}catch(error){document.getElementById('status').textContent='Diagram could not render. Check Mermaid syntax or copy the source below. '+String(error.message||error);}})();"""
    }
    val bundle = if (kind == RichPreviewKind.Code) "prism.min.js" else "mermaid.min.js"
    val diagramOutput = if (kind == RichPreviewKind.Mermaid) "<div id=diagram-output role=img aria-label=\"Mermaid diagram\"></div>" else ""
    return head + "<p id=status role=status>Loading offline renderer. If this persists, reopen the preview; source is below.</p>$diagramOutput<pre><code id=source>${escapePreviewHtml(content)}</code></pre><script nonce=\"$nonce\" src=\"$PreviewOrigin$bundle\"></script><script nonce=\"$nonce\">$script</script></body></html>"
}
