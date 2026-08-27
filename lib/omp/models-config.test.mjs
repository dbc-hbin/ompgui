import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  ModelsConfigParseError,
  ModelsConfigValidationError,
  mergeRedactedModelsConfig,
  readModelsConfigFile,
  redactModelsConfig,
  serializeModelsConfig,
  validateModelsConfig,
  writeModelsConfig,
} = await jiti.import("./models-config.ts");

// A hand-edited models.yml: comments, blank lines and quoting that a
// parse+stringify round trip would silently throw away.
const HAND_EDITED = `# Custom providers for omp.
# Keep the local llama entry first.

providers:
  local-llama:
    baseUrl: http://127.0.0.1:8080/v1 # llama.cpp server
    apiKey: LLAMA_API_KEY
    api: openai-completions
    models:
      # 70B, quantized
      - id: llama-3.3-70b
        name: "Llama 3.3 70B"
        contextWindow: 131072
        maxTokens: 8192
      # small, fast
      - id: llama-3.2-3b
        name: Llama 3.2 3B
        contextWindow: 32768

  work-proxy:
    baseUrl: https://proxy.internal/v1
    apiKey: "!op read op://work/openai/key"
    api: openai-responses
    models:
      - id: gpt-5
        reasoning: true
`;

test("redacts provider secrets and merges preserve, replacement, and clear operations", () => {
  const current = {
    topLevelFuture: { keep: true },
    providers: {
      secure: {
        api: "future-api",
        baseUrl: "https://api.example.com/v1",
        apiKey: "SUPER_SECRET_API_KEY",
        headers: { Authorization: "Bearer SUPER_SECRET_HEADER", "X-Trace": "private" },
        futureProviderField: { keep: "round-trippable" },
        models: [{ id: "model", api: "future-api", headers: { Authorization: "Bearer SUPER_SECRET_MODEL_HEADER" } }],
      },
    },
  };

  const editor = redactModelsConfig(current);
  const serialized = JSON.stringify(editor);
  assert.doesNotMatch(serialized, /SUPER_SECRET_API_KEY|SUPER_SECRET_HEADER|SUPER_SECRET_MODEL_HEADER|private/);
  assert.equal(editor.providers.secure.apiKey, undefined);
  assert.equal(editor.providers.secure.headers, undefined);
  assert.equal(editor.providers.secure.models[0].headers, undefined);
  assert.equal(editor.providers.secure.originalName, "secure");
  assert.equal(editor.providers.secure.models[0].originalId, "model");
  assert.equal(editor.providers.secure.apiKeyConfigured, true);
  assert.equal(editor.providers.secure.headersConfigured, true);

  const preserved = mergeRedactedModelsConfig(current, editor, "full");
  assert.equal(preserved.providers.secure.apiKey, "SUPER_SECRET_API_KEY");
  assert.deepEqual(preserved.providers.secure.headers, current.providers.secure.headers);
  assert.deepEqual(preserved.providers.secure.models[0].headers, current.providers.secure.models[0].headers);
  assert.deepEqual(preserved.topLevelFuture, current.topLevelFuture);
  assert.equal(preserved.providers.secure.futureProviderField.keep, "round-trippable");
  assert.equal(preserved.providers.secure.apiKeyConfigured, undefined);
  assert.equal(preserved.providers.secure.headersConfigured, undefined);
  assert.equal(preserved.providers.secure.originalName, undefined);
  assert.equal(preserved.providers.secure.models[0].originalId, undefined);

  const replaced = mergeRedactedModelsConfig(current, {
    ...editor,
    providers: {
      ...editor.providers,
      secure: {
        ...editor.providers.secure,
        apiKey: "REPLACEMENT_KEY",
        headers: { "X-New": "replacement" },
        models: [{ ...editor.providers.secure.models[0], headers: { "X-Model": "replacement" } }],
      },
    },
  }, "full");
  assert.equal(replaced.providers.secure.apiKey, "REPLACEMENT_KEY");
  assert.deepEqual(replaced.providers.secure.headers, { "X-New": "replacement" });
  assert.deepEqual(replaced.providers.secure.models[0].headers, { "X-Model": "replacement" });

  const cleared = mergeRedactedModelsConfig(current, {
    ...editor,
    providers: {
      ...editor.providers,
      secure: {
        ...editor.providers.secure,
        apiKey: null,
        headers: null,
        models: [{ ...editor.providers.secure.models[0], headers: null }],
      },
    },
  }, "full");
  assert.equal(cleared.providers.secure.apiKey, undefined);
  assert.equal(cleared.providers.secure.headers, undefined);
  assert.equal(cleared.providers.secure.models[0].headers, undefined);
});

