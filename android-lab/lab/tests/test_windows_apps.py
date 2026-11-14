"""Offline contracts for the read-only native Windows application inventory."""

import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "console")))

import windows_apps


SAMPLE = {
    "sessionId": 2,
    "skipped": 1,
    "apps": [
        {
            "pid": 2,
            "name": "explorer",
            "title": "Taskbar",
            "startedAt": 1700000000000,
            "memoryBytes": 2048,
            "cpuSeconds": 1.5,
            "responding": True,
        },
        {
            "pid": 1,
            "name": "notepad",
            "title": "Untitled - Notepad",
            "startedAt": 1699999999999,
            "memoryBytes": None,
            "cpuSeconds": 0,
            "responding": False,
        },
    ],
}


@pytest.fixture
def sample_text():
    import json

    return json.dumps(SAMPLE)


def test_non_windows_hosts_report_native_availability_without_running_powershell(monkeypatch):
    started = []
    monkeypatch.setattr(windows_apps, "_powershell", lambda: started.append(True) or "powershell")

    result = windows_apps.inventory(platform="linux")

    assert result["available"] is False
    assert result["provider"] == "native-windows"
    assert result["apps"] == [] and result["sessionId"] is None
    assert "Windows host" in result["reason"]
    assert started == []


def test_inventory_validates_native_fields_and_uses_stable_identities(sample_text, monkeypatch):
    monkeypatch.setattr(windows_apps, "_powershell", lambda: "powershell")
    monkeypatch.setattr(windows_apps, "_run_inventory", lambda executable: sample_text)

    result = windows_apps.inventory(platform="win32")

    assert result["available"] is True and result["partial"] is True and result["skipped"] == 1
    assert result["provider"] == "native-windows" and result["sessionId"] == 2
    assert [app["id"] for app in result["apps"]] == ["2:1700000000000", "1:1699999999999"]
    notepad = result["apps"][1]
    assert notepad["pid"] == 1 and notepad["name"] == "notepad"
    assert notepad["memoryBytes"] is None and notepad["cpuSeconds"] == 0 and notepad["responding"] is False


def test_collection_failure_becomes_an_unavailable_reason(monkeypatch):
    def fail(executable):
        raise windows_apps.WindowsAppsError("Windows PowerShell did not return a readable inventory")

    monkeypatch.setattr(windows_apps, "_powershell", lambda: "powershell")
    monkeypatch.setattr(windows_apps, "_run_inventory", fail)

    result = windows_apps.inventory(platform="win32")

    assert result["available"] is False
    assert result["reason"] == "Windows PowerShell did not return a readable inventory"


@pytest.mark.parametrize("text", [
    "{}",
    '{"sessionId": 1, "skipped": 0, "apps": {}}',
    '{"sessionId": true, "skipped": 0, "apps": []}',
    '{"sessionId": 1, "skipped": -1, "apps": []}',
    '{"sessionId": 1, "skipped": 0, "apps": [{"pid": 1, "name": "app", "title": "", "startedAt": 1, "memoryBytes": 1, "cpuSeconds": 1, "responding": "yes"}]}',
    '{"sessionId": 1, "skipped": 0, "apps": [{"pid": 1, "name": "a\\0", "title": "w", "startedAt": 1, "memoryBytes": 1, "cpuSeconds": 1, "responding": true}]}',
    '{"sessionId": 1, "skipped": 0, "apps": [{"pid": 1, "name": "a", "title": "w", "startedAt": 1, "memoryBytes": 1, "cpuSeconds": 1, "responding": true}, {"pid": 1, "name": "b", "title": "w", "startedAt": 1, "memoryBytes": 1, "cpuSeconds": 1, "responding": true}]}',
])
def test_malformed_native_payloads_are_refused(text):
    with pytest.raises(windows_apps.WindowsAppsError):
        windows_apps.parse_inventory(text)


def test_native_powershell_query_is_bounded_and_non_interactive(monkeypatch):
    calls = []

    def fake_run(args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, 0, stdout=b'{"sessionId": 1, "skipped": 0, "apps": []}', stderr=b"")

    monkeypatch.setattr(windows_apps.subprocess, "run", fake_run)

    text = windows_apps._run_inventory("powershell.exe")

    assert text.startswith('{"sessionId": 1')
    args, kwargs = calls[0]
    assert args[:3] == ["powershell.exe", "-NoLogo", "-NoProfile"]
    assert "-NonInteractive" in args and "-Command" in args
    assert kwargs.get("timeout") == windows_apps.POWERSHELL_TIMEOUT_SEC
    assert kwargs.get("creationflags", 0) == getattr(subprocess, "CREATE_NO_WINDOW", 0)


def test_failed_and_slow_powershell_runs_have_safe_reasons(monkeypatch):
    calls = {"count": 0}

    def fake_run(args, **kwargs):
        calls["count"] += 1
        if calls["count"] == 1:
            return subprocess.CompletedProcess(args, 2, stdout=b"", stderr=b"native query failed")
        raise subprocess.TimeoutExpired(args, windows_apps.POWERSHELL_TIMEOUT_SEC)

    monkeypatch.setattr(windows_apps.subprocess, "run", fake_run)

    with pytest.raises(windows_apps.WindowsAppsError, match="native query failed"):
        windows_apps._run_inventory("powershell.exe")
    with pytest.raises(windows_apps.WindowsAppsError, match="timed out after 15 seconds"):
        windows_apps._run_inventory("powershell.exe")
    assert calls["count"] == 2
