# Windows Apps Lab native app mirror — verification

Date: 2026-11-15
Host: Microsoft Windows 11 Pro, 10.0.26300, x64
Shell: Windows PowerShell 5.1.26100.9818
Node.js: v24.20.0
Privilege used: standard user (`admin=False`)
WSL used by this feature: no

This feature is read-only. It mirrors one visible desktop window; it does not
start or stop processes, does not read process command lines and does not send
input.

## 1. Native ctypes collector

Command:

```powershell
python console/winapps.py
```

Observed result (field summary; the full JSON contains the local window titles
and is not committed):

```text
available=True
windows=6
```

The same collector was checked through the loopback API:

```powershell
python android-lab/lab/web_ui.py 5077
Invoke-RestMethod http://127.0.0.1:5077/api/labs/winapps/apps
```

Observed result:

```text
available=True
windows=6
```

The window count changed between runs because previously visible local
applications were closed; no retry or mock was used.

A real window capture was also checked:

```powershell
python -c "import sys; sys.path.insert(0, 'console'); import winapps
png = winapps.winapps_window_screenshot(131874)
open(r'%TEMP%\\winapps-test.png', 'wb').write(png)"
```

Observed result:

```text
len(png)=86670
png[:8]=b'\\x89PNG\\r\\n\\x1a\\n'
```

The capture is a real PNG of the selected window; no retries or mocks were
used.

## 2. Backend unit/API tests

Command:

```powershell
python -m pytest android-lab/lab/tests/test_winapps.py android-lab/lab/tests/test_web_ui.py -q
```

Observed result:

```text
22 passed
```

The covered failures include non-Windows hosts, stale/invalid window ids, a
window without a caption, and the 501 response when the console module is
missing.

## 3. Dashboard checks

From `dashboard/`:

```powershell
npm ci
npx astro sync
npm run check
npm run test:i18n
npm run build
npm run test:e2e -- winapps.spec.ts
```

Observed results:

```text
tsc --noEmit: passed
2516 keys match across 7 locales; no new untranslated TSX strings.
astro build: completed
winapps.spec.ts: 3 passed
```

The E2E suite checks:

- the panel and its live mirror on a Windows host;
- the selected window's app and title in the picker;
- explicit unavailable state;
- no inventory request on a Linux/macOS host;
- local-only mounting (public Pages does not call the endpoint);
- no input-control button in the read-only phase.

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

`console/winapps.py` was added to the staging and bundle integrity lists.
The locally staged resources are untracked and were used only to run the Tauri
tests.

## 5. Scope and limits

- This proves the read-only phase of the Windows app mirror: window inventory
  and a live window capture. UIA hotspots, previewed clicks, typing and armed
  control are planned as follow-up PRs (matching `WINMIR-02…06` from the app
  mirror plan).
- It does not prove a macOS/iOS/Android feature.
- No process was started or terminated by this feature or its tests.
- No host data from this verification was sent off-machine.
