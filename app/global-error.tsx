"use client";

import { useEffect } from "react";

// Global error boundary — this must NOT import from @/lib/* because the error
// may be caused by a module loading failure. Use inline minimal styles and
// hardcoded English text (this is the absolute fallback).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global application error:", error);
  }, [error]);

  return (
    <html>
      <body>
        <style>{`
          :root {
            --fallback-bg: #FAF9F6;
            --fallback-text: #2B2823;
            --fallback-muted: #69635A;
            --fallback-accent: #B03E22;
            --fallback-on-accent: #FFFFFF;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --fallback-bg: #18181E;
              --fallback-text: #E7E8EA;
              --fallback-muted: #A0A4AC;
              --fallback-accent: #956000;
            }
          }
          .global-error-surface {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100dvh;
            padding: 2rem;
            gap: 1rem;
            font-family: "Pretendard Variable", "Pretendard", system-ui, -apple-system, sans-serif;
            text-align: center;
            color: var(--fallback-text);
            background: var(--fallback-bg);
          }
          .global-error-surface p {
            margin: 0;
            color: var(--fallback-muted);
            max-width: 28rem;
            font-size: 0.875rem;
            line-height: 1.6;
          }
          .global-error-surface button {
            margin-top: 0.5rem;
            padding: 0.5rem 1.5rem;
            font-size: 0.875rem;
            font-weight: 500;
            border: 0;
            border-radius: 8px;
            background: var(--fallback-accent);
            color: var(--fallback-on-accent);
            cursor: pointer;
          }
        `}</style>
        <div className="global-error-surface">
          <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>
            Something went wrong
          </h2>
          <p>
            An unexpected error occurred. Try reloading the page.
          </p>
          <button onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
