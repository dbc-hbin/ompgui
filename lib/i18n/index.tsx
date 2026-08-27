"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import zhCN from "./locales/zh-CN.json";
import ko from "./locales/ko.json";
import { migrateStorageValue } from "@/lib/storage-migration";

export type Locale = "en" | "zh-CN" | "ja" | "ko";

export const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: "en", label: "EN" },
  { value: "zh-CN", label: "中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

const STORAGE_KEY = "ompgui-lang";
const LEGACY_STORAGE_KEY = "omp-lang";

const dictionaries: Record<Locale, Record<string, string>> = {
  en: en as Record<string, string>,
  "zh-CN": zhCN as Record<string, string>,
  ja: ja as Record<string, string>,
  ko: ko as Record<string, string>,
};

// Held on globalThis so a Fast Refresh module swap cannot split subscribers
// across two Sets — components mounted before the swap would otherwise never
// be notified of a language change.
interface I18nState {
  listeners: Set<() => void>;
  locale: Locale | null;
}

declare global {
  var __ompI18nState: I18nState | undefined;
}

const state: I18nState = (globalThis.__ompI18nState ??= { listeners: new Set(), locale: null });
const listeners = state.listeners;

function detectLocale(): Locale {
  try {
    const stored = migrateStorageValue(
      localStorage,
      STORAGE_KEY,
      LEGACY_STORAGE_KEY,
      (value) => value === "en" || value === "zh-CN" || value === "ja" || value === "ko",
    );
    if (stored === "en" || stored === "zh-CN" || stored === "ja" || stored === "ko") return stored;
  } catch {
    // storage unavailable (private mode etc.)
  }
  if (typeof navigator !== "undefined") {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith("zh")) return "zh-CN";
    if (lang.startsWith("ja")) return "ja";
    if (lang.startsWith("ko")) return "ko";
  }
  return "en";
}

function getLocale(): Locale {
  if (state.locale !== null) return state.locale;
  if (typeof document === "undefined") return "en";
  state.locale = detectLocale();
  return state.locale;
}

export function setLocale(locale: Locale): void {
  state.locale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore storage errors
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
  listeners.forEach((cb) => cb());
}

/** Translate outside React (toasts, error helpers). Falls back key → en → key. */
export function translate(key: string, vars?: Record<string, string | number>, forcedLocale?: Locale): string {
  const locale = forcedLocale ?? getLocale();
  const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Plural-aware translate: resolves `<key>.one` for count===1, `<key>.other`
 * otherwise (zh/ja dictionaries may map both to the same string). The count is
 * always available to the template as {count}. */
export function translatePlural(
  key: string,
  count: number,
  vars?: Record<string, string | number>,
  forcedLocale?: Locale,
): string {
  return translate(`${key}.${count === 1 ? "one" : "other"}`, { count, ...vars }, forcedLocale);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getServerSnapshot(): Locale {
  return "en";
}

/** Locale state + translator. Components re-render on language switch because
 * the locale is the subscribed snapshot. */
export function useI18n() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const getClientSnapshot = useCallback((): Locale => {
    if (!hydrated) return "en";
    return getLocale();
  }, [hydrated]);

  const locale = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(key, vars, locale),
    [locale],
  );

  const tn = useCallback(
    (key: string, count: number, vars?: Record<string, string | number>) =>
      translatePlural(key, count, vars, locale),
    [locale],
  );

  return { locale, setLocale, t, tn };
}
