package com.dbchbin.ompgui.remote.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class InternalMessageParserTest {
    @Test fun preservesProseBeforeAndAfterProtocolBlock() {
        val text = "Before\n<irc sender=\"worker\">\nhello\n</irc>\nAfter"
        val ranges = parseInternalMessage(text)
        assertEquals(listOf(null, "irc", null), ranges.map { it.tag })
        assertEquals(listOf("Before\n", "<irc sender=\"worker\">\nhello\n</irc>", "\nAfter"),
            ranges.map { text.substring(it.start, it.endExclusive) })
    }

    @Test fun nestsKnownWrappersAndSeparatesAdjacentBlocks() {
        val nested = "<system-notice>\n<irc>\n<irc>inner</irc>\n</irc>\n</system-notice>"
        val adjacent = "<task-result>done</task-result>"
        val text = nested + adjacent
        val ranges = parseInternalMessage(text)
        assertEquals(listOf("system-notice", "task-result"), ranges.map { it.tag })
        assertEquals(listOf(nested, adjacent), ranges.map { text.substring(it.start, it.endExclusive) })
    }

    @Test fun streamedOpenBlockKeepsItsIdentityAndEndsAtReceivedText() {
        val prefix = "Intro\n<system-directive source=\""
        val streaming = prefix + "runtime\">\nworking"
        val completed = streaming + "\n</system-directive>\nVisible answer"
        val first = parseInternalMessage(prefix).single { it.tag != null }
        val growing = parseInternalMessage(streaming).single { it.tag != null }
        val last = parseInternalMessage(completed).single { it.tag != null }
        assertEquals("system-directive", first.tag)
        assertEquals(prefix.length, first.endExclusive)
        assertEquals(streaming.length, growing.endExclusive)
        assertEquals(first.start, growing.start)
        assertEquals(first.start, last.start)
        assertEquals(first.tag, last.tag)
        assertEquals("\nVisible answer", completed.substring(last.endExclusive))
    }

    @Test fun orphanClosingTagDoesNotSwallowPrecedingProse() {
        val text = "Keep this visible\n</irc>\nAnd this"
        val ranges = parseInternalMessage(text)
        assertEquals(listOf(null, "irc", null), ranges.map { it.tag })
        assertEquals(listOf("Keep this visible\n", "</irc>", "\nAnd this"),
            ranges.map { text.substring(it.start, it.endExclusive) })
        assertTrue(parseInternalMessage("</irc> is a closing tag example").all { it.tag == null })
    }

    @Test fun codeExamplesRemainVisibleIncludingLongAndTildeFences() {
        val examples = listOf(
            "Use `<irc>hello</irc>` here.",
            "Use ``a multiline example\n<irc>hello</irc>\nwith ` inside`` here.",
            "\\<irc>escaped</irc>",
            "A mention of <system-notice> is not a protocol block.",
            "    <irc>\n    code\n    </irc>",
            "\t<irc>example</irc>",
            "```xml\n<irc>\n</irc>\n```",
            "~~~~xml\n<system-reminder>example</system-reminder>\n~~~\n</irc>\n~~~~",
            "````markdown\n```\n<task-notification>example</task-notification>\n```\n````",
        )
        for (text in examples) {
            assertEquals(text, listOf(MessageTextRange(0, text.length)), parseInternalMessage(text))
        }
    }

    @Test fun unknownHtmlAndLookalikeTagNamesRemainVisible() {
        for (text in listOf("<details>\nvisible\n</details>", "<div>text</div>", "<irc-example>text</irc-example>", "<system-noticeboard>text</system-noticeboard>")) {
            assertEquals(text, listOf(MessageTextRange(0, text.length)), parseInternalMessage(text))
        }
    }

    @Test fun preservesEveryRawCharacterIncludingAttributesAndLineEndings() {
        val text = "  Before\r\n  <system-reminder reason=\"a > b\">\r\n  raw & <unknown/> `</system-reminder>`\r\n</system-reminder>\r\nAfter  "
        val ranges = parseInternalMessage(text)
        val block = ranges.single { it.tag != null }
        assertEquals("<system-reminder reason=\"a > b\">\r\n  raw & <unknown/> `</system-reminder>`\r\n</system-reminder>",
            text.substring(block.start, block.endExclusive))
        assertEquals(text, ranges.joinToString("") { text.substring(it.start, it.endExclusive) })
    }

    @Test fun rawPagesPreserveSurrogatePairsAcrossPageBoundaries() {
        val pair = "\uD83D\uDE00"
        val raw = "<irc>" + "x".repeat(8191 - 5) + pair + "y".repeat(8190) + pair + "</irc>"
        val text = "Visible prefix\n" + raw + "\nVisible suffix"
        val block = parseInternalMessage(text).single { it.tag == "irc" }
        val pageCount = (block.endExclusive - block.start - 1) / InternalMessagePageSize + 1
        val pages = (0 until pageCount).map { internalMessageRawPage(text, block, it) }
        assertEquals(raw, pages.joinToString(""))
        assertEquals(8193, pages.first().length)
        for (page in pages) {
            assertTrue(page.length <= InternalMessagePageSize + 1)
            assertTrue(!page.first().isLowSurrogate())
            assertTrue(!page.last().isHighSurrogate())
        }
    }

    @Test fun codeInsideProtocolCannotPrematurelyCloseItsWrapper() {
        val text = "<irc>\n```xml\n</irc>\n```\nstill internal\n</irc>\nVisible"
        val ranges = parseInternalMessage(text)
        assertEquals(listOf("irc", null), ranges.map { it.tag })
        assertEquals("\nVisible", text.substring(ranges.first().endExclusive))
    }
}
