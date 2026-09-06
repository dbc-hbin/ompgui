package com.dbchbin.ompgui.remote.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MarkdownLinksTest {
    @Test fun resolvesRelativePathsAgainstSessionDirectory() {
        assertEquals(MarkdownTarget.File("/workspace/project/docs/a b.md"), resolveMarkdownLink("./docs/a%20b.md", "/workspace/project"))
        assertEquals(MarkdownTarget.File("/workspace/shared.md"), resolveMarkdownLink("../shared.md", "/workspace/project"))
        assertNull(resolveMarkdownLink("docs/readme.md", null))
    }

    @Test fun acceptsOnlyHttpSchemesAndPlainFilePaths() {
        assertEquals(MarkdownTarget.Web("https://example.com/a?q=1#section"), resolveMarkdownLink("https://example.com/a?q=1#section", null))
        for (target in listOf("javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", "content://private/file", "//example.com/a", "https://user:password@example.com", "%6aavascript:alert(1)", "bad%00name", "folder\\file")) {
            assertNull(target, resolveMarkdownLink(target, "/workspace"))
        }
    }

    @Test fun balancesLinkDestinationParentheses() {
        assertEquals(listOf(InlineSeg.Link("guide", "docs/guide(v2).md")), parseInline("[guide](docs/guide(v2).md)"))
        assertEquals(listOf(InlineSeg.Code("[guide](docs/a.md)")), parseInline("`[guide](docs/a.md)`"))
        assertEquals(listOf(InlineSeg.Rich("[unfinished](docs/a.md", false, false)), parseInline("[unfinished](docs/a.md"))
    }

    @Test fun keepsEscapedDelimitersLiteral() {
        assertEquals(listOf(InlineSeg.Rich("[not a link](a.md)", false, false)), parseInline("\\[not a link](a.md)"))
        assertEquals(listOf(InlineSeg.Code("a ` b")), parseInline("``a ` b``"))
    }

    @Test fun requiresMatchingFenceLengthAndMarker() {
        assertEquals(listOf(MdBlock.Code("markdown", "```\ninner\n```")), parseMarkdown("````markdown\n```\ninner\n```\n````"))
        assertEquals(listOf(MdBlock.Code("mermaid", "graph TD\nA-->B")), parseMarkdown("~~~mermaid\ngraph TD\nA-->B\n~~~"))
        assertEquals(listOf(MdBlock.Code("text", "```not a closing fence\n~~~")), parseMarkdown("```text\n```not a closing fence\n~~~\n```"))
    }
}
