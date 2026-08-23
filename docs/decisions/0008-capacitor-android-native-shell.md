# Architecture Decision Record: bounded Capacitor Android shell

- **Status:** Accepted proof boundary
- **Date:** 2026-08-23
- **Related issue:** #86
- **Extends:** [ADR-0002](0002-bun-hermes-acp-workspace.md), [ADR-0007](0007-portable-pwa-cache-and-share-boundary.md)

## Context

HUE needs Android launcher, widget, shortcut, deep-link, and notification evidence without creating another Project, Session, transcript, or delivery authority. Current SvelteKit adapter-node application is server-rendered. Hermes ACP remains execution and transcript authority; HUE server remains control-plane and delivery authority.

## Decision

Use Capacitor 8 as thin Android transport/UI shell. Shell always loads configured HUE server origin. It contains no workspace database, transcript cache, message sender, approval action, or alternative native UI.

Application id is `studio.ctw.hue`; display name is `HUE`. Web/PWA remains canonical interface. Native additions are limited to safe launch routing, one generic Quick Idea widget, one generic dynamic or explicitly user-pinned Project shortcut, one generic dynamic or explicitly user-pinned Session shortcut, and three generic notification channels. Pinning only follows a bridge call from an explicit user action; shell never pins automatically.

Build config supplies server origin through `HUE_SERVER_URL` environment variable or Gradle property. Build wrappers inject the same validated, normalized origin into Capacitor `server.url` before `BridgeActivity` initializes and Gradle `BuildConfig`/App Link host. Release validation task `:app:validateHueReleaseConfig` requires real HTTPS and rejects a missing or mismatched generated Capacitor `server.url`. Debug permits cleartext only for `10.0.2.2`, `127.0.0.1`, or `localhost`; debug manifest and network-security resource carry that exception. Release resources deny cleartext. Host validation lowercases and removes all terminal dots before rejecting reserved `.invalid`. No private origin, credential, token, or auth state is committed. Future credentials belong in Android Keystore and must never enter URLs, resources, or logs.

Incoming HTTPS links must match configured origin and root HUE contracts exactly: Project, Session, or Quick Idea query. `hue://project/<id>`, `hue://session/<id>?project=<id>`, and `hue://quick-capture` normalize to those same-origin URLs. Unknown query keys, authority actions, external origins, malformed ids, userinfo, fragments, non-root paths, `javascript:`, `file:`, and `content:` are rejected.

Widget and shortcuts expose generic labels only. Widget opens Quick Idea draft and never submits. Shortcut ids are SHA-256-derived and bounded; raw ids never become shortcut ids or labels. Dynamic removal or authority loss also disables matching pinned ids, preventing stale intents from launching. Notifications use HUE-owned `NativeNotifications` only: fixed generic title/body, private or secret lock-screen visibility, immutable/update-current deep-link pending intents, and no approve/clarify action. Capacitor Local Notifications is intentionally absent. Debug notification creation requires explicit instrumentation or bridge call and cannot run in release.

## Options

### Capacitor — selected

Small Java host around existing web UI, direct Android APIs, familiar Gradle project, and no Rust/native data model. Maintenance surface stays one web product plus narrow native policies.

### Trusted Web Activity — rejected

Smaller shell, but dynamic shortcuts, widget, notification-channel policy, custom intent validation, and debug local-origin proof still require companion Android code. TWA also relies on verified HTTPS/Digital Asset Links and provides less control over launch routing.

### Tauri — rejected

Capable native shell, but adds Rust toolchain, IPC surface, native runtime maintenance, and temptation to package a second application authority. HUE already depends on server-rendered adapter-node and Hermes ACP; Tauri provides no proof benefit here.

## Privacy, distribution, and release boundary

- Debug APK is direct-install proof only, signed with local Android debug key.
- No production signing key, Play Console enrollment, store listing, publishing, or release artifact is part of issue #86.
- Play distribution later requires explicit signing-key custody, target-policy review, privacy/data-safety declarations, app-link association, notification-permission UX, device testing, and separate release decision.
- Direct distribution later requires trusted HTTPS origin, update provenance, signing-key continuity, and user-facing install/update guidance.
- Keystore-backed credential storage is required before any native credential exists; this proof stores none.
- App-link authentication still happens at HUE server. Deep links carry identifiers, never bearer credentials or authority grants.

## 16 KB page-size compatibility

Shell adds no HUE-owned native library. Debug APK must be inspected for packaged `.so` files; current Capacitor/App path is Java and system WebView based. API 36 arm64 emulator with 16 KB pages is release gate for this proof. Any future native dependency reopens compatibility testing and must ship 16 KB-aligned arm64 libraries.

## Evidence matrix

| Boundary              | Automated evidence                                     | API 36 emulator evidence                                                                      |
| --------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Origin and deep links | JVM validator tests; release HTTPS validation task     | MainActivity safe/unsafe intent instrumentation; `dumpsys package`                            |
| Quick Idea widget     | AppWidgetHost surface/click instrumentation            | bound widget id, rendered surface click, WebView shows “Nothing sends automatically”          |
| Shortcuts             | stable hash/label JVM tests                            | dynamic Project + Session lifecycle; explicit pin request and stale pinned disablement        |
| Notifications         | channel/payload policy JVM tests                       | channels, redaction, exact Session PendingIntent instrumentation and `dumpsys notification`   |
| Packaging             | lint, assemble, tracked-output audit                   | debug APK install/launch on API 36 arm64 16 KB emulator                                       |
| Production boundary   | actual `validateHueReleaseConfig` HTTP fail/HTTPS pass | exact configured HTTPS Project + Session App Links load remote HUE with `HueNative` available |

Generated proof output lives under ignored `artifacts/android-proof/`. APK remains under ignored Gradle build output; evidence records absolute path and SHA-256.

HTTPS emulator proof records exact host dispatch through Android App Links. Because issue #86 does not publish a Digital Asset Links file or production signing certificate, instrumentation temporarily marks the declared host `approved`, proves generic `ACTION_VIEW` dispatch to `MainActivity`, then resets that emulator state. This is dispatch evidence, not production domain verification.

## Consequences

HUE gains Android-native launch and attention primitives without changing authority model. Useful shell behavior still requires reachable HUE server. Offline workspace or message execution remains intentionally unavailable. Secure tailnet DNS and app-link verification are deployment evidence, not implied by debug adb-reverse success.

## Revisit triggers

- Native feature needs durable private state or background authority.
- Production remote access, authentication, or push delivery is selected.
- Any native library enters APK.
- Play or direct production distribution begins.
