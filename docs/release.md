# Release Checklist

Each release publishes the `ompgui` npm package and a GitHub Release at
[dbc-hbin/ompgui](https://github.com/dbc-hbin/ompgui), including the locally signed
`ompgui-remote-v<version>.apk` and its `.apk.sha256` checksum sidecar.

## One-time trusted-publisher setup

1. In npm, open the `ompgui` package settings and add a **GitHub Actions**
   trusted publisher with:
   - Owner: `dbc-hbin`
   - Repository: `ompgui`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
2. In GitHub, create the `npm` environment for this repository. Add required
   reviewers if releases need approval.
3. Confirm Actions are enabled for the repository.

The workflow requests `contents: write` for draft creation/publication and
`id-token: write` for npm trusted publishing with provenance. It installs npm
11.5.1 or newer. No npm access token is stored in GitHub secrets.

## Android signing stays local

Do **not** upload the Android keystore, passwords or signing properties to GitHub
secrets. CI does not sign release APKs. Build them locally with the existing release
key so installed clients can upgrade. The Gradle build reads
`~/.omp/agent/android-signing/ompgui-remote.properties`, or the file selected by
`OMPGUI_ANDROID_SIGNING_PROPERTIES`. It contains Java properties named `storeFile`,
`storePassword`, `keyAlias` and `keyPassword`. Protect the directory with mode `0700`
and the properties/keystore with mode `0600`; do not commit or upload them.

Optionally configure the **public** GitHub environment/repository variable
`ANDROID_EXPECTED_CERT_SHA256` with the expected signing certificate's SHA-256
fingerprint (hex, optional colons). When configured, CI rejects another signing
key. This is not a secret and is not automatically configured. Without it CI still
requires a valid APK signature but cannot independently establish the intended
signer. The uploaded checksum checks artifact integrity, not signer identity.

## Release later versions

Use a clean `main` checkout after release changes are merged. Before creating the
tag, update `android/app/build.gradle`: `versionName` must equal the intended npm
version and `versionCode` must be a positive integer at most 2100000000, greater
than every previous Android release code.

```bash
npm ci
npm test
npm run build
npm version <major|minor|patch>
git push origin main --follow-tags
```

`npm version` updates package.json/package-lock.json, commits and creates the
`v<version>` tag. Review that tagged commit, including the Android version change,
before pushing. Do not build an APK from a different or dirty checkout.

The tag workflow checks the tag/package version, installs locked npm dependencies,
runs web checks and Android `assembleDebug testDebugUnitTest lintDebug` using JDK 21
and SDK 36, and verifies the debug APK. It creates a draft release if needed, then
requires the locally signed APK and checksum already uploaded there. If absent,
it fails with instructions to build/sign/upload locally and rerun: it does not
publish npm, make the release public or emit an unsigned fallback.

### Build, verify and upload locally

Prerequisites: the tagged clean checkout, Node matching package.json, JDK 21,
Android SDK/build-tools 36.0.0, Python 3.11 or newer, the local signing files above,
and an authenticated `gh` CLI. Set `ANDROID_HOME` to the SDK path. No signing
credentials are passed to GitHub.

```bash
npm ci
(cd android && ./gradlew --no-daemon assembleRelease)
python3 android/scripts/verify-apk.py \
  android/app/build/outputs/apk/release/output-metadata.json \
  --aapt "$ANDROID_HOME/build-tools/36.0.0/aapt" \
  --apksigner "$ANDROID_HOME/build-tools/36.0.0/apksigner" \
  --release --check-history
VERSION="$(node -p 'require("./package.json").version')"
APK="ompgui-remote-v$VERSION.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$APK"
shasum -a 256 "$APK" > "$APK.sha256"
python3 android/scripts/verify-apk.py "$APK" \
  --sha256-file "$APK.sha256" \
  --aapt "$ANDROID_HOME/build-tools/36.0.0/aapt" \
  --apksigner "$ANDROID_HOME/build-tools/36.0.0/apksigner" \
  --release --check-history
```

Pass `--expected-cert-sha256 <public-fingerprint>` or set
`ANDROID_EXPECTED_CERT_SHA256` locally to pin the signer too. The verifier accepts
either an APK directly or AGP output metadata. It reads actual package/version
with `aapt`, validates Android's versionCode range and exact source-configured
versionCode as well as the package.json version, requires `apksigner verify`, and
requires generated Mermaid/Prism preview assets. Publication uses `--release`,
which also rejects debuggable APKs and Android debug signing certificates; the
separate debug CI verification does not use this flag.
Only the known AGP baseline profiles and three ML Kit barcode model assets are
additionally allowed; stale Capacitor/public assets and all other extras fail. Metadata, when supplied, must
also agree with the APK. `--check-history` requires full git history and release
tags, checking the code against prior ancestor `v*` tags with Android builds.

After the workflow has created the draft, upload only the APK and checksum:

```bash
test "$(gh release view "v$VERSION" --repo dbc-hbin/ompgui --json isDraft --jq .isDraft)" = true &&
  gh release upload "v$VERSION" "$APK" "$APK.sha256" --repo dbc-hbin/ompgui --clobber
```

Then rerun the failed tag workflow in GitHub Actions, or dispatch it explicitly
against that same tag (not a branch):

```bash
gh workflow run publish.yml --repo dbc-hbin/ompgui --ref "v$VERSION"
```

CI downloads both assets,
checks their SHA-256, actual package/version/code, signature, optional certificate
pin and preview assets before npm publication. It uses npm OIDC provenance (the
npm prepack hook builds the web package), then makes the draft public only after
npm accepts the package. No AGP metadata asset needs uploading: CI derives it
from the actual APK.

Reruns also verify existing public APK/checksum assets without replacing them and
skip npm publication when that version already exists. A missing, invalid or
mismatched asset fails closed; CI never modifies public APK assets. It does not
require reproducing identical APK bytes on a different runner.

Pull requests and pushes to `main` independently run `.github/workflows/android.yml`
with locked npm preview inputs, JDK 21/SDK 36, Android debug assembly/unit tests/lint,
and debug APK version/signature/content verification. No release keys are required.

## Verify

Verifier regression cases:

```bash
python3 -m unittest discover -s android/scripts -p 'test_*.py'
```

After publication:

```bash
gh run list --repo dbc-hbin/ompgui --workflow publish.yml --limit 1
npm view ompgui@<version> version --registry https://registry.npmjs.org/
npm view ompgui@<version> --json --registry https://registry.npmjs.org/
```

Confirm the workflow succeeded, the exact npm package version resolves with its
provenance link, and the release includes the versioned signed APK and checksum.
