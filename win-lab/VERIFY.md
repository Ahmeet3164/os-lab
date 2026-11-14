# Native Windows application monitor — verification (PR-W1)

Date: 2026-11-15
Host: Microsoft Windows 11 Pro, 10.0.26300, x64
Shell: Windows PowerShell 5.1.26100.9818
Node.js: v24.20.0
Privilege used: standard user (`admin=False`)
WSL used by this feature: no

This feature is read-only. It lists visible desktop applications in the current
Windows user session; it does not start or stop processes and does not read
process command lines.

## 1. Native PowerShell/Python collector

Command:

```powershell
python console/windows_apps.py
```

Observed result (field summary; the full JSON contains the local window titles
and is not committed):

```text
available=True
provider=native-windows
sessionId=1
partial=False
skipped=0
apps=11
```

The same collector was checked through the loopback API:

```powershell
python android-lab/lab/web_ui.py 5077
Invoke-RestMethod http://127.0.0.1:5077/api/labs/windows/apps
```

Observed result:

```text
available=True
provider=native-windows
sessionId=1
apps=10
partial=False
```

The app count changed between runs because a previously visible local
application was closed; no retry or mock was used.

## 2. Backend unit/API tests

Command:

```powershell
python -m pytest android-lab/lab/tests/test_windows_apps.py android-lab/lab/tests/test_web_ui.py -q
```

Observed result:

```text
30 passed
```

The covered failures include non-Windows hosts, malformed native JSON,
duplicated PID/start identities, PowerShell non-zero/timeout paths, non-interactive
bounded invocation, and the 501 response when the console module is missing.

## 3. Dashboard checks

From `dashboard/`:

```powershell
npm ci
npx astro sync
npm run check
npm run test:i18n
npm run build
npm run test:e2e -- windows-apps.spec.ts
```

Observed results:

```text
tsc --noEmit: passed
2383 keys match across 7 locales; no new untranslated TSX strings.
astro build: completed
windows-apps.spec.ts: 3 passed
```

The E2E suite checks:

- the panel on a Windows host while the Windows VM is in `needs-setup`;
- process name, PID, window title, status, memory and CPU time;
- empty and failed API states;
- no inventory request on a Linux/macOS host;
- local-only mounting (public Pages does not call the endpoint).

An automated browser-state screenshot was generated at
`dashboard/test-results/windows-apps-monitor.png`. Do not commit it; attach it
to the PR if requested and check it contains no private application/window
data first.

## 4. Desktop runtime integrity

From `app/`:

```powershell
npm run test:stage
```

Observed result:

```text
8 tests, 0 failed
```

From `app/src-tauri/`:

```powershell
cargo test
```

Observed result:

```text
12 passed; 0 failed
```

`console/windows_apps.py` was added to the staging and bundle integrity lists.
The locally staged resources are untracked and were used only to run the Tauri
tests.

## 5. Scope and limits

- This proves native Windows process/window inventory, not window screenshots
  or UI Automation controls (planned as follow-up PRs).
- It does not prove a macOS/iOS/Android feature.
- No process was started or terminated by this feature or its tests.
- No host data from this verification was sent off-machine.
