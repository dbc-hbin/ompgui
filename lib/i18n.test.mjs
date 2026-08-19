import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "i18n", "locales");

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { LOCALES, translate, setLocale } = await jiti.import("./i18n/index.tsx");

test("all four locale dictionaries exist and parse cleanly", () => {
  const expectedLocales = ["en", "zh-CN", "ja", "ko"];
  for (const loc of expectedLocales) {
    const filePath = path.join(localesDir, `${loc}.json`);
    assert.ok(fs.existsSync(filePath), `Dictionary file missing for ${loc}`);
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.ok(typeof content === "object" && content !== null);
  }
});

test("all dictionaries have exact key parity with en.json", () => {
  const en = JSON.parse(fs.readFileSync(path.join(localesDir, "en.json"), "utf8"));
  const enKeys = Object.keys(en).sort();

  for (const loc of ["zh-CN", "ja", "ko"]) {
    const dict = JSON.parse(fs.readFileSync(path.join(localesDir, `${loc}.json`), "utf8"));
    const dictKeys = Object.keys(dict).sort();

    assert.equal(dictKeys.length, enKeys.length, `Key count mismatch for ${loc}`);
    assert.deepEqual(dictKeys, enKeys, `Keys do not match en.json in ${loc}`);
  }
});

test("template placeholders match across all dictionaries", () => {
  const en = JSON.parse(fs.readFileSync(path.join(localesDir, "en.json"), "utf8"));

  for (const loc of ["zh-CN", "ja", "ko"]) {
    const dict = JSON.parse(fs.readFileSync(path.join(localesDir, `${loc}.json`), "utf8"));

    for (const [key, enVal] of Object.entries(en)) {
      const enVars = (enVal.match(/\{(\w+)\}/g) || []).sort();
      const locVars = (dict[key].match(/\{(\w+)\}/g) || []).sort();

      // Plural `.one` in Asian languages can legitimately include {count} even if English hardcoded 1
      if (key.endsWith(".one") && (loc === "zh-CN" || loc === "ja" || loc === "ko")) {
        const nonCountEnVars = enVars.filter((v) => v !== "{count}");
        const nonCountLocVars = locVars.filter((v) => v !== "{count}");
        assert.deepEqual(
          nonCountLocVars,
          nonCountEnVars,
          `Non-count placeholder mismatch in ${loc} for key ${key}`,
        );
      } else {
        assert.deepEqual(
          locVars,
          enVars,
          `Placeholder mismatch in ${loc} for key ${key}: expected ${enVars.join(",")} but got ${locVars.join(",")}`,
        );
      }
    }
  }
});

test("LOCALES includes Korean with label 한국어", () => {
  const koLocale = LOCALES.find((l) => l.value === "ko");
  assert.ok(koLocale, "ko locale missing from LOCALES");
  assert.equal(koLocale.label, "한국어");
});

test("runtime translation works for ko locale", () => {
  setLocale("ko");
  assert.equal(translate("appShell.appUpdateAvailable"), "ompweb 업데이트가 있습니다");
  assert.equal(translate("appShell.updateVersion", { current: "0.3.3", available: "0.4.0" }), "v0.3.3 → v0.4.0");
});
