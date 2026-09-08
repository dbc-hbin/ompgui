package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import java.net.URI
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

private val Mono = FontFamily.Monospace

/** Max nested blockquote level; deeper `>` markers render as plain text. */
private const val MaxQuoteDepth = 3

// ---------------------------------------------------------------------------
// Block model + parser (pure Kotlin, no composition).
// ---------------------------------------------------------------------------

internal sealed interface MdBlock {
    data class Heading(val level: Int, val text: String) : MdBlock
    data class Paragraph(val text: String) : MdBlock
    data class Code(val lang: String, val code: String) : MdBlock
    data class Quote(val text: String) : MdBlock
    data class Bullets(val items: List<String>) : MdBlock
    data class Ordered(val items: List<String>) : MdBlock
    data class Table(val header: List<String>, val rows: List<List<String>>) : MdBlock
    data object Rule : MdBlock
}

internal sealed interface InlineSeg {
    data class Rich(val text: String, val bold: Boolean, val italic: Boolean) : InlineSeg
    data class Code(val text: String) : InlineSeg
    data class Link(val text: String, val target: String) : InlineSeg
}

private val BulletPattern = Regex("^[-*]\\s+(.*)$")
private val OrderedPattern = Regex("^(\\d+)[.)]\\s+(.*)$")
private val HeadingPattern = Regex("^(#{1,3})\\s+(.*)$")
private val TableSeparatorPattern = Regex("^\\|?[\\s:|\\-]+\\|?$")

private fun bulletOf(trimmed: String): String? =
    BulletPattern.matchEntire(trimmed)?.groupValues?.get(1)

private fun orderedOf(trimmed: String): String? =
    OrderedPattern.matchEntire(trimmed)?.groupValues?.get(2)

private fun splitRow(trimmed: String): List<String> =
    trimmed.trim().trim('|').split('|').map { it.trim() }

private fun isTableHeader(header: String?, separator: String?): Boolean {
    if (header.isNullOrBlank() || separator == null) return false
    if (!header.contains('|')) return false
    val sep = separator.trim()
    return sep.contains('-') && TableSeparatorPattern.matches(sep)
}

internal data class MarkdownNavigation(val cwd: String?, val openFile: (String) -> Unit)
internal val LocalMarkdownNavigation = staticCompositionLocalOf<MarkdownNavigation?> { null }

internal sealed interface MarkdownTarget {
    data class Web(val url: String) : MarkdownTarget
    data class File(val path: String) : MarkdownTarget
}

