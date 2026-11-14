# macOS Lab verification record

Evidence for the app-mirror roadmap PR (MIR-01…06). Commands were run on the
development Mac (macOS on arm64, one 1920×1080 display) inside the
`feat/macos-app-mirror-roadmap` worktree. Checks that are still due are listed
at the end, per docs/UX_READINESS.md.

## Static checks

```console
$ bash -n ios-lab/mac/macos-app.sh            # clean
$ python3 -m compileall -q console/oslab.py android-lab/lab/web_ui.py   # clean
$ cd dashboard && npm run check               # tsc --noEmit, clean
$ npm run test:i18n
2525 keys match across 7 locales; no new untranslated TSX strings.
$ npm run build
[build] 513 page(s) built in 4.26s
$ npx playwright test                         # exit 0 (all specs pass)
```

## MIR-03 — displays and scale

```console
$ python3 -c "import sys; sys.path.insert(0,'console'); import oslab; print(oslab._macos_cg().screens())"
[{'x': 0, 'y': 0, 'width': 1920, 'height': 1080, 'scale': 1.0}]
$ bash ios-lab/mac/macos-app.sh doctor | sed -n '/displays/,/appium/p'
==> displays
  display 1: origin (0, 0) size 1920x1080 scale 1.0x
```

Every window record carries `scale` (1.0 on this single non-Retina display);
`CGWindowCopyScreenInfo` is not exported on current macOS, so the scale comes
from the CGDisplayMode pixel-to-point ratio. The two-display hotspot check
remains due — this Mac has one display.

## MIR-01 — input family (plan, armed action, refusal paths)

```console
$ python3 - <<'PY'
import sys; sys.path.insert(0, 'console'); import oslab
root = '<worktree>'
host = oslab.host_info(root)
p = oslab.plan(root, {'lab': 'macos', 'action': 'macos-input', 'clickPid': 100,
    'clickX': 1, 'clickY': 2, 'inputKind': 'type', 'inputText': 'hello world'}, host)
print(p['args'][1:]); print([e for e in p['effects'] if 'Return' in e][0])
PY
['input', '100', '1', '2', 'type', 'hello world']
Brings the app (pid 100) to the front and types 11 characters (hello world) — no Return is sent.

# refusals (PlanError): newline in text, unknown key, unknown request fields,
# element fields on other actions — all exercised in the session log.
```

Armed live run through the console HTTP API (port 5097, worktree checkout):

```console
$ curl -s -X POST -H 'X-OSLab: 1' -d '{"armed": true}' …/api/labs/macos/control
{"armed": true, "expiresInSec": 599}
$ curl -s -X POST -H 'X-OSLab: 1' -d '{"pid": 179, "x": 10, "y": 10, "kind": "type", "text": "hi\nthere"}' …/api/labs/macos/input
{"error": "The text must be 1-200 printable characters; Return is never sent by a type action"}
$ curl -s -X POST -H 'X-OSLab: 1' -d '{"pid": 179, "x": 10, "y": 10, "kind": "key", "key": "F5"}' …/api/labs/macos/input
{"error": "key must be one of: tab, escape, delete, forward-delete, up, down, left, right, space, enter"}
$ curl -s -X POST -H 'X-OSLab: 1' -d '{"pid": 179, "x": 10, "y": 10, "kind": "type", "text": "ok"}' …/api/labs/macos/input
{"ok": true, "pid": 179, "x": 10, "y": 10, "kind": "type", "text": "ok"}
```

The double/right kinds run the same `macos-app.sh input` path (CGEvent posting
with click state 2 / right button); the smoke run landed in a live window.

## Shipped bug fixed en route

The pre-existing `click` action read `"$1"` after `ACTION="${1:-status}"` had
already consumed the action word, so every armed or previewed click died on the
usage check. Verified before the fix:

```console
$ bash ios-lab/mac/macos-app.sh click 1108 0 30
error: usage: mac/macos-app.sh click <pid> <x> <y> (integers)
```

`shift` after capturing `ACTION` fixes click, input and element alike; the live
armed click then returned `{'ok': True, ...}` through `macos_control_click`.

## MIR-02 — diff overlay

Two successive element reads of the same window through the console: the first
returns the snapshot with `revision`, the second (same revision) returns
`diff` with bounded `added/changed/removed` (empty when the tree is stable —
`{'added': 0, 'changed': 0, 'removed': 0}` live). Unit-level diff behaviour
(added/moved/unchanged matching, stable revision digest) is exercised in the
session log with synthetic trees.

## MIR-04 — streaming mirror

```console
$ curl -s --max-time 2 -D - -o /tmp/stream.bin '…/api/labs/macos/apps/179/stream?fps=2'
HTTP/1.0 200 OK
Content-Type: multipart/x-mixed-replace; boundary=frame
--frame
Content-Type: image/png
```

Frames flow at the requested pace; the client abort (hidden tab, fps switch)
ends the fetch cleanly and the panel falls back to the 1.5 s poll on stream
errors. The e2e suite passes against the stubbed pages.

## MIR-05 — deep inspect

Without armed control the session open is refused honestly:

```console
$ curl -s -X POST -H 'X-OSLab: 1' -d '{"app": "Finder"}' …/api/labs/macos/session
{"error": "Control mode is not armed; arm the app mirror to open a deep-inspect session"}
```

App-name → bundle-id resolution works without Appium:

```console
$ python3 -c "import sys; sys.path.insert(0,'console'); import oslab; print(oslab._macos_bundle_id_for_app('Finder'))"
com.apple.finder
```

A full mac2 session round-trip (open → elements with stable ids → element
click → close) is still due: Appium was not running on this Mac during the
session. The previewed element plan builds the exact `element` argv
(`['element', '<session>', '<element>', 'click']`).

## MIR-06 — audit log

```console
$ curl -s -D - -o /tmp/audit.json …/api/labs/macos/audit.json | grep -i 'content-'
Content-Type: application/json
Content-Disposition: attachment; filename="macos-audit.json"
$ python3 -c "import json; d=json.load(open('/tmp/audit.json')); print(len(d['rows']), d['rows'][-1]['kind'])"
2 input-type
```

Rows carry time, kind, app/window, coordinates or key/text length, `ok`, and a
base64 JPEG thumbnail (≈31 KB at action time); preview tokens appear only as
16-hex digests. The JSONL file lands in `ios-lab/artifacts/macos-audit-<date>.jsonl`.

## Still due

- The panel's visual pass (narrow widths, 200% zoom, both themes, RTL) on the
  running dashboard — the functional flows are wired but this PR has no
  screenshots yet; per docs/UX_READINESS.md they belong in this PR before it
  leaves draft.
- A two-display Retina hotspot check (single display on this Mac).
- The mac2 deep-inspect live round-trip with Appium running.
