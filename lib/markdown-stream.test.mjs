import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  splitStableMarkdownPrefix,
  normalizeDisplayMath,
} = await jiti.import("./markdown.ts");

function split(markdown) {
  const parts = splitStableMarkdownPrefix(markdown);
  assert.equal(parts.stable + parts.tail, markdown);
  return parts;
}

function ingestWithPrefixCache(chunks) {
  let lastStable = null;
  let stableParses = 0;
  let tailParses = 0;
  for (const markdown of chunks) {
    const { stable, tail } = split(markdown);
    if (stable !== lastStable) {
      lastStable = stable;
      if (stable) {
        stableParses++;
        normalizeDisplayMath(stable);
      }
    }
    if (tail) {
      tailParses++;
      normalizeDisplayMath(tail);
    }
  }
  return { stableParses, tailParses, lastStable };
}

test("recombines stable and tail byte-for-byte", () => {
  const samples = [
    "",
    "hello",
    "hello\n\nworld",
    "hello\r\n\r\nworld",
    "# Title\n\npara",
    "```js\nconst x = 1;\n```\n\nafter",
    "$$x$$\n\ny",
  ];
  for (const sample of samples) split(sample);
});

test("keeps an unfinished paragraph in the tail", () => {
  const { stable, tail } = split("Hello world");
  assert.equal(stable, "");
  assert.equal(tail, "Hello world");
});

test("stabilizes a paragraph after a blank line once a new block starts", () => {
  const { stable, tail } = split("Hello world.\n\nNext");
  assert.equal(stable, "Hello world.\n\n");
  assert.equal(tail, "Next");
});