internal fun resolveMarkdownLink(target: String, cwd: String?): MarkdownTarget? {
    val value = target.trim()
    if (value.isEmpty() || value.any { it.code < 32 || it == '\\' } || value.startsWith("//") || value.startsWith("#")) return null
    val uri = try { URI(value.replace(" ", "%20")) } catch (_: Exception) { return null }
    if (uri.scheme != null) {
        if (uri.scheme.lowercase() !in setOf("http", "https") || uri.host.isNullOrBlank() || uri.userInfo != null) return null
        return MarkdownTarget.Web(uri.toASCIIString())
    }
    val path = uri.path ?: return null
    if (path.any { it.code < 32 || it == '\\' } || path.startsWith("//") || Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:").containsMatchIn(path)) return null
    if (cwd.isNullOrBlank() || !cwd.startsWith("/")) return null
    val absolute = if (path.startsWith("/")) path else "${cwd.trimEnd('/')}/$path"
    val parts = mutableListOf<String>()
    for (part in absolute.split('/')) when (part) {
        "", "." -> Unit
        ".." -> if (parts.isNotEmpty()) parts.removeAt(parts.lastIndex)
        else -> parts.add(part)
    }
    // Server files authorization remains the authority for allowed roots and symlinks.
    return MarkdownTarget.File("/" + parts.joinToString("/"))
}

internal fun parseInline(src: String): List<InlineSeg> {
    val out = mutableListOf<InlineSeg>()
    val plain = StringBuilder()
    fun flush() { if (plain.isNotEmpty()) { out.add(InlineSeg.Rich(plain.toString(), false, false)); plain.clear() } }
    var i = 0
    while (i < src.length) {
        if (src[i] == '\\' && i + 1 < src.length && src[i + 1] in "[]()`*\\") { plain.append(src[i + 1]); i += 2; continue }
        if (src[i] == '`') {
            val count = src.substring(i).takeWhile { it == '`' }.length
            val delimiter = "`".repeat(count)
            val end = src.indexOf(delimiter, i + count)
            if (end >= 0) { flush(); out.add(InlineSeg.Code(src.substring(i + count, end))); i = end + count; continue }
        }
        if (src[i] == '[') {
            val labelEnd = src.indexOf("](", i + 1)
            if (labelEnd >= 0) {
                var j = labelEnd + 2
                var depth = 1
                val destination = StringBuilder()
                while (j < src.length && depth > 0) {
                    val c = src[j]
                    if (c == '\\' && j + 1 < src.length) { destination.append(src[j + 1]); j += 2; continue }
                    if (c == '(') depth++
                    if (c == ')') depth--
                    if (depth > 0) destination.append(c)
                    j++
                }
                if (depth == 0) {
                    flush(); out.add(InlineSeg.Link(src.substring(i + 1, labelEnd), destination.toString().removeSurrounding("<", ">"))); i = j; continue
                }
            }
        }
        if (src[i] == '*') {
            val delimiter = if (src.startsWith("**", i)) "**" else "*"
            val end = src.indexOf(delimiter, i + delimiter.length)
            if (end > i + delimiter.length) { flush(); out.add(InlineSeg.Rich(src.substring(i + delimiter.length, end), delimiter.length == 2, delimiter.length == 1)); i = end + delimiter.length; continue }
        }
        plain.append(src[i++])
    }
    flush()
    return out
}

internal fun parseMarkdown(src: String): List<MdBlock> {
    val lines = src.replace("\r\n", "\n").split("\n")
    val blocks = mutableListOf<MdBlock>()
    val para = mutableListOf<String>()
    fun flushPara() {
        if (para.isNotEmpty()) {
            blocks.add(MdBlock.Paragraph(para.joinToString("\n")))
            para.clear()
        }
    }
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val t = line.trim()
        when {
            Regex("^(`{3,}|~{3,})(.*)$").matches(t) -> {
                flushPara()
                val fence = t.takeWhile { it == t.first() }
                val lang = t.drop(fence.length).trim()
                val buf = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().let { closing -> closing.length >= fence.length && closing.all { it == fence.first() } }) {
                    buf.add(lines[i])
                    i++
                }
                blocks.add(MdBlock.Code(lang, buf.joinToString("\n")))
            }
            t.isEmpty() -> flushPara()
            t == "---" || t == "***" -> {
                flushPara()
                blocks.add(MdBlock.Rule)
            }
            HeadingPattern.matches(t) -> {
                flushPara()
                val m = HeadingPattern.matchEntire(t)!!
                blocks.add(MdBlock.Heading(m.groupValues[1].length, m.groupValues[2]))
            }
            t.startsWith(">") -> {
                flushPara()
                val buf = mutableListOf<String>()
                while (i < lines.size && lines[i].trim().startsWith(">")) {
                    buf.add(lines[i].trim().drop(1).trimStart())
                    i++
                }
                blocks.add(MdBlock.Quote(buf.joinToString("\n")))
                continue
            }
            isTableHeader(t, lines.getOrNull(i + 1)) -> {
                flushPara()
                val header = splitRow(t)
                val rows = mutableListOf<List<String>>()
                i += 2
                while (i < lines.size && lines[i].isNotBlank() && lines[i].contains('|')) {
                    rows.add(splitRow(lines[i].trim()))
                    i++
                }
                blocks.add(MdBlock.Table(header, rows))
                continue
            }
            bulletOf(t) != null -> {
                flushPara()
                val items = mutableListOf<String>()
                while (i < lines.size) {
                    val item = bulletOf(lines[i].trim()) ?: break
                    items.add(item)
                    i++
                }
                blocks.add(MdBlock.Bullets(items))
                continue
            }
            orderedOf(t) != null -> {
                flushPara()
                val items = mutableListOf<String>()
                while (i < lines.size) {
                    val item = orderedOf(lines[i].trim()) ?: break
                    items.add(item)
                    i++
                }
                blocks.add(MdBlock.Ordered(items))
                continue
            }
            else -> para.add(line)
        }
        i++
    }
    flushPara()
    return blocks
}

// ---------------------------------------------------------------------------
// Renderer.
// ---------------------------------------------------------------------------

/**
 * Rich markdown renderer in pure Jetpack Compose, styled after the ompgui
 * mobile web UI ([OmpColors]).
 */
