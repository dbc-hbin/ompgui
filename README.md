# ompgui

[English](./README.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [简体中文](./README.zh-CN.md)

> **Android APK (Android 12+)** — Use the Kotlin companion app to connect to a remote ompgui server, with a read-only offline snapshot of the latest session. [Download ompgui Remote v0.7.10](https://github.com/dbc-hbin/ompgui/releases/download/android-v0.7.10/ompgui-remote-v0.7.10.apk) · [Release notes](https://github.com/dbc-hbin/ompgui/releases/tag/android-v0.7.10)

> The Kotlin companion app in `android/` uses authenticated `/relay` WebSockets for session/history controls and rich online transcripts with linked messages, tool calls/results/errors, and media references, plus offline Mermaid diagrams and code highlighting and inline image/PDF/audio/HTML/Markdown/DOCX previews. Online history is independent of the protected offline snapshot: bounded previews fetch full text through `sessions.content` and paginate media references, rather than truncating the transcript at 4,000 characters. Offline cache privacy restrictions remain unchanged. Visible-only file auto-refresh preserves unsaved edits; browsing supports allowed hidden files and archive search. Models/settings include the public models.dev catalog, advanced OMP settings, and actual per-session MCP runtime status shown separately from configuration. Attachments are streamed into staging rather than packed into one giant phone JSON payload: up to 10 images at 10 MiB each and, independently, 10 text attachments at 256 KiB each. OMP's own image normalization and provider-specific image-count limi…
>
> **Current settings:** Web and the Android APK now use the same searchable, categorized OMP settings catalog, including scope, inheritance, reset, validation, and guarded secret/admin controls. The device-local thinking-visibility switch only changes transcript rendering; final answers remain visible.
>
> Its native interface follows the web app’s Warm and OMP palettes, with a compact project/session tree, a Settings/Usage footer, and a compact composer with a single-row toolbar. History, session information, commands, and runtime controls live in the session menu; secondary workspace actions remain in overflow menus. Runtime controls use expandable tree categories with aligned current values. Settings use compact row selectors, and dropdown menus are anchored to their triggers. Native Android controls, file pickers, sheet navigation, and distinct touch regions of at least 48 dp are retained.
>
> This companion client does not add a hosted/E2E relay. To build, use JDK 21, run `npm install` at the repository root, then run `./gradlew :app:assembleDebug` from `android/`; offline assets are generated from the installed npm dependencies. Output: `android/app/build/outputs/apk/debug/app-debug.apk`. Server-disabled update, logout, and stored API-key mutations remain unavailable.

Local web UI for the [oh-my-pi (omp) coding agent](https://github.com/can1357/oh-my-pi). ompgui reads your local omp session files and gives you a browser workspace for session browsing, real-time chat, model configuration, skill management, and project file preview.

![ompgui — light theme](docs/screenshot-light.png)

<details>
<summary>Dark theme</summary>

![ompgui — dark theme](docs/screenshot-dark.png)

</details>

## Requirements

- [omp](https://github.com/can1357/oh-my-pi) installed and on your `PATH` (or point `OMP_WEB_OMP_BIN` at the binary)
- Node.js 22.19.0 or newer (`node --version`)

## Quick Start

**Run without installing:**

```bash
npx ompgui@latest
```

**Or install globally:**

```bash
npm install -g ompgui
ompgui
```

Update a global installation with `ompgui update`. On macOS, a running managed background service belonging to this installation is fully stopped before updating, then restarted; browser and mobile clients briefly disconnect. A stopped service stays stopped, and an uninstalled service is not installed. Service settings, including authentication, relay, and login auto-start, are retained. If installation or version verification fails after stopping the service, the updater attempts to start it again using the installation still available; this is recovery, not a package rollback, and recovery can fail.

Then open [http://127.0.0.1:30177](http://127.0.0.1:30177). The CLI will try to open the browser automatically after the server is ready. ompgui listens on `127.0.0.1` by default.

**Options:**

```bash
ompgui --port 8080              # custom port
ompgui --hostname 0.0.0.0       # expose on a trusted network
ompgui -p 8080 -H 0.0.0.0       # combine options
ompgui --no-open                # do not open the browser automatically
ompgui --password "a-long-random-password" # password-only sign-in without POSIX inline-env syntax

PORT=8080 ompgui                # environment variable is also supported
OMP_WEB_HOSTNAME=0.0.0.0 ompgui # explicit network exposure
OMP_WEB_PASSWORD='a-long-random-password' ompgui # env-variable form (POSIX: inline or exported)
OMP_WEB_NO_OPEN=1 ompgui        # useful when running as a background service

# Windows (PowerShell / CMD)
# $env:OMP_WEB_PASSWORD="a-long-random-password"; ompgui
# or
# ompgui --password "a-long-random-password"
```

Set `OMP_WEB_PASSWORD` (or pass `--password`) to protect the interface and every API endpoint with a themed, password-only sign-in screen. A successful sign-in creates an HTTP-only signed session cookie for 30 days; changing the configured password invalidates existing sessions. Leaving the variable unset disables authentication. Remote use still requires HTTPS through a trusted reverse proxy or VPN so the password and session cookie cannot be intercepted. On Windows the env-variable syntax is `$env:OMP_WEB_PASSWORD="..."`; `ompgui --password "..."` works in every shell without that extra step.

### macOS background service

Bare `ompgui` runs in the foreground. For a persistent per-user macOS LaunchAgent, install the published npm package and set up the service from a terminal on the Mac. Installing a development checkout as the service is not supported.

```bash
npm install -g ompgui@latest
ompgui service install         # install, enable login auto-start, and start now
ompgui status                  # inspect service state
```

For a new service, `service install` accepts `--port`, `--hostname`, and `--password` as above. An existing `com.hanbinnoh.ompgui` service definition is validated and reused, preserving its paths, environment, and secrets; rerunning setup does not replace its settings with newly supplied flags.

Use these commands as needed (not as a sequence):

```bash
ompgui service enable          # enable login auto-start
ompgui service disable         # disable login auto-start; keep running and retain configuration
ompgui start                   # start the installed service now
ompgui stop                    # stop now; leave login auto-start unchanged
ompgui restart                 # restart now
ompgui service uninstall       # stop and remove the service definition, including saved service secrets
```

The browser GUI exposes these controls under **Settings → System & Updates → Background service** on macOS; the Android APK has no daemon controls. Stopping or uninstalling the server disconnects browser and mobile clients, so this page cannot start it again. After stopping, run `ompgui start` in the Mac's terminal to reconnect; after uninstalling, run `ompgui service install` again. If a foreground `ompgui` occupies the configured port, stop it with **Ctrl+C in its terminal** before installing or starting the service. The service commands do not kill an arbitrary process occupying the port.

## Remote & Mobile Access (Tailscale Recommended)

For accessing `ompgui` from mobile devices (iPhone, iPad, Android) or external laptops, **using [Tailscale](https://tailscale.com/) is strongly recommended**. Tailscale creates a private, point-to-point WireGuard mesh VPN between your devices without exposing your host machine to the public internet or requiring port forwarding.

### 1. Configure Password (Required for Remote Access)

When binding to external network interfaces, setting a password is required to secure the workspace:

```bash
# CLI option: bind to all interfaces with a password
ompgui -H 0.0.0.0 --password "your-strong-password"

# Or via environment variables
OMP_WEB_HOSTNAME=0.0.0.0 OMP_WEB_PASSWORD="your-strong-password" ompgui
```

### 2. Steps to Connect via Tailscale

1. **Install Tailscale**: Download and sign into [Tailscale](https://tailscale.com/download) on both your host machine and your mobile device using the same account.
2. **Start ompgui on your host machine**:
   ```bash
   ompgui --hostname 0.0.0.0 --password "your-strong-password"
   ```
3. **Access from your mobile browser**:
   - Navigate to your host's Tailscale IP (e.g. `100.x.y.z`) or MagicDNS machine name:
     ```text
     http://100.x.y.z:30177
     # Or with MagicDNS enabled:
     http://my-macbook:30177
     ```
4. **Log in**: Enter your configured password to securely control and chat with your coding agent on mobile.

### Security and troubleshooting

- The server binds to `127.0.0.1` by default. A non-loopback hostname is an explicit opt-in and should only be used behind a trusted network boundary; ompgui is not safe to expose publicly.
- File APIs are allow-listed to the selected workspace, its valid Git worktrees, session-referenced directories, and explicitly selected roots. Paths are canonicalized to reject traversal and symlink escapes.
- `omp` is resolved from `OMP_WEB_OMP_BIN` first, then `PATH`. If live chat cannot start, run `omp --version` in the same terminal or set `OMP_WEB_OMP_BIN` to the executable's absolute path.
- Session history remains native OMP JSONL. OMP owns live-session writes; ompgui reads the files directly and only performs explicit title, archive, and delete maintenance when it is not racing a live OMP write.
- Session archive uses OMP's native `archive/sessions/<cwd>/<file>.jsonl.gz` layout and moves sibling artifacts with the transcript; the original JSONL bytes are preserved inside the gzip.

## Features

- **Pick work back up**: browse previous omp conversations by project without digging through terminal history or session paths.
- **Try different directions safely**: continue from an earlier message or fork a session into a separate route.
- **Keep the sidebar tidy**: archive an inactive session without deleting its native transcript, or delete it explicitly when it is no longer needed.
- **Work across branches**: switch Git worktrees from the sidebar so new sessions and the Explorer follow the checkout you choose.
- **Chat beside the project**: browse files on the left and preview source, docs, images, audio, and PDFs on the right while the agent works.
- **Preview markdown faithfully**: YAML frontmatter renders in a summary card (title + key/value rows), math fences stay aligned inside lists, and CJK ranges like `5~7U` are no longer mangled (GFM now requires `~~` for strikethrough).
- **Pick projects naturally on Windows**: a drive picker at the filesystem root and a case-folded, symlink-aware project identity keep the sidebar stable across drives and worktrees.
- **See session state clearly**: context usage, cost, compaction state, and system prompt details are visible from the top bar.
- **Configure OMP consistently**: web and Android share one searchable, categorized settings catalog for models, agents, tools, safety, and system behavior, with global/project inheritance, reset-to-default controls, and validated advanced values.
- **MCP management in Settings**: a dedicated MCP tab lists installed project servers with status (enabled / disabled / invalid), supports add/edit/rename/validate/remove, and surfaces configuration failures as corner toasts.
- **Keep OMP current**: check the installed runtime version, update it, and restart active sessions from Settings when needed.
- **Stay informed**: opt into browser notifications when an agent finishes, and check installed skills for updates.
- **Jump anywhere with ⌘K**: a command palette (⌘K / Ctrl+K) for switching sessions, starting new ones, and toggling the theme.
- **Warm, paper-like design**: light and dark themes with serif display type and WCAG AA-verified contrast, built on a token-driven UI kit (Base UI primitives, cmdk, lucide icons).

## Configuration

| Variable | Meaning |
| --- | --- |
| `PORT` | Server port (default `30177`; `-p/--port` wins) |
| `OMP_WEB_HOSTNAME` | Bind hostname (default `127.0.0.1`; `-H/--hostname` wins) |
| `OMP_WEB_PASSWORD` / `--password` | Password for the sign-in screen; `--password` works in every shell (PowerShell/CMD) without ` $env:` syntax |
| `OMP_WEB_NO_OPEN` | Set to `1`/`true` to skip auto-opening the browser |
| `OMP_WEB_OMP_BIN` | Absolute path to the `omp` binary when it is not on `PATH` |
| `PI_CODING_AGENT_DIR` | Point at another omp agent directory (default `~/.omp/agent`) |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Standard proxy variables for server-side requests |

### OMP settings

The web UI and Android APK render the same shared catalog with category/search navigation, defaults, global or project scope, inherited effective values, and reset. Global settings use `~/.omp/agent/config.yml`; only when it is absent and `config.yaml` already exists is that file used as the read/write fallback. Project settings use only the authorized workspace's canonical `.omp/config.yml`. Displayed effective values recursively merge the project layer over the global layer. On save, a structured record replaces the corresponding record in the selected layer, while ordered arrays retain their order. Numbers, enums, arrays, and structured values are validated before a minimal YAML update; unrelated keys and comments are preserved.

The displayed effective value is the saved global/project configuration, not the value of an already-running session and not environment-variable or CLI overrides. Changes are picked up by new or restarted sessions; saving does not automatically restart live RPC sessions. Changes marked by the catalog as confirmation-required require explicit confirmation. Secrets are write-only: clients receive presence status only and can replace or delete them, never read their stored value. The per-device thinking-visibility preference is local presentation only: it can hide thinking blocks without hiding the final answer.

## Architecture

ompgui is a Node-hosted Next.js app that drives your installed `omp` binary — it does not embed the agent:

- **Live sessions**: spawns `omp --mode rpc-ui` (NDJSON over stdio), one child process per active session, so the agent version is always exactly what you have installed. It negotiates RPC v2 when the installed OMP advertises it, uses bounded chunk reassembly for large frames, and falls back to v1 for older versions. Host env (`PORT`, `NEXT_*`, `NODE_ENV`) is stripped before spawn, and shutdown is graceful on both POSIX (process-group) and Windows (`taskkill /t`).
- **Session browsing**: reads omp's session files (`~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`) directly; title, archive, and delete are narrow native-file maintenance operations guarded against live OMP writes. Projects are grouped by a stable `projectKey` (Windows case-folded, symlink-resolved) so the sidebar doesn't jump between drives or worktrees.
- **Models and auth**: RPC commands against the omp child process with strict payload validation (unknown-shape guards, safe fallbacks); the Models panel edits `models.yml` in the omp agent directory, dropping blank placeholder rows and rejecting ambiguous `enabledModels` entries.
- **Native settings**: `lib/omp/settings-catalog.ts` defines the catalog shared by the web and Relay/Android clients, while the settings service returns catalog-filtered per-layer and effective values and applies validated minimal patches. Global and authorized project writes use OMP-compatible cross-process locks plus atomic replacement so native OMP and ompgui cannot overwrite one another's generation.
- **Skills and plugins**: scans omp's skill directories (`~/.omp/agent/skills`, project `.omp/skills`, and compat dirs) and shells out to `omp plugin` for plugin management.
- **MCP servers**: project servers are managed through OMP's native locations (`.omp/mcp.json`, then compatibility files) at the git top level, validated against the stdio/http/sse schema and written atomically.
- **File access**: file browsing and preview are scoped to the selected project directory and working directories that appear in sessions; paths are canonicalized via a single `isWindowsAbsolutePath`/`samePath` helper and symlink escapes are rejected after `realpath` resolution. On Windows the directory picker offers a drive list at the root.
- **Forks vs in-session branches**: Fork creates a new `.jsonl` file. "Edit from here" creates another branch inside the same session file.

- **Queued messages**: web and current Android clients share a server-owned, in-memory queue. Android keeps primary Steer/Queue actions in the compact composer; open **Session controls → Queue** explicitly to see the queue count and manage items. Typing does not add an automatic Execution/Queue bar. Recall restores text and images, delete discards an eligible item, and promotion changes a follow-up to steering subject to safe dispatch. Sending items cannot be edited. Snapshots expose image metadata only; private payload storage is bounded to 100 MiB total, with additional image count and byte limits. Image bytes return only in the one-shot recall response. Relay recalls over 15 MiB are refused before mutation and direct you to the web client. Browser reconnects recover pending items, but server-process restarts do not; older deployed clients retain compatible prompt entry points.
- **Session search**: choose Metadata or Body mode, with inclusive start/exclusive end dates, result snippets, and read-only match context. The private, derived Node/SQLite index is scoped to the current OMP profile and covers visible conversation text—not session metadata, images, credentials, hidden reasoning, or opaque payloads. Historical previews neither switch the active agent nor modify history.
- **Provider checks**: configuration checks validate structure only, without starting native OMP or contacting providers. A separate real connectivity test requires explicit approval of possible charges, uses a fixed prompt with a 32-token output limit, and sends at most one upstream request without tools. It supports OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages API shapes with submitted literal candidate credentials or explicit no-auth mode—not stored OAuth credentials. A configuration check alone does not establish connectivity.
- **Shared usage**: web HTTP, Relay snapshots, and Relay usage requests use the same server-side usage service.

## Development

```bash
npm install
npm run dev
```

The local dev server runs at [http://127.0.0.1:30178](http://127.0.0.1:30178).

Common checks:

```bash
npm run typecheck      # type check
npm run lint           # ESLint (zero warnings enforced)
npm test               # run test suite
npm run build          # production build
```

Avoid running `next build` / `npm run build` during local development. It writes to `.next/` and can interfere with the dev server; leave builds for release work.

## Internationalization

ompgui supports English, Simplified Chinese (简体中文), Japanese (日本語), and Korean (한국어) with translated UI strings across all languages. The language is auto-detected from `navigator.language` and can be switched at runtime via the language menu in the top bar. The choice persists across sessions.

- Dictionaries: `lib/i18n/locales/{en,zh-CN,ja,ko}.json`
- Framework: `lib/i18n/index.tsx` — a lightweight store built on `useSyncExternalStore` with `{var}` interpolation and plural support (`.one`/`.other`)
- API error messages are translated via stable error codes (`errors.<code>`) looked up client-side

## Quality

- **Accessibility**: WCAG AA compliant — Lighthouse a11y score 100/100, keyboard navigation throughout, focus-visible rings, ARIA roles
- **Performance**: memoized list components, RAF-gated scroll/mouse handlers, debounced search, streaming JSONL reader, ETag-cached session listing
- **Resilience**: graceful shutdown of spawned omp processes (process-group kill), error boundaries, atomic session file rewrites
- **Tests**: a focused test suite covering session parsing, terminal input, markdown rendering, message display, native settings, and MCP configuration

## Credits

ompgui is a fork of [agegr/pi-web](https://github.com/agegr/pi-web) (MIT), the web UI for the [earendil/pi-mono](https://github.com/earendil-works/pi) pi coding agent, adapted for [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi).

## License

MIT