test("merges a partial provider without dropping prior fields or secrets", () => {
  const current = {
    providers: {
      secure: {
        baseUrl: "https://api.example.com/v1",
        api: "future-api",
        compat: { supportsReasoningEffort: true },
        modelOverrides: { model: { contextWindow: 200000 } },
        unknownProviderField: { keep: "round-trippable" },
        apiKey: "SUPER_SECRET_API_KEY",
        headers: { Authorization: "Bearer SUPER_SECRET_HEADER" },
        models: [
          { id: "kept", api: "future-api", headers: { Authorization: "Bearer SUPER_SECRET_MODEL_HEADER" } },
          { id: "removed", api: "future-api", headers: { "X-Removed": "private" } },
        ],
      },
      other: { api: "future-api", unknownField: "preserve-or-delete" },
    },
  };

  const partial = mergeRedactedModelsConfig(current, {
    providers: { secure: { baseUrl: "https://new.example.com/v2" } },
  }, "partial");
  const provider = partial.providers.secure;
  assert.equal(provider.baseUrl, "https://new.example.com/v2");
  assert.equal(provider.api, current.providers.secure.api);
  assert.deepEqual(provider.compat, current.providers.secure.compat);
  assert.deepEqual(provider.modelOverrides, current.providers.secure.modelOverrides);
  assert.deepEqual(provider.unknownProviderField, current.providers.secure.unknownProviderField);
  assert.equal(provider.apiKey, current.providers.secure.apiKey);
  assert.deepEqual(provider.headers, current.providers.secure.headers);
  assert.deepEqual(provider.models, current.providers.secure.models);
  assert.equal(provider.apiKeyConfigured, undefined);
  assert.equal(provider.headersConfigured, undefined);
  assert.deepEqual(partial.providers.other, current.providers.other);

  const partialWithMarkers = mergeRedactedModelsConfig(current, {
    providers: {
      secure: {
        baseUrl: "https://partial.example.com/v1",
        apiKeyConfigured: false,
        headersConfigured: false,
      },
    },
  }, "partial");
  assert.deepEqual(partialWithMarkers.providers.secure.compat, current.providers.secure.compat);
  assert.deepEqual(partialWithMarkers.providers.secure.models, current.providers.secure.models);
  assert.deepEqual(partialWithMarkers.providers.other, current.providers.other);
  assert.equal(partialWithMarkers.providers.secure.apiKeyConfigured, undefined);
  assert.equal(partialWithMarkers.providers.secure.headersConfigured, undefined);

  const replacedModels = mergeRedactedModelsConfig(current, {
    providers: {
      secure: {
        models: [{ id: "kept", api: "future-api" }],
      },
    },
  }, "partial");
  assert.deepEqual(replacedModels.providers.secure.models.map((model) => model.id), ["kept"]);
  assert.deepEqual(replacedModels.providers.secure.models[0].headers, current.providers.secure.models[0].headers);

  const fullWithoutOptionalFields = JSON.parse(JSON.stringify(redactModelsConfig(current)));
  delete fullWithoutOptionalFields.providers.secure.models;
  delete fullWithoutOptionalFields.providers.other;
  delete fullWithoutOptionalFields.providers.secure.compat;
  delete fullWithoutOptionalFields.providers.secure.modelOverrides;
  delete fullWithoutOptionalFields.providers.secure.unknownProviderField;
  const fullReplacement = mergeRedactedModelsConfig(current, fullWithoutOptionalFields, "full");
  assert.equal(fullReplacement.providers.secure.models, undefined);
  assert.equal(fullReplacement.providers.other, undefined);
  assert.equal(fullReplacement.providers.secure.compat, undefined);
  assert.equal(fullReplacement.providers.secure.modelOverrides, undefined);
  assert.equal(fullReplacement.providers.secure.unknownProviderField, undefined);
  assert.equal(fullReplacement.providers.secure.apiKey, current.providers.secure.apiKey);
  assert.deepEqual(fullReplacement.providers.secure.headers, current.providers.secure.headers);
  assert.equal(fullReplacement.providers.secure.apiKeyConfigured, undefined);
  assert.equal(fullReplacement.providers.secure.headersConfigured, undefined);
});

