"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  COARSE_POINTER_MEDIA_QUERY,
  countCodeLines,
  ensureLanguageRegistered,
  isLanguageRegistered,
  shouldShowCodeLineNumbers,
  SyntaxHighlighter,
  vs,
  vscDarkPlus,
} from "@/lib/syntax-highlight";
import { useTheme } from "@/hooks/useTheme";

interface Props {
  code: string;
  lang: string;
}

function subscribeCoarsePointer(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(COARSE_POINTER_MEDIA_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getCoarsePointerSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(COARSE_POINTER_MEDIA_QUERY).matches;
}

function getCoarsePointerServerSnapshot(): boolean {
  return false;
}

function PlainCode({ code }: { code: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: "var(--code-padding-block) var(--code-padding-inline)",
        fontSize: "var(--code-font-size)",
        lineHeight: "var(--code-line-height)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        color: "var(--text)",
        backgroundColor: "var(--code-bg)",
        fontFamily: "var(--font-mono)",
      }}
    >
      {code}
    </pre>
  );
}

export function SyntaxHighlightedCode({ code, lang }: Props) {
  const { isDark } = useTheme();
  const isCoarsePointer = useSyncExternalStore(
    subscribeCoarsePointer,
    getCoarsePointerSnapshot,
    getCoarsePointerServerSnapshot,
  );
  const [ready, setReady] = useState(() => isLanguageRegistered(lang));
  const showLineNumbers = shouldShowCodeLineNumbers({
    isCoarsePointer,
    lineCount: countCodeLines(code),
  });

  useEffect(() => {
    let cancelled = false;
    setReady(isLanguageRegistered(lang));
    const promise = ensureLanguageRegistered(lang);
    if (promise) {
      promise.then(() => { if (!cancelled) setReady(true); });
    }
    return () => { cancelled = true; };
  }, [lang]);

  if (!ready) {
    return <PlainCode code={code} />;
  }

  return (
    <SyntaxHighlighter
      language={lang || "text"}
      style={isDark ? vscDarkPlus : vs}
      showLineNumbers={showLineNumbers}
      lineNumberStyle={showLineNumbers ? { color: "var(--text-dim)", fontStyle: "normal" } : undefined}
      customStyle={{
        margin: 0,
        padding: "var(--code-padding-block) var(--code-padding-inline)",
        fontSize: "var(--code-font-size)",
        lineHeight: "var(--code-line-height)",
        borderRadius: 0,
        backgroundColor: "var(--code-bg)",
      }}
      codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
    >
      {code}
    </SyntaxHighlighter>
  );
}
