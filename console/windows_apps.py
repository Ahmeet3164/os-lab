"""Read-only inventory of visible desktop applications in the current Windows session.

The installed console polls this module through the loopback API. PowerShell is used only
as the native Windows process-query interface: no scripts are downloaded, processes are
started only to collect JSON, and no process control or command-line inspection is exposed.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import time
from typing import Any

POWERSHELL_TIMEOUT_SEC = 15
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
MAX_TITLE_CHARS = 512

# This is a fixed command, not a script assembled from request data. -Command also means
# collection does not depend on the user's PowerShell script execution policy.
INVENTORY_COMMAND = r"""
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
$sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
$apps = @()
$skipped = 0
Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
    $process = $_
    try {
        if ($process.SessionId -eq $sessionId -and $process.MainWindowHandle -ne 0) {
            $apps += [ordered]@{
                pid = [int]$process.Id
                name = [string]$process.ProcessName
                title = [string]$process.MainWindowTitle
                startedAt = ([DateTimeOffset]$process.StartTime).ToUnixTimeMilliseconds()
                memoryBytes = [Int64]$process.WorkingSet64
                cpuSeconds = [Math]::Round([double]$process.TotalProcessorTime.TotalSeconds, 3)
                responding = [bool]$process.Responding
            }
        }
    } catch {
        # A process can exit between Get-Process and property access. Protected processes
        # and disappearing apps must not make the rest of the current session disappear.
        $skipped += 1
    }
}
$payload = [ordered]@{ sessionId = [int]$sessionId; skipped = [int]$skipped; apps = @($apps) }
ConvertTo-Json -InputObject $payload -Depth 4 -Compress
"""


class WindowsAppsError(Exception):
    """A safe, user-presentable native collection failure."""


def unavailable(reason: str) -> dict[str, Any]:
    return {
        "available": False,
        "reason": reason,
        "provider": "native-windows",
        "sessionId": None,
        "checkedAt": int(time.time()),
        "partial": False,
        "skipped": 0,
        "apps": [],
    }


def _powershell() -> str | None:
    return shutil.which("powershell.exe") or shutil.which("powershell") or shutil.which("pwsh")


def _run_inventory(executable: str) -> str:
    """Run the bounded native query and return its UTF-8 JSON payload."""
    try:
        result = subprocess.run(
            [executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", INVENTORY_COMMAND],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=POWERSHELL_TIMEOUT_SEC,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise WindowsAppsError(f"Windows application collection timed out after {POWERSHELL_TIMEOUT_SEC} seconds") from exc
    except OSError as exc:
        raise WindowsAppsError("Windows PowerShell could not be started") from exc
    if len(result.stdout) > MAX_OUTPUT_BYTES:
        raise WindowsAppsError("Windows application inventory exceeded the response size limit")
    errors = result.stderr.decode("utf-8-sig", errors="replace").strip()
    if result.returncode != 0:
        detail = " ".join(errors.split())[:300]
        raise WindowsAppsError("Windows application collection failed" + (f": {detail}" if detail else ""))
    return result.stdout.decode("utf-8-sig", errors="replace")


def _positive_int(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise WindowsAppsError(f"Invalid Windows application field: {field}")
    return value


def _nonnegative_number(value: Any, field: str) -> int | float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise WindowsAppsError(f"Invalid Windows application field: {field}")
    return value


def parse_inventory(text: str) -> tuple[int, int, list[dict[str, Any]]]:
    """Validate native JSON and build stable PID + start-time application identities."""
    try:
        payload = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise WindowsAppsError("Windows application collection returned invalid JSON") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("apps"), list):
        raise WindowsAppsError("Windows application collection returned an invalid inventory")
    session_id = _positive_int(payload.get("sessionId"), "sessionId")
    skipped_raw = payload.get("skipped", 0)
    if isinstance(skipped_raw, bool) or not isinstance(skipped_raw, int) or not 0 <= skipped_raw <= 100_000:
        raise WindowsAppsError("Invalid Windows application field: skipped")

    apps: list[dict[str, Any]] = []
    identities: set[str] = set()
    for raw in payload["apps"]:
        if not isinstance(raw, dict):
            raise WindowsAppsError("Windows application collection returned an invalid application")
        pid = _positive_int(raw.get("pid"), "pid")
        started_at = _positive_int(raw.get("startedAt"), "startedAt")
        name = raw.get("name")
        title = raw.get("title")
        responding = raw.get("responding")
        if not isinstance(name, str) or not name.strip() or len(name) > 260 or "\0" in name:
            raise WindowsAppsError("Invalid Windows application field: name")
        if not isinstance(title, str) or "\0" in title:
            raise WindowsAppsError("Invalid Windows application field: title")
        if not isinstance(responding, bool):
            raise WindowsAppsError("Invalid Windows application field: responding")
        identity = f"{pid}:{started_at}"
        if identity in identities:
            raise WindowsAppsError("Windows application collection returned a duplicate application identity")
        identities.add(identity)
        apps.append({
            "id": identity,
            "pid": pid,
            "name": name.strip(),
            "title": title[:MAX_TITLE_CHARS],
            "startedAt": started_at,
            "memoryBytes": _nonnegative_number(raw.get("memoryBytes"), "memoryBytes"),
            "cpuSeconds": _nonnegative_number(raw.get("cpuSeconds"), "cpuSeconds"),
            "responding": responding,
        })
    apps.sort(key=lambda app: (app["name"].casefold(), app["title"].casefold(), app["pid"]))
    return session_id, skipped_raw, apps


def inventory(*, platform: str | None = None) -> dict[str, Any]:
    """Collect the current user's visible Windows apps, without reading inside a VM."""
    if (platform or sys.platform) != "win32":
        return unavailable("Native Windows application monitoring is available only on a Windows host")
    executable = _powershell()
    if not executable:
        return unavailable("Windows PowerShell is required to read the running application inventory")
    try:
        session_id, skipped, apps = parse_inventory(_run_inventory(executable))
    except WindowsAppsError as exc:
        return unavailable(str(exc))
    return {
        "available": True,
        "reason": None,
        "provider": "native-windows",
        "sessionId": session_id,
        "checkedAt": int(time.time()),
        "partial": skipped > 0,
        "skipped": skipped,
        "apps": apps,
    }


def main() -> int:
    result = inventory()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["available"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