test("a redacted partial patch preserves omitted provider peers", () => {
  const current = {
    providers: {
      edited: {
        api: "future-api",
        baseUrl: "https://edited.example.com/v1",
        apiKey: "EDITED_SECRET",
        headers: { "X-Edited": "private" },
      },
      preserved: {
        api: "future-api",
        baseUrl: "https://preserved.example.com/v1",
        apiKey: "PRESERVED_SECRET",
        headers: { "X-Preserved": "private" },
      },
    },
  };
  const redacted = redactModelsConfig(current);
  const patch = { providers: { edited: { ...redacted.providers.edited, baseUrl: "https://edited.example.com/v2" } } };
  const merged = mergeRedactedModelsConfig(current, patch, "partial");
  assert.equal(merged.providers.edited.baseUrl, "https://edited.example.com/v2");
  assert.deepEqual(merged.providers.preserved, current.providers.preserved);
  assert.equal(merged.providers.edited.apiKey, "EDITED_SECRET");
  assert.deepEqual(merged.providers.edited.headers, current.providers.edited.headers);
});

test("provider rename follows originalName and strips identity metadata", () => {
  const current = {
    providers: {
      "old-name": {
        api: "future-api",
        apiKey: "PROVIDER_SECRET",
        headers: { "X-Provider": "private" },
        models: [{ id: "model", headers: { "X-Model": "private" } }],
      },
    },
  };
  const editor = redactModelsConfig(current);
  const renamed = mergeRedactedModelsConfig(current, {
    providers: {
      newName: { ...editor.providers["old-name"] },
    },
  }, "full");

  assert.equal(renamed.providers["old-name"], undefined);
  assert.equal(renamed.providers.newName.apiKey, "PROVIDER_SECRET");
  assert.deepEqual(renamed.providers.newName.headers, current.providers["old-name"].headers);
  assert.equal(renamed.providers.newName.models[0].originalId, undefined);
  assert.equal(renamed.providers.newName.originalName, undefined);
  assert.doesNotMatch(serializeModelsConfig(renamed), /originalName|originalId|apiKeyConfigured|headersConfigured/);
});

test("model id rename follows originalId and explicit null clears protected headers", () => {
  const current = {
    providers: {
      provider: {
        api: "future-api",
        apiKey: "PROVIDER_SECRET",
        headers: { "X-Provider": "private" },
        models: [{ id: "old-model", headers: { "X-Model": "private" } }],
      },
    },
  };
  const editor = redactModelsConfig(current);
  const renamedEditor = {
    providers: {
      provider: {
        ...editor.providers.provider,
        models: [{ ...editor.providers.provider.models[0], id: "new-model" }],
      },
    },
  };
  const renamed = mergeRedactedModelsConfig(current, renamedEditor, "full");
  assert.equal(renamed.providers.provider.models[0].id, "new-model");
  assert.deepEqual(renamed.providers.provider.models[0].headers, current.providers.provider.models[0].headers);
  assert.equal(renamed.providers.provider.models[0].originalId, undefined);

  const cleared = mergeRedactedModelsConfig(current, {
    providers: {
      renamedProvider: {
        ...renamedEditor.providers.provider,
        originalName: "provider",
        apiKey: null,
        headers: null,
        models: [{ ...renamedEditor.providers.provider.models[0], headers: null }],
      },
    },
  }, "full");
  assert.equal(cleared.providers.provider, undefined);
  assert.equal(cleared.providers.renamedProvider.apiKey, undefined);
  assert.equal(cleared.providers.renamedProvider.headers, undefined);
  assert.equal(cleared.providers.renamedProvider.models[0].headers, undefined);
});

