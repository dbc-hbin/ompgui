"use client";

import { LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";
import { Button, Field, SecretInput } from "@/components/ui/field";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/web-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError("Incorrect password. Please try again.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Could not sign in. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ flex: 1, display: "grid", placeItems: "center", padding: 20, background: "var(--bg)" }}>
      <section
        aria-labelledby="login-title"
        style={{
          width: "min(100%, 380px)",
          padding: "32px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            display: "grid",
            placeItems: "center",
            borderRadius: "50%",
            background: "var(--user-bg)",
            color: "var(--accent)",
            marginBottom: 20,
          }}
        >
          <LockKeyhole size={19} aria-hidden="true" />
        </div>
        <h1
          id="login-title"
          className="display-serif"
          style={{
            margin: 0,
            fontSize: "calc(var(--text-xl) + var(--space-5) - var(--space-1))",
            lineHeight: 1.1,
            color: "var(--text)",
          }}
        >
          Welcome back
        </h1>
        <p
          style={{
            margin: "10px 0 24px",
            color: "var(--text-muted)",
            fontSize: "var(--text-base)",
            lineHeight: 1.5,
          }}
        >
          Enter the password for this ompgui workspace.
        </p>
        <form onSubmit={signIn} style={{ display: "grid", gap: 14 }}>
          <Field label="Password" error={error} required>
            <SecretInput
              id="web-password"
              name="password"
              value={password}
              error={error}
              onChange={(value) => {
                setPassword(value);
                if (error) setError(null);
              }}
              autoComplete="current-password"
              autoFocus
              required
              showLabel="Show password"
              hideLabel="Hide password"
              placeholder="••••••••"
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            busy={submitting}
            disabled={submitting}
            style={{ width: "100%", minHeight: 36 }}
          >
            {submitting ? "Unlocking…" : "Unlock workspace"}
          </Button>
        </form>
      </section>
    </main>
  );
}
