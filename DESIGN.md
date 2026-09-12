# ompgui — Product & Architecture Contract

## Purpose

ompgui is a local, browser-based workspace for the
[oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) coding agent. It lets a
user browse the same local sessions they use in the terminal, continue live
work, configure supported OMP settings, and inspect project files without
creating a second agent runtime or a second source of truth.

The project originated from [agegr/pi-web](https://github.com/agegr/pi-web)
(MIT), but it is maintained as an OMP-focused downstream. We preserve the
license and attribution, and selectively learn from upstream improvements; we
do not assume that Pi-specific implementation changes can be merged unchanged.

## Product principles

1. **OMP remains authoritative.** Sessions, credentials, providers, and agent
   behavior belong to the installed `omp` CLI. ompgui must not invent a
   parallel data format or credential store.
2. **Local-first by default.** The server binds to `127.0.0.1`; remote access
   is an explicit user choice and must be protected by a trusted network
   boundary and HTTPS.
3. **Node-first installation.** A normal user installs Node.js 22.19+ and OMP,
   then runs `npx ompgui@latest` or installs `ompgui` globally. ompgui does not
   require users to install Bun for its own runtime.
4. **Native compatibility over imitation.** Prefer OMP's CLI and documented
   on-disk formats to copied SDK internals. If a capability cannot be done
   safely through those boundaries, leave it out rather than emulating it
   speculatively.
5. **A calm, capable workspace.** The UI should make active work, session
   history, configuration, and project context understandable without hiding
   the agent's state or expanding the app into a general remote-control plane.

## Distribution and identity

- npm package and CLI command: `ompgui`.
- Default server address: `http://127.0.0.1:30177`.
- Existing `OMP_WEB_*` environment variables remain the configuration prefix
  for compatibility: `OMP_WEB_HOSTNAME`, `OMP_WEB_NO_OPEN`,
  `OMP_WEB_PASSWORD`, and `OMP_WEB_OMP_BIN`.
- `PI_CODING_AGENT_DIR`, profiles, and OMP's own directory conventions are
  respected because they identify the user’s existing OMP state.
- The web UI displays its own package version separately from the detected
  installed OMP version; those versions may legitimately differ.

## Runtime architecture

```
Browser
  │ HTTP / Server-Sent Events
  ▼
ompgui (Next.js on Node)
  ├─ reads native OMP sessions and catalog-filtered global/project settings
  ├─ serves allow-listed project files
  └─ starts one `omp --mode rpc-ui` child per active session
       │ NDJSON over stdio
       ▼
     installed OMP CLI and its existing ~/.omp/agent state
```

### Why the CLI boundary is locked

OMP SDK packages are Bun-only TypeScript and import Bun APIs. Importing
`@oh-my-pi/*` or `@earendil-works/*` into a Node/Next server would make the
application unreliable or non-runnable. Therefore, production code must not
add those runtime dependencies.

Live work goes through the user’s installed `omp --mode rpc-ui` process. This
keeps the agent version, providers, extensions, and session behavior aligned
with the CLI the user already trusts. The RPC layer negotiates v2 when the CLI
advertises it, reassembles bounded chunked frames, and remains compatible with
v1-capable installations.

## Data and mutation boundaries

### OMP-owned state

- `~/.omp/agent` (or OMP's configured/profiled equivalent) is the source of
  truth for sessions, configuration, models, skills, plugins, and blobs.
- `agent.db` contains authentication data. ompgui never reads or writes it;
  authentication actions go through the OMP RPC process.
- A live OMP process owns writes to its session file. ompgui routes supported
  live actions through RPC and never races a live file rewrite.

### Direct file access

Session browsing is implemented in pure Node against OMP JSONL files. The
reader tolerates the fixed title slot and older session shapes, resolves blob
references when needed, and builds the active branch context from the entry
tree.

Direct session mutation is deliberately narrow and explicit: rename/title,
archive, deletion, and required branch-parent maintenance. These writes are
atomic where possible; archive or deletion stops the associated live process
first. ompgui does not provide a general editor for session JSONL or opaque OMP
state.

Models use surgical YAML updates. Native OMP settings are defined once in
`lib/omp/settings-catalog.ts`; `/api/omp-settings` and Relay's `settings.get` /
`settings.update` call the same settings service, so browser and Android receive
the same catalog, validation, scope policy, redaction, confirmation rules, and
per-layer/effective-value DTOs. Values in that DTO are saved configuration, not
live-session state or environment/CLI overrides; clients supply catalog defaults
for absent effective values.

The global layer reads `~/.omp/agent/config.yml`, falling back to an existing
`config.yaml`; an authorized project layer reads and writes only `.omp/config.yml`.
Project values recursively merge over global values for display; a null project
model-role entry inherits the global role, and ordered role-selector arrays are
preserved. Scoped model/provider registry arrays that the simple editor cannot
represent are marked read-only and protected against replacement or reset.
A save applies a minimal leaf patch, with structured records replacing that record at the selected
layer and ordered arrays remaining ordered; reset removes the selected-layer leaf
so defaults or inheritance apply. Catalog-designated secret values are never
returned, only presence, and sensitive changes fail closed without their required
confirmation. YAML aliases are isolated before mutation so editing an anchor
does not change unrelated alias consumers. Unrelated YAML and comments are
preserved. New or restarted OMP sessions consume saved changes; ompgui does not
silently restart a live RPC child.

Every settings read-modify-write holds OMP's native cross-process config lock and
then performs an atomic replacement. The Node implementation uses `koffi` for the
platform primitives and `xxhash-wasm` for OMP-compatible lock names; Darwin
interoperability has been exercised, while the Linux and Windows implementations
are source-complete but were not runtime-tested in that verification pass.
Configuration replacements use exclusive, owner-only temporary files, and project
targets are checked through symlinks before directories are created.

Plugin operations run the installed `omp plugin` CLI. MCP configuration is
project-local, validated before writing, and saved atomically. Renaming a server
to an existing name returns HTTP 409 without overwriting either configuration.

### Server-owned pre-dispatch queue

Queued composer work is stored on the live `AgentSessionWrapper`, not in OMP
and not in the browser. Each session queue has a monotonic revision and
immutable snapshots. Inserts validate a finite item count and UTF-8 byte
budget before they land. Mutations are synchronous compare-and-mutate: a
stale revision, a missing id, or an item that is already sending is rejected
visibly. `get_state` and SSE `message_queue_update` events (including replay to a
new listener) are the reconnect source of truth.
Item IDs are unique across wrapper lifetimes. This is an in-memory queue:
browser reloads recover pending work, but a server-process restart does not
persist it to disk. Image bytes stay in private wrapper storage; public queue
snapshots carry attachment metadata, not image payloads. Image count, byte, and
aggregate queue-memory limits (100 MiB total private payload storage) are enforced
before mutation. Recall returns image payloads only in its one-shot response,
restores text and attachments to the composer, and removes the item only after preflight;
a Relay recall exceeding 15 MiB is refused without changing the queue and directs
the user to the web client.

Scheduling stays on that wrapper. Follow-ups dispatch one at a time, and only
when the current run, shell, compaction, native in-flight work, and any
still-live OMP `queuedMessageCount` have settled. A terminal `agent_end`
refreshes that native count with a generation fence so a previously observed
positive count cannot stall server follow-ups after OMP has consumed them.
Steering may go immediately during text streaming, but is held while
tool executions observed from protocol events are active; it is released at
tool completion or the turn boundary, and becomes an ordinary `prompt` if the
session is idle. There is no timer-based drain.

The selected item is marked sending before the first await and is forwarded
at most once through OMP `prompt`. Active steering uses
`streamingBehavior: "steer"` so builtin slash commands can still ack
`agentInvoked: false`; idle items are ordinary prompts. Success removes it from the
server queue (it is no longer editable). Failure or timeout keeps the failed
item with an honest uncertain-handoff error; the wrapper does not auto-retry
or auto-resume past that failure. Failed items may be recalled to the composer
or deleted.

A user abort holds remaining follow-ups so Stop stays useful. Resume is
explicit: a later `enqueue_message`, `promote_queued_message`, or ordinary
`prompt`. Restart/reload of the same wrapper may keep pending items but never
replays a sending entry (it is marked failed). Destroy, session switch, and
child replacement bump an epoch so a stale async forward cannot land on the
wrong session or resurrect a discarded queue; teardown may cancel leftover
items with a notice.

### Session search and provider checks

Metadata search and indexed body search are distinct modes. Body search uses a
private, derived Node/SQLite index scoped to the current OMP profile. It covers
visible conversation text, not session metadata, images, credentials, hidden
reasoning, or opaque payloads. Date filters use an inclusive `from` and exclusive
`to`. Results include snippets and read-only match context; opening historical
context neither switches the active agent nor rewrites session history. The index
and snippets contain private conversation data and stay within authenticated access.

Model configuration checks validate structure only: they neither start a native
OMP process nor contact a provider. A real connectivity test requires explicit
cost approval and makes at most one provider request using a fixed prompt and a
32-token output limit. Only OpenAI Chat Completions, OpenAI Responses, and Anthropic
Messages API shapes are supported, using submitted literal candidate credentials
or explicit no-auth mode—not stored OAuth credentials. It does not run tools or
make other upstream requests. Passing a configuration check does not prove
connectivity or account access.

## Security contract

- Bind loopback-only by default. A non-loopback hostname is an explicit opt-in.
- `OMP_WEB_PASSWORD` protects every route with a password-only sign-in screen.
  Successful sign-in creates an HTTP-only, signed cookie with a 30-day expiry;
  changing the configured password invalidates existing sessions. Exposed
  deployments require HTTPS through a trusted reverse proxy or VPN.
- API requests are origin-checked. Do not add browser-to-host execution paths
  that bypass this boundary.
- Untrusted file responses own their restrictive content security policy;
  the application's script policy must not override SVG or document isolation.
- OMP RPC host tools are intentionally not registered. A browser request must
  not become arbitrary host command execution through an extension callback.
- File APIs are not a general filesystem browser. They are restricted to
  selected workspaces, valid Git worktrees, session-referenced directories, and
  explicitly selected roots. Paths are canonicalized to reject traversal and
  symlink escapes.
- Secrets, raw API keys, and auth database contents never appear in API
  responses, logs, or the browser.
- `/relay` is a WebSocket for paired phone remotes on the same Next.js port
  (Tailscale Funnel 443). It is not cookie-authenticated. A Mac-side pairing
  offer (Settings → Connect Phone, or `/pair` / `ompgui pair`) issues a
  one-time secret; the phone then holds a device token whose hash is stored
  in `~/.omp/agent/ompgui-relay.json`.
  Pairing secrets and tokens are never logged. After authenticated hello,
  correlated domain requests expose a finite, validated action set for
  `sessions`, `files`, `models`, `extensions`, and `system`, alongside session
  snapshots and live events. Online transcripts are independent of the protected
  offline replica and include tool calls, results, errors, and media references.
  Bounded snapshot previews do not impose a 4,000-character transcript limit:
  `sessions.content` retrieves full text in bounded pages, and media references
  are paginated separately. Offline cache privacy restrictions remain unchanged.
  This is not arbitrary RPC forwarding. Large
  messages use bounded chunk transport; file transfers also enforce ownership,
  size limits, and expiry. Deferred mutations recheck device authorization and
  connection/session selection before committing, rather than trusting only
  the initial request.
- Prompt images are staged in bounded, expiring uploads owned by the
  authenticated device. Completed attachments are claimed once for a prompt;
  consumption, cancellation, expiry, session navigation, disconnection, and
  revocation clean up staging rather than exposing reusable host paths.
- The experimental native Android app is a Compose client of this socket, not
  a Capacitor WebView of the desktop UI. Its isolated code/diagram renderer
  islands load only APK-local renderer scripts and deny network, file, and
  content access. HTML previews have JavaScript disabled. DOCX conversion uses
  the same Node-side sanitizer as desktop previews, not a separate native
  trust boundary.

## UX contract

- The session sidebar is the durable navigation model: projects, sessions,
  branches, worktrees, and files must agree about the selected workspace.
- Native chat uses one compact message-action row: copy, plus user-message
  edit and new-session actions. Editing prefills the composer without sending;
  replacing a draft requires confirmation, and a fork retains its selected
  prompt and images in the new session's draft.
- Native task and subagent sheets keep headers outside their scrolling bodies.
  Subagents use compact selectable rows instead of separate result buttons;
  list and detail dialogs are mutually exclusive, and Back restores list position.
- Pre-dispatch prompts are owned by ompgui until they are forwarded. Web and
  current Android clients use the canonical server queue (stable ids, monotonic
  revision, compare-and-mutate). OMP receives a message at most once through
  `prompt` (active steering uses `streamingBehavior: "steer"`), only after the
  wrapper marks it sending. Legacy `prompt` / `steer` / `follow_up` entry points
  remain for deployed older clients.
- Android keeps primary Steer/Queue actions in the compact composer and opens
  queue management explicitly through **Session controls → Queue**, with a native
  queue count; typing does not insert an automatic Execution/Queue bar.
  Eligible queued items can be recalled with their images, deleted, or promoted
  from follow-up to steering. Sending entries cannot be edited; promotion still
  observes the scheduler's tool-execution safety boundary. Role-specific menus
  and the visible home Search entry remain separate from the session controls.
- Streaming state is explicit. The web UI reconciles Server-Sent Events with
  RPC state so a background tab cannot remain falsely “running”. The native
  client reconciles relay snapshots and live events for the selected session;
  retained UI state and downloaded preview caches are not authoritative live
  state. File previews are revision-bound and invalidated when the selected
  file or its server revision changes.
- Desktop and mobile share the same core workflow. Mobile controls keep usable
  touch targets and a visible loading state rather than a blank shell.
- Accessibility and motion preferences are first-class. Components use the
  shared design tokens and UI primitives rather than one-off colors or controls.
- Expensive rendering is deferred until needed; responsiveness and initial
  bundle size are part of the product contract.
- Web HTTP usage, Relay snapshots, and Relay usage requests share the same
  server-side usage service; transports do not maintain separate provider logic.
- Internally, `useAgentSession` composes `useSessionMessageQueue` and
  `useSessionSubagents` rather than owning both feature implementations inline.
  The feature hooks receive session context and mutation eligibility explicitly;
  this separation does not move authoritative queue ownership out of the server.

## Upstream and release strategy

`agegr/pi-web` is the historical source and a useful source of UI ideas,
bug fixes, and tests. Before adopting an upstream change, verify that it does
not depend on Pi runtime behavior or Bun-only APIs. Port the user-visible
behavior, not blindly the implementation.

Releases are independent:

1. Run typecheck, lint, relevant tests, and a production build.
2. Confirm `npm pack --dry-run` contains the built `.next` output and exposes
   the `ompgui` binary.
3. Publish `ompgui@<version>` only from an npm account authorized for that
   package.
4. Tag and release the repository that owns this downstream project.

Android release signing is local-only: hosted CI receives no private signing
keys. Publication requires uploading the locally signed, versioned APK and its
`.sha256` checksum first; CI verifies those supplied artifacts rather than signing
a replacement. Release verification uses `--release` to reject debuggable APKs
and Android debug certificates, and requires the APK versionCode to match the
source configuration exactly. See `docs/release.md` for the distribution procedure.

## Non-goals

- Reimplementing OMP, its provider registry, or its credential database.
- Embedding Bun-only OMP SDK packages in the Node server.
- Turning a local agent workspace into an internet-facing multi-user service.
- Unrestricted filesystem browsing or arbitrary browser-triggered host tools.
- Automatic bulk synchronization from `agegr/pi-web`.

When a proposed feature conflicts with one of these boundaries, preserve the
boundary unless the design is intentionally revised first.