test("ambiguous editor identities fail with structured validation diagnostics", () => {
  const current = {
    providers: {
      original: { api: "future-api", models: [{ id: "model" }] },
    },
  };
  assert.throws(
    () => mergeRedactedModelsConfig(current, {
      providers: {
        first: { originalName: "original", models: [{ id: "model", originalId: "model" }] },
        second: { originalName: "original", models: [{ id: "model", originalId: "model" }] },
      },
    }, "full"),
    (error) => {
      assert.ok(error instanceof ModelsConfigValidationError);
      assert.ok(error.issues.some((entry) => entry.path === "providers.second.originalName"));
      return true;
    },
  );

  assert.throws(
    () => mergeRedactedModelsConfig(current, {
      providers: { renamed: { originalName: "missing" } },
    }, "full"),
    (error) => {
      assert.ok(error instanceof ModelsConfigValidationError);
      assert.deepEqual(error.issues, [{ path: "providers.renamed.originalName", message: "must identify a provider in the current configuration" }]);
      return true;
    },
  );

  assert.throws(
    () => mergeRedactedModelsConfig(current, {
      providers: {
        original: {
          models: [{ id: "new-model", originalId: "missing-model" }],
        },
      },
    }, "full"),
    (error) => {
      assert.ok(error instanceof ModelsConfigValidationError);
      assert.deepEqual(error.issues, [{ path: "providers.original.models[0].originalId", message: "must identify an existing model in the current configuration" }]);
      return true;
    },
  );
});

test("duplicate resulting model IDs fail instead of creating ambiguous metadata", () => {
  const current = {
    providers: {
      provider: {
        api: "future-api",
        models: [{ id: "first" }, { id: "second" }],
      },
    },
  };
  const editor = redactModelsConfig(current);
  assert.throws(
    () => mergeRedactedModelsConfig(current, {
      providers: {
        provider: {
          ...editor.providers.provider,
          models: [
            { ...editor.providers.provider.models[0], id: "same" },
            { ...editor.providers.provider.models[1], id: "same" },
          ],
        },
      },
    }, "full"),
    (error) => {
      assert.ok(error instanceof ModelsConfigValidationError);
      assert.ok(error.issues.some((entry) => entry.path === "providers.provider.models[1].id"));
      return true;
    },
  );
});

test("validation rejects duplicate model IDs within one provider", () => {
  assert.throws(
    () => validateModelsConfig({
      providers: {
        provider: {
          baseUrl: "https://api.example.com/v1",
          api: "future-api",
          auth: "none",
          models: [{ id: "same" }, { id: "same" }],
        },
      },
    }),
    (error) => {
      assert.ok(error instanceof ModelsConfigValidationError);
      assert.deepEqual(error.issues, [{
        path: "providers.provider.models[1].id",
        message: "duplicates the model id at index 0",
      }]);
      assert.doesNotMatch(error.message, /same/);
      return true;
    },
  );
});

test("validation allows the same model ID in separate providers", () => {
  validateModelsConfig({
    providers: {
      first: {
        baseUrl: "https://first.example.com/v1",
        api: "future-api",
        auth: "none",
        models: [{ id: "shared" }],
      },
      second: {
        baseUrl: "https://second.example.com/v1",
        api: "future-api",
        auth: "none",
        models: [{ id: "shared" }],
      },
    },
  });
});

