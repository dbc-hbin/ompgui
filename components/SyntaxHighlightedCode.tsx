"use client";

import { useEffect, useState } from "react";
import { ensureLanguageRegistered, isLanguageRegistered, SyntaxHighlighter, vs, vscDarkPlus } from "@/lib/syntax-highlight";
import { useTheme } from "@/hooks/useTheme";

interface Props {
  code: string;
  lang: string;
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
  const [ready, setReady] = useState(() => isLanguageRegistered(lang));

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
      showLineNumbers
      lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
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
