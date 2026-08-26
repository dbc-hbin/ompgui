# Outcome

Build an installable Android debug APK named ompgui Remote that acts as a thin remote client for an existing ompgui server while showing a bounded display-only replica immediately on mobile startup.

# In scope

- Package id `com.dbchbin.ompgui.remote`.
- Android 8.0+ (`minSdk 26`) debug APK.
- First-run setup for a user-configurable HTTPS ompgui origin.
- Existing ompgui React UI and server APIs remain the only product/runtime implementation.
- Persist the last viewed session's latest 50 display messages as a bounded replica.
- Restore the replica for immediate display while authoritative history/runtime reconnect in the background.
- Offline or runtime-unready state is strictly read-only.
- Existing history/runtime generation fences remain authoritative.
- Build and verify a local debug APK artifact.

# Non-goals

- Google Play publication.
- Release keystore or production signing.
- Kotlin/Compose reimplementation of chat, session parsing, RPC, SSE, branching, or model state.
- Offline message queue or automatic deferred sending.
- Full transcript, base64 media, credentials, API keys, attachments, or runtime authority in the replica.
- Native notification and file-picker bridges in the first APK.

# Key decisions

- Thin Capacitor/WebView shell rather than a second native client.
- Remote origin is configurable in the app, not compiled in.
- Replica scope is one session and at most 50 messages.
- APK loads the shared ompgui web UI; normal feature updates require only the ompgui server to update.
- Package name is `com.dbchbin.ompgui.remote`.

# Constraints

- Only `https://` remote origins are accepted outside local development.
- Authentication stays with ompgui; credentials are not copied into replica records.
- Replica is keyed by origin and session identity and is replaced by server-authoritative data.
- Runtime mutation controls must remain disabled until current runtime state succeeds.
- Cache storage is bounded and excludes media/blob payloads.

# Acceptance criteria

- A debug APK installs on Android 8.0+.
- First launch accepts and persists a valid HTTPS ompgui origin and rejects unsafe schemes.
- The configured remote ompgui login/app loads in the WebView.
- After viewing a session online, relaunch can immediately show up to the latest 50 safe display messages from that session.
- Replica mode visibly indicates cached/offline state and cannot send, fork, navigate branches, change models/thinking, compact, reload plugins, answer extension UI, or mutate attachments.
- A successful authoritative history/runtime reconnect replaces the replica and restores normal controls.
- Web typecheck, lint, focused replica tests, and Android debug build pass.
- Final APK path and package/version metadata are reported.

# Assumptions

- The remote ompgui server is reachable over a stable HTTPS URL, commonly through Tailscale Funnel or another trusted reverse proxy.
- A debug-signed APK is sufficient for current dogfooding.