test("models route rejects unknown merge modes with structured diagnostics", () => {
  const source = readFileSync(new URL("../../app/api/models-config/route.ts", import.meta.url), "utf8");
  assert.match(source, /modeParam !== null && modeParam !== "full" && modeParam !== "partial"/);
  assert.match(source, /const mode = modeParam === "full" \? "full" : "partial"/);
  assert.match(source, /mergeRedactedModelsConfig\(current\.config, body as ModelsConfigEditor, mode\)/);
  assert.match(source, /path: "mode", message: "must be full or partial"/);
  assert.match(source, /status: 400/);
});

test("validation rejects non-HTTP(S) base URLs with path-specific diagnostics", () => {
  assert.throws(
    () => validateModelsConfig({
      providers: {
        broken: {
          baseUrl: "ftp://api.example.com/v1",
          api: "future-api",
          auth: "none",
          models: [{ id: "model" }],
        },
      },
    }),
    (error) => {
      assert.ok(error instanceof ModelsConfigValidationError);
      assert.deepEqual(error.issues, [{ path: "providers.broken.baseUrl", message: "must be a valid HTTP(S) URL" }]);
      assert.doesNotMatch(error.message, /ftp:\/\//);
      return true;
    },
  );
});

test("validation accepts arbitrary future API identifiers", () => {
  validateModelsConfig({
    providers: {
      future: {
        baseUrl: "https://api.example.com/v1",
        api: "vendor-future-api-v3",
        auth: "none",
        models: [{ id: "model" }],
      },
    },
  });
});

function withAgentDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "ompgui-models-config-"));
  const previous = {
    agentDir: process.env.PI_CODING_AGENT_DIR,
    ompProfile: process.env.OMP_PROFILE,
    piProfile: process.env.PI_PROFILE,
    xdg: process.env.XDG_DATA_HOME,
  };
  process.env.PI_CODING_AGENT_DIR = dir;
  delete process.env.OMP_PROFILE;
  delete process.env.PI_PROFILE;
  delete process.env.XDG_DATA_HOME;
  try {
    run(dir, join(dir, "models.yml"));
  } finally {
    for (const [key, value] of [
      ["PI_CODING_AGENT_DIR", previous.agentDir],
      ["OMP_PROFILE", previous.ompProfile],
      ["PI_PROFILE", previous.piProfile],
      ["XDG_DATA_HOME", previous.xdg],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("round-trips a hand-edited models.yml without losing comments", () => {
  withAgentDir((dir, path) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, HAND_EDITED, "utf8");

    const file = readModelsConfigFile();
    assert.equal(file.parseError, undefined);
    assert.deepEqual(Object.keys(file.config.providers), ["local-llama", "work-proxy"]);

    // Edit exactly what the editor would: bump a model's maxTokens.
    file.config.providers["local-llama"].models[0].maxTokens = 16384;
    writeModelsConfig(file.config);

    const written = readFileSync(path, "utf8");
    assert.match(written, /# Custom providers for omp\./);
    assert.match(written, /# Keep the local llama entry first\./);
    assert.match(written, /# llama\.cpp server/);
    assert.match(written, /# 70B, quantized/);
    assert.match(written, /maxTokens: 16384/);
    assert.match(written, /apiKey: "!op read op:\/\/work\/openai\/key"/);
    assert.equal(readModelsConfigFile().config.providers["local-llama"].models[0].maxTokens, 16384);
  });
});

test("a save with no edits leaves the file byte-identical", () => {
  withAgentDir((dir, path) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, HAND_EDITED, "utf8");
    writeModelsConfig(readModelsConfigFile().config);
    assert.equal(readFileSync(path, "utf8"), HAND_EDITED);
  });
});

test("keeps a model's comments with the model when siblings are removed", () => {
  withAgentDir((dir, path) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, HAND_EDITED, "utf8");

    const { config } = readModelsConfigFile();
    // Drop the first model: with positional merging the 3B entry would inherit
    // the 70B node and "# small, fast" would be dropped with it.
    config.providers["local-llama"].models.splice(0, 1);
    writeModelsConfig(config);

    const written = readFileSync(path, "utf8");
    assert.match(written, /# small, fast\n\s+- id: llama-3\.2-3b/);
    assert.doesNotMatch(written, /llama-3\.3-70b/);
    // "# 70B, quantized" preceded the first item, so YAML attaches it to the
    // sequence rather than the item — it survives the deletion by design.
  });
});

test("adds and removes providers", () => {
  withAgentDir((dir, path) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, HAND_EDITED, "utf8");

    const { config } = readModelsConfigFile();
    delete config.providers["work-proxy"];
    config.providers["new-provider"] = {
      baseUrl: "https://api.example.com/v1",
      apiKey: "EXAMPLE_KEY",
      api: "openai-completions",
      models: [{ id: "example-1", contextWindow: 8000 }],
    };
    writeModelsConfig(config);

    const reread = readModelsConfigFile();
    assert.deepEqual(Object.keys(reread.config.providers), ["local-llama", "new-provider"]);
    assert.equal(reread.config.providers["new-provider"].models[0].contextWindow, 8000);
    assert.match(readFileSync(path, "utf8"), /# Custom providers for omp\./);
  });
});

test("reports a parse error instead of an empty config", () => {
  withAgentDir((dir, path) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, "providers:\n  broken: [unclosed\n", "utf8");

    const file = readModelsConfigFile();
    assert.ok(file.parseError, "expected a parse error");
    assert.deepEqual(file.config, { providers: {} });
  });
});