@Composable
fun MarkdownText(
    text: String,
    modifier: Modifier = Modifier,
    quoteDepth: Int = 0,
) {
    val blocks = remember(text) { parseMarkdown(text) }
    MdBlocks(blocks = blocks, modifier = modifier, quoteDepth = quoteDepth)
}

@Composable
private fun MdBlocks(
    blocks: List<MdBlock>,
    modifier: Modifier = Modifier,
    quoteDepth: Int = 0,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        blocks.forEach { block ->
            when (block) {
                is MdBlock.Heading -> MdHeading(block)
                is MdBlock.Paragraph -> InlineParagraph(
                    text = block.text,
                    baseSize = 14.sp,
                    baseLineHeight = 22.sp,
                )
                is MdBlock.Code -> MdCodeBlock(lang = block.lang, code = block.code)
                is MdBlock.Quote -> MdQuote(text = block.text, depth = quoteDepth)
                is MdBlock.Bullets -> MdBullets(items = block.items)
                is MdBlock.Ordered -> MdOrdered(items = block.items)
                is MdBlock.Table -> MdTable(header = block.header, rows = block.rows)
                MdBlock.Rule -> HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
            }
        }
    }
}

@Composable
private fun MdHeading(block: MdBlock.Heading) {
    val size = when (block.level) {
        1 -> 18.sp
        2 -> 16.sp
        else -> 14.sp
    }
    InlineParagraph(
        text = block.text,
        baseSize = size,
        baseLineHeight = (size.value + 8).sp,
        forceBold = true,
    )
}

@Composable
private fun InlineParagraph(
    text: String,
    modifier: Modifier = Modifier,
    baseSize: TextUnit = 14.sp,
    baseLineHeight: TextUnit = 22.sp,
    forceBold: Boolean = false,
) {
    val segs = remember(text) { parseInline(text) }
    val navigation = LocalMarkdownNavigation.current
    val uriHandler = LocalUriHandler.current
    Text(
        text = buildAnnotatedString {
            segs.forEach { seg ->
                when (seg) {
                    is InlineSeg.Rich -> withStyle(SpanStyle(
                        fontWeight = if (seg.bold || forceBold) FontWeight.Bold else null,
                        fontStyle = if (seg.italic) FontStyle.Italic else null,
                        color = if (seg.italic && !seg.bold) OmpColors.TextMuted else OmpColors.Text,
                    )) { append(seg.text) }
                    is InlineSeg.Code -> withStyle(SpanStyle(fontFamily = Mono, color = OmpColors.Text, background = OmpColors.ToolBg)) { append(seg.text) }
                    is InlineSeg.Link -> {
                        val target = resolveMarkdownLink(seg.target, navigation?.cwd)
                        if (target == null) append(seg.text) else withLink(LinkAnnotation.Clickable(
                            tag = seg.target,
                            styles = TextLinkStyles(style = SpanStyle(color = OmpColors.Accent, textDecoration = TextDecoration.Underline)),
                            linkInteractionListener = {
                                when (target) {
                                    is MarkdownTarget.File -> navigation?.openFile?.invoke(target.path)
                                    is MarkdownTarget.Web -> try { uriHandler.openUri(target.url) } catch (_: IllegalArgumentException) { }
                                }
                            },
                        )) { append(seg.text) }
                    }
                }
            }
        },
        modifier = modifier,
        fontSize = baseSize,
        lineHeight = baseLineHeight,
        color = OmpColors.Text,
    )
}

@Composable
private fun MdCodeBlock(lang: String, code: String) {
    val clipboard = LocalClipboardManager.current
    var copied by remember(code) { mutableStateOf(false) }
    var showSource by remember(code, lang) { mutableStateOf(false) }
    val hasPreview = lang.equals("mermaid", ignoreCase = true)
    LaunchedEffect(copied) {
        if (copied) {
            delay(1500)
            copied = false
        }
    }
    val shape = RoundedCornerShape(8.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .border(1.dp, OmpColors.Border, shape)
            .background(OmpColors.CodeBg),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(OmpColors.BgPanel)
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = lang.ifBlank { "code" },
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                fontFamily = Mono,
                fontSize = 11.sp,
                lineHeight = 16.sp,
                color = OmpColors.TextMuted,
            )
            Row(
                modifier = Modifier
                    .heightIn(min = 48.dp)
                    .widthIn(min = 48.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .clickable(role = androidx.compose.ui.semantics.Role.Button) {
                        clipboard.setText(AnnotatedString(code))
                        copied = true
                    }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Filled.ContentCopy,
                    contentDescription = null,
                    modifier = Modifier.size(12.dp),
                    tint = OmpColors.TextMuted,
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = if (copied) "Copied" else "Copy",
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                    color = OmpColors.TextMuted,
                )
            }
        }
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        if (hasPreview) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("Preview", "Source").forEach { label ->
                    val selected = (label == "Source") == showSource
                    androidx.compose.material3.TextButton(
                        onClick = { showSource = label == "Source" },
                        modifier = Modifier.weight(1f).background(if (selected) OmpColors.BgSelected else OmpColors.CodeBg, RoundedCornerShape(8.dp)),
                    ) { Text(label, fontSize = 12.sp, color = if (selected) OmpColors.Text else OmpColors.TextMuted) }
                }
            }
        }
        RichPreview(
            content = code,
            kind = if (hasPreview && !showSource) RichPreviewKind.Mermaid else RichPreviewKind.Code,
            language = lang,
            compactCode = true,
            modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp),
        )
    }
}