test("does not split inside a fenced code block", () => {
  const open = "intro\n\n```js\nconst x = 1;\nstill";
  const { stable, tail } = split(open);
  assert.equal(stable, "intro\n\n");
  assert.equal(tail, "```js\nconst x = 1;\nstill");
  assert.match(tail, /```js/);
});

test("does not split inside indented code", () => {
  const { stable, tail } = split("para\n\n    code\n    still");
  assert.equal(stable, "para\n\n");
  assert.match(tail, /^    code/);
});

test("does not split inside $$ or \\[ math", () => {
  const dollars = split("before\n\n$$\nx +\n");
  assert.equal(dollars.stable, "before\n\n");
  assert.match(dollars.tail, /\$\$/);

  const brackets = split("before\n\n\\[\nx +\n");
  assert.equal(brackets.stable, "before\n\n");
  assert.match(brackets.tail, /\\\[/);
});

test("does not split a growing table", () => {
  const headerOnly = split("| a | b |\n");
  assert.equal(headerOnly.stable, "");

  const openTable = split("| a | b |\n| --- | --- |\n| 1 |");
  assert.equal(openTable.stable, "");
  assert.match(openTable.tail, /\| a \| b \|/);
});

test("does not split raw HTML blocks or unclosed type-1 tags", () => {
  const div = split("<div>\nhello");
  assert.equal(div.stable, "");

  const pre = split("<pre>\ncode");
  assert.equal(pre.stable, "");
});

test("does not split list or blockquote continuity", () => {
  const list = split("- one\n- two");
  assert.equal(list.stable, "");
  assert.equal(list.tail, "- one\n- two");

  const listThenPara = split("- one\n- two\n\nAfter");
  assert.equal(listThenPara.stable, "- one\n- two\n\n");
  assert.equal(listThenPara.tail, "After");

  const quote = split("> alpha\n> beta");
  assert.equal(quote.stable, "");

  const quoteThenPara = split("> alpha\n\nAfter");
  assert.equal(quoteThenPara.stable, "> alpha\n\n");
  assert.equal(quoteThenPara.tail, "After");
});

test("does not split when reference definitions or uses are present", () => {
  const def = split("See [x][ref].\n\n[ref]: https://example.com\n\nMore");
  assert.equal(def.stable, "");
  assert.equal(def.tail, "See [x][ref].\n\n[ref]: https://example.com\n\nMore");

  const use = split("Hello.\n\nSee [x][ref]\n");
  assert.equal(use.stable, "");
});

test("does not split inside unclosed inline backticks", () => {
  const { stable, tail } = split("Hello `code\n");
  assert.equal(stable, "");
  assert.equal(tail, "Hello `code\n");
});

test("keeps CJK paragraphs independent at blank-line boundaries", () => {
  const { stable, tail } = split("5~7U는 약 100~200倍입니다。\n\n다음 문단");
  assert.equal(stable, "5~7U는 약 100~200倍입니다。\n\n");
  assert.equal(tail, "다음 문단");
});

test("does not reparse a long stable prefix on tail-only updates", () => {
  const prefix = "Stable paragraph about rendering cost.\n\n".repeat(80);
  const counts = ingestWithPrefixCache([
    `${prefix}tai`,
    `${prefix}tail`,
    `${prefix}tail grows`,
    `${prefix}tail grows more`,
  ]);
  assert.ok(prefix.length > 1000);
  assert.equal(counts.stableParses, 1);
  assert.equal(counts.lastStable, prefix);
  assert.equal(counts.tailParses, 4);
});

test("does not let ordered lists other than 1 interrupt a paragraph", () => {
  const numbered = split("text\n2. item");
  assert.equal(numbered.stable, "");
  assert.equal(numbered.tail, "text\n2. item");

  const laterItem = split("text\n2. item\n\nnext");
  assert.equal(laterItem.stable, "text\n2. item\n\n");
  assert.equal(laterItem.tail, "next");
});

test("lets a start-1 ordered list interrupt a paragraph", () => {
  const one = split("text\n1. item");
  assert.equal(one.stable, "text\n");
  assert.equal(one.tail, "1. item");

  const paren = split("text\n1) item\n\nnext");
  assert.equal(paren.stable, "text\n1) item\n\n");
  assert.equal(paren.tail, "next");

  const leadingZero = split("text\n01. item");
  assert.equal(leadingZero.stable, "text\n");
  assert.equal(leadingZero.tail, "01. item");

  const bullet = split("text\n- item");
  assert.equal(bullet.stable, "text\n");
  assert.equal(bullet.tail, "- item");
});

test("does not let type-7 HTML interrupt a paragraph", () => {
  const span = split("text\n<span>\nmore");
  assert.equal(span.stable, "");
  assert.equal(span.tail, "text\n<span>\nmore");

  const closedSpan = split("text\n<span>\nmore\n\nnext");
  assert.equal(closedSpan.stable, "text\n<span>\nmore\n\n");
  assert.equal(closedSpan.tail, "next");
});

test("lets type-6 HTML interrupt a paragraph and closes on a blank line", () => {
  const openDiv = split("text\n<div>\nmore");
  assert.equal(openDiv.stable, "text\n");
  assert.equal(openDiv.tail, "<div>\nmore");

  const closedDiv = split("<div>\nhello\n\nnext");
  assert.equal(closedDiv.stable, "<div>\nhello\n\n");
  assert.equal(closedDiv.tail, "next");
});

test("keeps comments, PIs, declarations, and CDATA open until their terminator", () => {
  const comment = split("<!--\n\nvisible");
  assert.equal(comment.stable, "");
  assert.equal(comment.tail, "<!--\n\nvisible");

  const pi = split("<?\n\nvisible");
  assert.equal(pi.stable, "");
  assert.equal(pi.tail, "<?\n\nvisible");

  const decl = split("<!DOCTYPE\n\nvisible");
  assert.equal(decl.stable, "");
  assert.equal(decl.tail, "<!DOCTYPE\n\nvisible");

  const cdata = split("<![CDATA[\n\nvisible");
  assert.equal(cdata.stable, "");
  assert.equal(cdata.tail, "<![CDATA[\n\nvisible");

  const closedComment = split("<!-- done -->\n\nnext");
  assert.equal(closedComment.stable, "<!-- done -->\n");
  assert.equal(closedComment.tail, "\nnext");

  const closedMultiline = split("<!--\nsecret\n-->\n\nnext");
  assert.equal(closedMultiline.stable, "<!--\nsecret\n-->\n");
  assert.equal(closedMultiline.tail, "\nnext");
});

test("does not treat inline $$ with trailing text as a display opener", () => {
  const inline = split("$$x$$ text\nend$$\nnext");
  assert.equal(inline.stable, "");
  assert.equal(inline.tail, "$$x$$ text\nend$$\nnext");

  const laterPara = split("$$x$$ text\nend$$\n\nnext");
  assert.equal(laterPara.stable, "$$x$$ text\nend$$\n\n");
  assert.equal(laterPara.tail, "next");
});

test("still stabilizes real display math once closed", () => {
  const block = split("$$\nx\n$$\n\nnext");
  assert.equal(block.stable, "$$\nx\n$$\n");
  assert.equal(block.tail, "\nnext");

  const glued = split("$$x + y$$\n\nnext");
  assert.equal(glued.stable, "$$x + y$$\n");
  assert.equal(glued.tail, "\nnext");

  const gluedClose = split("$$\nx + y$$\n\nnext");
  assert.equal(gluedClose.stable, "$$\nx + y$$\n");
  assert.equal(gluedClose.tail, "\nnext");
});

test("keeps shortcut references with container definitions in one root", () => {
  const quoted = split("See [x].\n\n> [x]: /url");
  assert.equal(quoted.stable, "");
  assert.equal(quoted.tail, "See [x].\n\n> [x]: /url");

  const listed = split("See [x].\n\n- [x]: /url");
  assert.equal(listed.stable, "");
  assert.equal(listed.tail, "See [x].\n\n- [x]: /url");

  const nestedQuote = split("See [x].\n\n> > [x]: /url");
  assert.equal(nestedQuote.stable, "");
  assert.equal(nestedQuote.tail, "See [x].\n\n> > [x]: /url");
});

test("does not let an empty 1. marker interrupt a paragraph", () => {
  const empty = split("text\n1.");
  assert.equal(empty.stable, "");
  assert.equal(empty.tail, "text\n1.");

  const emptyThenPara = split("text\n1.\n\nnext");
  assert.equal(emptyThenPara.stable, "text\n1.\n\n");
  assert.equal(emptyThenPara.tail, "next");

  const nonempty = split("text\n1. item");
  assert.equal(nonempty.stable, "text\n");
  assert.equal(nonempty.tail, "1. item");
});

test("treats code as type-7 HTML, not type-1", () => {
  const code = split("text\n<code>");
  assert.equal(code.stable, "");
  assert.equal(code.tail, "text\n<code>");

  const codeThenPara = split("text\n<code>\nmore\n\nnext");
  assert.equal(codeThenPara.stable, "text\n<code>\nmore\n\n");
  assert.equal(codeThenPara.tail, "next");

  const pre = split("text\n<pre>");
  assert.equal(pre.stable, "text\n");
  assert.equal(pre.tail, "<pre>");
});

test("does not close type-1 HTML on a spaced end tag", () => {
  const spaced = split("<pre>\na\n</pre >\n\nnext");
  assert.equal(spaced.stable, "");
  assert.equal(spaced.tail, "<pre>\na\n</pre >\n\nnext");

  const closed = split("<pre>\na\n</pre>\n\nnext");
  assert.equal(closed.stable, "<pre>\na\n</pre>\n");
  assert.equal(closed.tail, "\nnext");
});

test("does not start CDATA from a lowercase marker", () => {
  const lower = split("text\n<![cdata[x]]>");
  assert.equal(lower.stable, "");
  assert.equal(lower.tail, "text\n<![cdata[x]]>");

  const interrupt = split("text\n<![CDATA[\nsecret\n]]>\n\nnext");
  assert.equal(interrupt.stable, "text\n<![CDATA[\nsecret\n]]>\n");
  assert.equal(interrupt.tail, "\nnext");

  const upper = split("<![CDATA[\nsecret\n]]>\n\nnext");
  assert.equal(upper.stable, "<![CDATA[\nsecret\n]]>\n");
  assert.equal(upper.tail, "\nnext");
});

test("type-6 slash boundary is only a complete />", () => {
  const slash = split("text\n<div/foo");
  assert.equal(slash.stable, "");
  assert.equal(slash.tail, "text\n<div/foo");

  const selfClose = split("text\n<div/>\n\nnext");
  assert.equal(selfClose.stable, "text\n<div/>\n\n");
  assert.equal(selfClose.tail, "next");
});

test("glued dollar math aborts at a normalization block boundary", () => {
  const heading = split("$$x\n# h\n$$\n\nnext");
  assert.equal(heading.stable, "$$x\n# h\n");
  assert.equal(heading.tail, "$$\n\nnext");

  const closed = split("$$x\ny\n$$\n\nnext");
  assert.equal(closed.stable, "$$x\ny\n$$\n");
  assert.equal(closed.tail, "\nnext");
});

test("bracket math aborts at a code fence boundary", () => {
  const fenced = split("\\[\n```\n\\]\n```\n\nnext");
  assert.equal(fenced.stable, "\\[\n```\n\\]\n```\n");
  assert.equal(fenced.tail, "\nnext");

  const closed = split("\\[\nx\n\\]\n\nnext");
  assert.equal(closed.stable, "\\[\nx\n\\]\n");
  assert.equal(closed.tail, "\nnext");
});