test("refuses to overwrite an unparseable models.yml", () => {
  withAgentDir((dir, path) => {
    mkdirSync(dir, { recursive: true });
    const broken = "providers:\n  broken: [unclosed\n";
    writeFileSync(path, broken, "utf8");

    assert.throws(
      () => writeModelsConfig({ providers: {} }),
      (error) => error instanceof ModelsConfigParseError,
    );
    assert.equal(readFileSync(path, "utf8"), broken, "the broken file must be left untouched");

    writeModelsConfig({ providers: { a: { baseUrl: "https://x/v1", apiKey: "K", api: "openai-completions" } } }, { overwriteUnparseable: true });
    assert.deepEqual(Object.keys(readModelsConfigFile().config.providers), ["a"]);
  });
});

test("treats a non-mapping models.yml as unparseable", () => {
  withAgentDir((dir, path) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, "- one\n- two\n", "utf8");
    assert.ok(readModelsConfigFile().parseError);
  });
});

test("writes a fresh file when none exists", () => {
  withAgentDir((dir, path) => {
    const file = readModelsConfigFile();
    assert.equal(file.exists, false);
    writeModelsConfig({ providers: { p: { baseUrl: "https://x/v1", apiKey: "K", api: "openai-completions", models: [{ id: "m" }] } } });
    assert.match(readFileSync(path, "utf8"), /id: m/);
  });
});

test("serializeModelsConfig without a source still emits plain YAML", () => {
  const text = serializeModelsConfig({ providers: { p: { api: "openai-completions" } } });
  assert.match(text, /providers:\n {2}p:\n {4}api: openai-completions/);
});

test("validation rejects partial model cost but accepts a complete one", () => {
  const base = {
    providers: {
      p: {
        baseUrl: "https://api.example.com/v1",
        api: "openai-completions",
        auth: "none",
        models: [{ id: "m", cost: { input: 1, output: 2 } }],
      },
    },
  };

  assert.throws(
    () => validateModelsConfig(base),
    /cost\.cacheRead is required/,
  );

  validateModelsConfig({
    ...base,
    providers: {
      p: {
        ...base.providers.p,
        models: [{ id: "m", cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 2 } }],
      },
    },
  });
});

test("ignores blank model rows while preserving non-empty rows", () => {
  withAgentDir((dir, path) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, "providers:\n  p:\n    models:\n      - id: \"\"\n      - id: \"   \"\n      - id: valid\n", "utf8");

    const file = readModelsConfigFile();
    assert.deepEqual(file.config.providers.p.models.map((model) => model.id), ["valid"]);
    writeModelsConfig(file.config);
    assert.deepEqual(readModelsConfigFile().config.providers.p.models.map((model) => model.id), ["valid"]);
  });
});
