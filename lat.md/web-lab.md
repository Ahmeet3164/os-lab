# Web Lab

Web Lab is the embedded-browser lab: a Rust engine (`weblab`) hosts real webview
windows whose pages can be instrumented with JavaScript and observed through a
captured event log. It studies the in-app browser component that apps embed.

## Architecture

[[web-lab/browser]] is a standalone crate: `wry` + `tao` (the webview stack
under the Tauri app) with no async runtime. The tao event loop owns every
webview on the main thread; a `tiny_http` thread serves 127.0.0.1 commands.

[[web-lab/browser/src/bootstrap.rs#BOOTSTRAP_JS]] is the injected telemetry
bootstrap plus the self-contained eval wrapper; results travel back over the
wry IPC bridge and become events.
[[web-lab/knowledge/injection-model.md]] records the three injection layers
and their deliberate limits (no HttpOnly cookies, no body capture).

## Engine-style lab

Like [[source-lab]], Web Lab boots no VM: `./labctl web <command>` execs
`make -C web-lab` ([[web-lab/Makefile]]), and
[[web-lab/scripts/setup-ubuntu.sh]] installs the Rust toolchain via rustup if
cargo is missing, then builds the engine with `cargo build --release`.

Profiles are webview data directories (or incognito for `ephemeral`);
[[web-lab/knowledge/sessions.md]] documents the per-platform isolation limits
and that nothing is persisted outside `web-lab/storage/`.

## Console integration

[[console/web_api.py]] reports readiness, starts/stops the engine process and
proxies the engine's JSON API; [[android-lab/lab/web_ui.py#LabHttpHandler]]
mounts `/api/web/*` beside the Cleanup Lab routes. `console/oslab.py`
registers the lab (`native-rust` provider and action plans).

The dashboard's generic lab page covers readiness and actions; the workbench
at `/web-lab/` ([[dashboard/src/views/web-lab/pages.tsx]]) opens windows,
manages injections, runs eval and tails the event log. It is a console-only
route: it appears in neither the Pages deploy keep-list nor the public
navigation.

## Safety stance

The engine binds to loopback only, starts no privilege, and keeps captures in
memory (capped ring buffer, 8 KiB per string). Targets must be owned or
explicitly authorized — the same ground rules as every lab.
