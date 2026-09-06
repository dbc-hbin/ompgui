"use client";

import { Link2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Field, TextInput } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n";
import { pairingQrSvg } from "@/lib/qr-svg";

interface PairResponse {
  uri: string;
  expiresAt: number;
  relayUrl: string;
  serverId: string;
}

interface DeviceRow {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
}

export function RelayPairPanel() {
  const { t } = useI18n();
  const [relayUrl, setRelayUrl] = useState("");
  const [statusUrl, setStatusUrl] = useState<string | undefined>();
  const [offer, setOffer] = useState<PairResponse | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const qrSvg = useMemo(() => (offer ? pairingQrSvg(offer.uri) : null), [offer]);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, devicesRes] = await Promise.all([
        fetch("/api/relay/pair"),
        fetch("/api/relay/devices"),
      ]);
      if (statusRes.ok) {
        const status: unknown = await statusRes.json();
        const suggestedUrl = status !== null && typeof status === "object" &&
          "relayUrl" in status && typeof status.relayUrl === "string" ? status.relayUrl : undefined;
        if (suggestedUrl) setRelayUrl((prev) => prev || suggestedUrl);
        setStatusUrl(suggestedUrl);
      }
      if (devicesRes.ok) {
        const body = await devicesRes.json() as { devices?: DeviceRow[] };
        setDevices(body.devices ?? []);
      }
    } catch {
      // Status refresh is best-effort; pairing can still be created.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createOffer() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/relay/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(relayUrl.trim() ? { url: relayUrl.trim() } : {}),
      });
      const body = await response.json() as PairResponse & { error?: string };
      if (!response.ok) {
        setError(body.error ?? t("relayPair.createFailed"));
        return;
      }
      setOffer(body);
      setRelayUrl(body.relayUrl);
      await refresh();
    } catch {
      setError(t("relayPair.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function copyUri() {
    if (!offer) return;
    try {
      await navigator.clipboard.writeText(offer.uri);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      const response = await fetch(`/api/relay/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        setError(t("relayPair.revokeFailed"));
        return;
      }
      await refresh();
    } catch {
      setError(t("relayPair.revokeFailed"));
    }
  }

  return (
    <main style={{ flex: 1, display: "grid", placeItems: "center", padding: 20, background: "var(--bg)" }}>
      <section
        style={{
          width: "min(100%, 520px)",
          padding: 32,
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
          <Link2 size={19} aria-hidden="true" />
        </div>
        <h1 className="display-serif" style={{ margin: 0, fontSize: "calc(var(--text-xl) + var(--space-5) - var(--space-1))", color: "var(--text)" }}>
          {t("relayPair.title")}
        </h1>
        <p style={{ margin: "10px 0 24px", color: "var(--text-muted)", fontSize: "var(--text-base)", lineHeight: 1.5 }}>
          {t("relayPair.description")}
        </p>
        <div style={{ display: "grid", gap: 14 }}>
          <Field label={t("relayPair.urlLabel")} hint={statusUrl && !relayUrl ? statusUrl : undefined}>
            <TextInput
              value={relayUrl}
              onChange={setRelayUrl}
              placeholder="wss://machine.tailnet.ts.net/relay"
              autoComplete="off"
              spellCheck={false}
              mono
            />
          </Field>
          <Button type="button" variant="primary" busy={busy} disabled={busy} onClick={() => void createOffer()}>
            {busy ? t("relayPair.creating") : t("relayPair.create")}
          </Button>
          {error ? <p style={{ margin: 0, color: "var(--danger, #c44)", fontSize: "var(--text-sm)" }}>{error}</p> : null}
          {offer ? (
            <div style={{ display: "grid", gap: 8 }}>
              {qrSvg ? (
                <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
                  <div
                    role="img"
                    aria-label={t("relayPair.qrHint")}
                    style={{
                      width: 196,
                      height: 196,
                      color: "var(--text)",
                      background: "#fff",
                      padding: 8,
                      borderRadius: "var(--radius-control)",
                      border: "1px solid var(--border)",
                    }}
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                  <p style={{ margin: 0, color: "var(--text-dim)", fontSize: "var(--text-sm)", textAlign: "center" }}>
                    {t("relayPair.qrHint")}
                  </p>
                </div>
              ) : null}
              <label style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("relayPair.linkLabel")}</label>
              <textarea
                readOnly
                value={offer.uri}
                rows={4}
                style={{
                  width: "100%",
                  resize: "vertical",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-sm)",
                  padding: 10,
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                }}
              />
              <Button type="button" variant="secondary" onClick={() => void copyUri()}>
                {copied ? t("relayPair.copied") : t("relayPair.copy")}
              </Button>
              <p style={{ margin: 0, color: "var(--text-dim)", fontSize: "var(--text-sm)" }}>
                {t("relayPair.expires", { time: new Date(offer.expiresAt).toLocaleTimeString() })}
              </p>
            </div>
          ) : null}
          <div>
            <h2 style={{ margin: "16px 0 8px", fontSize: "var(--text-base)", color: "var(--text)" }}>{t("relayPair.devicesTitle")}</h2>
            {devices.length === 0 ? (
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("relayPair.noDevices")}</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {devices.map((device) => (
                  <li key={device.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div>
                      <div style={{ color: "var(--text)", fontSize: "var(--text-sm)" }}>{device.label || device.id}</div>
                      <div style={{ color: "var(--text-dim)", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>{device.id}</div>
                    </div>
                    <Button type="button" variant="secondary" onClick={() => void revoke(device.id)}>{t("relayPair.revoke")}</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
