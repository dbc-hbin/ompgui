package com.dbchbin.ompgui.remote.ui

/** Half-open source offsets. No message bodies are copied while finding disclosures. */
internal data class MessageTextRange(val start: Int, val endExclusive: Int, val tag: String? = null)

internal const val InternalMessagePageSize = 8192

/** Materializes only the requested page, keeping shared UTF-16 boundaries intact. */
internal fun internalMessageRawPage(text: String, range: MessageTextRange, page: Int): String {
    var start = range.start + page * InternalMessagePageSize
    var end = start + minOf(InternalMessagePageSize, range.endExclusive - start)
    if (start > range.start && start < range.endExclusive && text[start].isLowSurrogate() && text[start - 1].isHighSurrogate()) start++
    if (end < range.endExclusive && text[end].isLowSurrogate() && text[end - 1].isHighSurrogate()) end++
    return text.substring(start, end)
}

private val internalMessageTags = setOf(
    "irc", "system-notice", "system-reminder", "system-directive",
    "task-result", "task-notification",
)

private data class InternalTag(val name: String, val end: Int, val closing: Boolean, val selfClosing: Boolean)

private fun internalTagAt(text: String, start: Int, lineEnd: Int): InternalTag? {
    var cursor = start + 1
    val closing = cursor < lineEnd && text[cursor] == '/'
    if (closing) cursor++
    val nameStart = cursor
    while (cursor < lineEnd && (text[cursor] in 'a'..'z' || text[cursor] == '-')) cursor++
    // Bound the only token copy, even for a huge unknown HTML-like word.
    if (cursor - nameStart !in 3..20) return null
    val name = text.substring(nameStart, cursor)
    if (name !in internalMessageTags) return null
    if (cursor < lineEnd && !text[cursor].isWhitespace() && text[cursor] != '>' && text[cursor] != '/') return null
    var quote: Char? = null
    while (cursor < lineEnd) {
        val char = text[cursor]
        if (quote != null) {
            if (char == quote) quote = null
        } else when (char) {
            '\'', '"' -> quote = char
            '>' -> return InternalTag(name, cursor + 1, closing, cursor > start && text[cursor - 1] == '/')
            '<' -> return null
        }
        cursor++
    }
    // A streamed opening delimiter may not have received its final '>' yet.
    return if (!closing && lineEnd == text.length) InternalTag(name, lineEnd, false, false) else null
}

/**
 * Only explicit harness tags at a line boundary start a disclosure. Markdown code,
 * arbitrary HTML and inline mentions remain ordinary text. Once a wrapper starts,
 * nested wrappers belong to its raw body; its same-line closing delimiter is valid.
 */
internal fun parseInternalMessage(text: String): List<MessageTextRange> {
    val ranges = mutableListOf<MessageTextRange>()
    val stack = mutableListOf<String>()
    var plainStart = 0
    var blockStart = -1
    var blockTag: String? = null
    var fenceMarker = ' '
    var fenceLength = 0
    var inlineTicks = 0
    var lineStart = 0
    while (lineStart < text.length) {
        val newline = text.indexOf('\n', lineStart)
        val lineEnd = if (newline < 0) text.length else newline
        var first = lineStart
        while (first < lineEnd && text[first] == ' ') first++
        val indented = first - lineStart >= 4 || (first < lineEnd && text[first] == '\t')
        var markerEnd = first
        if (!indented && first < lineEnd && (text[first] == '`' || text[first] == '~')) {
            while (markerEnd < lineEnd && text[markerEnd] == text[first]) markerEnd++
        }
        val markerLength = markerEnd - first
        if (fenceLength > 0) {
            if (markerLength >= fenceLength && text[first] == fenceMarker &&
                (markerEnd until lineEnd).all { text[it].isWhitespace() }) fenceLength = 0
        } else if (inlineTicks == 0 && markerLength >= 3) {
            fenceMarker = text[first]
            fenceLength = markerLength
        } else if (!indented) {
            var cursor = first
            var boundary = true
            while (cursor < lineEnd) {
                if (inlineTicks == 0 && text[cursor] == '\\') {
                    cursor = minOf(cursor + 2, lineEnd)
                    boundary = false
                    continue
                }
                if (text[cursor] == '`') {
                    var end = cursor + 1
                    while (end < lineEnd && text[end] == '`') end++
                    val length = end - cursor
                    if (inlineTicks == 0) inlineTicks = length else if (length == inlineTicks) inlineTicks = 0
                    cursor = end
                    boundary = false
                    continue
                }
                if (inlineTicks == 0 && text[cursor] == '<' && (stack.isNotEmpty() || boundary)) {
                    val token = internalTagAt(text, cursor, lineEnd)
                    if (token != null) {
                        val orphan = stack.isEmpty() && token.closing
                        val standaloneOrphan = orphan && (token.end until lineEnd).all { text[it].isWhitespace() }
                        if (!orphan || standaloneOrphan) {
                            if (stack.isEmpty()) {
                                if (plainStart < cursor) ranges.add(MessageTextRange(plainStart, cursor))
                                blockStart = cursor
                                blockTag = token.name
                            }
                            if (token.closing) {
                                if (stack.lastOrNull() == token.name) stack.removeAt(stack.lastIndex)
                            } else if (!token.selfClosing) stack.add(token.name)
                            cursor = token.end
                            if (stack.isEmpty()) {
                                ranges.add(MessageTextRange(blockStart, cursor, blockTag))
                                plainStart = cursor
                                blockStart = -1
                            }
                            boundary = true
                            continue
                        }
                    }
                }
                if (!text[cursor].isWhitespace()) boundary = false
                cursor++
            }
        }
        lineStart = if (newline < 0) text.length else newline + 1
    }
    if (blockStart >= 0) ranges.add(MessageTextRange(blockStart, text.length, blockTag))
    else if (plainStart < text.length) ranges.add(MessageTextRange(plainStart, text.length))
    return ranges
}
