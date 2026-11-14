"""Offline contracts for the read-only native Windows app mirror."""

import os
import sys

import pytest

sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "console")))

import winapps


def test_non_windows_hosts_report_native_availability(monkeypatch):
    monkeypatch.setattr(winapps.sys, "platform", "linux")
    result = winapps.winapps_windows()
    assert result["available"] is False and result["windows"] == []
    assert "Windows host" in result["reason"]


def test_invalid_window_ids_are_refused(monkeypatch):
    monkeypatch.setattr(winapps.sys, "platform", "win32")
    with pytest.raises(winapps.WinAppError, match="Invalid window id"):
        winapps.winapps_window_screenshot("not-a-window")


def test_tool_windows_are_excluded_from_the_inventory(monkeypatch):
    class FakeUser32:
        def __init__(self):
            self.hwnd = 1234

        def IsWindowVisible(self, _hwnd):
            return True

        def IsIconic(self, _hwnd):
            return False

        def GetWindowLongPtrW(self, _hwnd, _index):
            # A captioned, non-tool window.
            return winapps.WS_CAPTION

        def GetWindowThreadProcessId(self, _hwnd, out_pid):
            out_pid.value = 42
            return 0

        def GetWindowTextLengthW(self, _hwnd):
            return 5

        def GetWindowTextW(self, _hwnd, buffer, _length):
            buffer.value = "hello"
            return 5

        def GetClassNameW(self, _hwnd, buffer, _length):
            buffer.value = "ApplicationFrameWindow"
            return 22

        def GetWindowRect(self, _hwnd, rect):
            rect.left, rect.top, rect.right, rect.bottom = 10, 20, 30, 40
            return True

        def EnumWindows(self, proc, _lparam):
            return proc(1234, 0)

        def GetAncestor(self, hwnd, _flag):
            return hwnd

    class FakeKernel32:
        def OpenProcess(self, _access, _inherit, _pid):
            return 1

        def QueryFullProcessImageNameW(self, _handle, _flags, buffer, out_size):
            buffer.value = "C:/Some/App/Example.exe"
            out_size.value = len("C:/Some/App/Example.exe")
            return True

        def CloseHandle(self, _handle):
            return True

    monkeypatch.setattr(winapps, "_user32", FakeUser32())
    monkeypatch.setattr(winapps, "_kernel32", FakeKernel32())

    windows = winapps._win_windows()
    assert len(windows) == 1
    assert windows[0]["windowId"] == 1234
    assert windows[0]["app"] == "Example"
    assert windows[0]["title"] == "hello"
    assert windows[0]["className"] == "ApplicationFrameWindow"


def test_tool_window_without_caption_is_not_listed(monkeypatch):
    class FakeUser32:
        def IsWindowVisible(self, _hwnd):
            return True

        def IsIconic(self, _hwnd):
            return False

        def GetWindowLongPtrW(self, _hwnd, _index):
            return 0

        def GetWindowThreadProcessId(self, _hwnd, out_pid):
            out_pid.value = 42
            return 0

        def GetWindowTextLengthW(self, _hwnd):
            return 0

        def GetWindowRect(self, _hwnd, rect):
            rect.left, rect.top, rect.right, rect.bottom = 0, 0, 10, 10
            return True

        def EnumWindows(self, proc, _lparam):
            return proc(1, 0)

        def GetAncestor(self, hwnd, _flag):
            return hwnd

    monkeypatch.setattr(winapps, "_user32", FakeUser32())
    monkeypatch.setattr(winapps, "_kernel32", None)

    assert winapps._win_windows() == []
