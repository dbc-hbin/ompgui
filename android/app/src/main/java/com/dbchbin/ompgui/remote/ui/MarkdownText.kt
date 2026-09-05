package com.dbchbin.ompgui.remote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
}

private val BulletPattern = Regex("^[-*]\\s+(.*)$")
private val OrderedPattern = Regex("^(\\d+)[.)]\\s+(.*)$")
private val HeadingPattern = Regex("^(#{1,3})\\s+(.*)$")
private val TableSeparatorPattern = Regex("^\\|?[\\s:|\\-]+\\|?$")
private val InlineTokenPattern = Regex("(`[^`\\n]+`)|(\\*\\*.+?\\*\\*)|(\\*[^*\\n]+?\\*)")

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

internal fun parseInline(src: String): List<InlineSeg> {
    if (src.isEmpty()) return emptyList()
    val out = mutableListOf<InlineSeg>()
    var cursor = 0
    for (m in InlineTokenPattern.findAll(src)) {
        if (m.range.first > cursor) {
            out.add(InlineSeg.Rich(src.substring(cursor, m.range.first), bold = false, italic = false))
        }
        val token = m.value
        when {
            token.startsWith("`") ->
                out.add(InlineSeg.Code(token.drop(1).dropLast(1)))
            token.startsWith("**") ->
                out.add(InlineSeg.Rich(token.drop(2).dropLast(2), bold = true, italic = false))
            else ->
                out.add(InlineSeg.Rich(token.drop(1).dropLast(1), bold = false, italic = true))
        }
        cursor = m.range.last + 1
    }
    if (cursor < src.length) {
        out.add(InlineSeg.Rich(src.substring(cursor), bold = false, italic = false))
    }
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
            t.startsWith("```") -> {
                flushPara()
                val lang = t.drop(3).trim()
                val buf = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().startsWith("```")) {
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
    if (segs.none { it is InlineSeg.Code }) {
        Text(
            text = buildAnnotatedString {
                segs.forEach { seg ->
                    if (seg is InlineSeg.Rich) {
                        withStyle(
                            androidx.compose.ui.text.SpanStyle(
                                fontWeight = if (seg.bold || forceBold) FontWeight.Bold else null,
                                fontStyle = if (seg.italic) FontStyle.Italic else null,
                                color = if (seg.italic && !seg.bold) OmpColors.TextMuted else OmpColors.Text,
                            ),
                        ) {
                            append(seg.text)
                        }
                    }
                }
            },
            modifier = modifier,
            fontSize = baseSize,
            lineHeight = baseLineHeight,
            color = OmpColors.Text,
        )
    } else {
        @OptIn(ExperimentalLayoutApi::class)
        FlowRow(modifier = modifier) {
            segs.forEach { seg ->
                when (seg) {
                    is InlineSeg.Rich -> {
                        Text(
                            text = seg.text,
                            fontSize = baseSize,
                            lineHeight = baseLineHeight,
                            color = if (seg.italic && !seg.bold) OmpColors.TextMuted else OmpColors.Text,
                            fontWeight = if (seg.bold || forceBold) FontWeight.Bold else null,
                            fontStyle = if (seg.italic) FontStyle.Italic else null,
                        )
                    }
                    is InlineSeg.Code -> MdInlineCode(code = seg.text)
                }
            }
        }
    }
}

@Composable
private fun MdInlineCode(code: String) {
    Box(
        modifier = Modifier
            .padding(horizontal = 2.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(OmpColors.BgHover)
            .border(1.dp, OmpColors.Border, RoundedCornerShape(4.dp))
            .padding(horizontal = 5.dp, vertical = 2.dp),
    ) {
        Text(
            text = code,
            fontFamily = Mono,
            fontSize = 13.sp,
            color = OmpColors.Accent,
        )
    }
}

@Composable
private fun MdCodeBlock(lang: String, code: String) {
    val clipboard = LocalClipboardManager.current
    var copied by remember(code) { mutableStateOf(false) }
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
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = lang.ifBlank { "code" },
                modifier = Modifier.weight(1f),
                fontFamily = Mono,
                fontSize = 12.sp,
                color = OmpColors.TextMuted,
            )
            Row(
                modifier = Modifier
                    .heightIn(min = 40.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .clickable {
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
                    fontSize = 12.sp,
                    color = OmpColors.TextMuted,
                )
            }
        }
        HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
        ) {
            Text(
                text = code.trimEnd(),
                modifier = Modifier.padding(10.dp),
                fontFamily = Mono,
                fontSize = 12.5.sp,
                lineHeight = 18.sp,
                color = OmpColors.Text,
            )
        }
    }
}

@Composable
private fun MdTable(header: List<String>, rows: List<List<String>>) {
    val shape = RoundedCornerShape(6.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .border(1.dp, OmpColors.Border, shape),
    ) {
        MdTableRow(cells = header, background = OmpColors.BgPanel, header = true)
        rows.forEachIndexed { index, row ->
            HorizontalDivider(color = OmpColors.Border, thickness = 1.dp)
            val normalized = if (row.size > header.size) {
                row.take(header.size)
            } else {
                row + List(maxOf(0, header.size - row.size)) { "" }
            }
            MdTableRow(
                cells = normalized,
                background = if (index % 2 == 1) OmpColors.BgHover else OmpColors.Bg,
                header = false,
            )
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
                        .background(OmpColors.Accent),
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
                    modifier = Modifier.width(24.dp),
                    fontSize = 14.sp,
                    lineHeight = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = OmpColors.Accent,
                )
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
                .background(OmpColors.AccentStrong),
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
