"use client";

import { LockKeyhole } from "lucide-react";
import type { FormEvent } from "react";
import { useLayoutEffect, useState } from "react";
import { Button, Field, SecretInput, TextInput } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n";

export function LoginForm() {
  const { t } = useI18n();
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("");
  const [pairPassword, setPairPassword] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"pair" | "local" | null>(null);

  useLayoutEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const offeredSecret = fragment.get("pair");
    if (offeredSecret !== null) {
      // Remove the one-time secret before effects or form requests can run.
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      setSecret(offeredSecret);
    }
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>, pairing: boolean) {
    event.preventDefault();
    const setFailure = pairing ? setPairError : setError;
    setSubmitting(pairing ? "pair" : "local");
    setFailure(null);
    try {
      const response = await fetch(pairing ? "/api/web-auth/pair" : "/api/web-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pairing ? { secret: secret.trim(), label: label.trim() || undefined, password: pairPassword } : { password }),
      });
      if (!response.ok) {
        setFailure(t(pairing ? "webLogin.pairFailed" : "webLogin.localFailed"));
        return;
      }
      const body: unknown = await response.json();
      if (body === null || typeof body !== "object" || !("ok" in body) || body.ok !== true) {
        setFailure(t("webLogin.connectionFailed"));
        return;
      }
      window.location.assign("/");
    } catch {
      setFailure(t("webLogin.connectionFailed"));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto", padding: 20, background: "var(--bg)" }}>
      <section
        aria-labelledby="login-title"
        style={{
          width: "min(100%, 380px)",
          flexShrink: 0,
          margin: "auto",
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
          {t("webLogin.title")}
        </h1>
        <p
          style={{
            margin: "10px 0 24px",
            color: "var(--text-muted)",
            fontSize: "var(--text-base)",
            lineHeight: 1.5,
          }}
        >
          {t("webLogin.description")}
        </p>
        <form id="web-pair-form" onSubmit={(event) => void signIn(event, true)} style={{ display: "grid", gap: 14 }}>
          <Field label={t("webLogin.secret")} hint={t("webLogin.secretHint")} required>
            <SecretInput
              id="web-pair-secret"
              name="secret"
              value={secret}
              onChange={(value) => { setSecret(value); setPairError(null); }}
              autoComplete="off"
              required
              showLabel={t("webLogin.showSecret")}
              hideLabel={t("webLogin.hideSecret")}
            />
          </Field>
          <Field label={t("webLogin.label")} hint={t("webLogin.labelHint")}>
            <TextInput id="web-pair-label" name="label" value={label} onChange={setLabel} autoComplete="off" />
          </Field>
          <Field label={t("webLogin.password")} hint={t("webLogin.passwordHint")} error={pairError}>
            <SecretInput
              id="web-pair-password"
              name="password"
              value={pairPassword}
              error={pairError}
              onChange={(value) => { setPairPassword(value); setPairError(null); }}
              autoComplete="current-password"
              showLabel={t("webLogin.showPassword")}
              hideLabel={t("webLogin.hidePassword")}
            />
          </Field>
          <Button type="submit" variant="primary" busy={submitting === "pair"} disabled={submitting !== null} style={{ width: "100%", minHeight: 36 }}>
            {t(submitting === "pair" ? "webLogin.pairing" : "webLogin.pair")}
          </Button>
        </form>
        <details style={{ marginTop: 24, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
          <summary style={{ cursor: "pointer" }}>{t("webLogin.localTitle")}</summary>
          <p style={{ lineHeight: 1.5 }}>{t("webLogin.localHint")}</p>
          <form id="web-local-form" onSubmit={(event) => void signIn(event, false)} style={{ display: "grid", gap: 14 }}>
            <Field label={t("webLogin.password")} error={error} required>
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
                required
                showLabel={t("webLogin.showPassword")}
                hideLabel={t("webLogin.hidePassword")}
                placeholder="••••••••"
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              busy={submitting === "local"}
              disabled={submitting !== null}
              style={{ width: "100%", minHeight: 36 }}
            >
              {t(submitting === "local" ? "webLogin.unlocking" : "webLogin.unlock")}
            </Button>
          </form>
        </details>
      </section>
    </main>
  );
}