@Composable
private fun MdTable(header: List<String>, rows: List<List<String>>) {
    val shape = RoundedCornerShape(8.dp)
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val tableWidth = maxOf(maxWidth, 120.dp * header.size.coerceAtLeast(1))
        Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            Column(Modifier.width(tableWidth).clip(shape).border(1.dp, OmpColors.Border, shape)) {
                MdTableRow(cells = header, background = OmpColors.ToolBg, header = true)
                rows.forEachIndexed { index, row ->
                    HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
                    val normalized = if (row.size > header.size) row.take(header.size)
                        else row + List(maxOf(0, header.size - row.size)) { "" }
                    MdTableRow(cells = normalized, background = if (index % 2 == 1) OmpColors.BgHover else OmpColors.Bg, header = false)
                }
            }
        }
    }
}

@Composable
private fun MdTableRow(
    cells: List<String>,
    background: androidx.compose.ui.graphics.Color,
    header: Boolean,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(background),
    ) {
        cells.forEach { cell ->
            InlineParagraph(
                text = cell,
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                baseSize = 13.sp,
                baseLineHeight = 19.sp,
                forceBold = header,
            )
        }
    }
}

@Composable
private fun MdBullets(items: List<String>) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        items.forEach { item ->
            Row(modifier = Modifier.fillMaxWidth()) {
                Box(
                    modifier = Modifier
                        .padding(top = 8.dp)
                        .size(6.dp)
                        .clip(RoundedCornerShape(50))
                        .background(OmpColors.TextMuted),
                )
                Spacer(modifier = Modifier.width(8.dp))
                InlineParagraph(
                    text = item,
                    modifier = Modifier.weight(1f),
                    baseSize = 14.sp,
                    baseLineHeight = 22.sp,
                )
            }
        }
    }
}

@Composable
private fun MdOrdered(items: List<String>) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        items.forEachIndexed { index, item ->
            Row(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "${index + 1}.",
                    modifier = Modifier.widthIn(min = 24.dp).padding(end = 8.dp).alignByBaseline(),
                    maxLines = 1,
                    softWrap = false,
                    fontSize = 14.sp,
                    lineHeight = 22.sp,
                    fontWeight = FontWeight.Normal,
                    color = OmpColors.TextMuted,
                )
                InlineParagraph(
                    text = item,
                    modifier = Modifier.weight(1f).alignByBaseline(),
                    baseSize = 14.sp,
                    baseLineHeight = 22.sp,
                )
            }
        }
    }
}

@Composable
private fun MdQuote(text: String, depth: Int = 0) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clip(RoundedCornerShape(4.dp))
            .background(OmpColors.BgPanel),
    ) {
        Box(
            modifier = Modifier
                .width(3.dp)
                .fillMaxHeight()
                .background(OmpColors.Border),
        )
        if (depth >= MaxQuoteDepth) {
            // At max depth: render excess `>` markers as plain text instead of
            // recursing, so adversarial `>>>>...` input cannot overflow.
            InlineParagraph(
                text = text,
                modifier = Modifier
                    .weight(1f)
                    .padding(8.dp),
                baseSize = 14.sp,
                baseLineHeight = 22.sp,
            )
        } else {
            val inner = remember(text) { parseMarkdown(text) }
            MdBlocks(
                blocks = inner,
                modifier = Modifier
                    .weight(1f)
                    .padding(8.dp),
                quoteDepth = depth + 1,
            )
        }
    }
}
