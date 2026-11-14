"""Native Windows app mirror: enumerate visible windows and capture one window.

The macOS Lab uses CoreGraphics through ctypes; this is the Windows counterpart.
It deliberately stays standard-library ctypes only, needs no elevated process, and
never exposes process command lines or performs input control.
"""

from __future__ import annotations

import ctypes
import os
import struct
import sys
import time
import zlib
from ctypes import wintypes
from pathlib import Path
from typing import Any

PW_RENDERFULLCONTENT = 0x00000002
DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = ctypes.c_void_p(-4)
GA_ROOT = 2
WS_CAPTION = 0x00C00000
WS_EX_TOOLWINDOW = 0x00000080
MAX_TITLE_CHARS = 512
MAX_WINDOW_CHARS = 200
TOOL_CLASSES = {
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "ThumbnailDeviceHelperWnd",
    "PseudoConsoleWindow",
}


class WinAppError(Exception):
    """A safe, user-presentable native window inventory/capture failure."""


if sys.platform == "win32":
    _user32 = ctypes.WinDLL("user32", use_last_error=True)
    _gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class _RECT(ctypes.Structure):
        _fields_ = [("left", wintypes.LONG), ("top", wintypes.LONG),
                    ("right", wintypes.LONG), ("bottom", wintypes.LONG)]

    class _BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
            ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD),
            ("biCompression", wintypes.DWORD), ("biSizeImage", wintypes.DWORD),
            ("biXPelsPerMeter", wintypes.LONG), ("biYPelsPerMeter", wintypes.LONG),
            ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD),
        ]

    class _BITMAPINFO(ctypes.Structure):
        _fields_ = [("bmiHeader", _BITMAPINFOHEADER), ("bmiColors", ctypes.c_ubyte * 4)]

    _ENUM_WINDOWS_PROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    _user32.EnumWindows.argtypes = [_ENUM_WINDOWS_PROC, wintypes.LPARAM]
    _user32.EnumWindows.restype = wintypes.BOOL
    _user32.IsWindowVisible.argtypes = [wintypes.HWND]
    _user32.IsWindowVisible.restype = wintypes.BOOL
    _user32.IsIconic.argtypes = [wintypes.HWND]
    _user32.IsIconic.restype = wintypes.BOOL
    _user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(_RECT)]
    _user32.GetWindowRect.restype = wintypes.BOOL
    _user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    _user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    _user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
    _user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    _user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    _user32.GetWindowTextLengthW.restype = ctypes.c_int
    _user32.GetWindowTextW.argtypes = [wintypes.HWND, ctypes.c_wchar_p, ctypes.c_int]
    _user32.GetWindowTextW.restype = ctypes.c_int
    _user32.GetClassNameW.argtypes = [wintypes.HWND, ctypes.c_wchar_p, ctypes.c_int]
    _user32.GetClassNameW.restype = ctypes.c_int
    _user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
    _user32.GetAncestor.restype = wintypes.HWND
    _user32.GetWindowDC.argtypes = [wintypes.HWND]
    _user32.GetWindowDC.restype = wintypes.HDC
    _user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
    _user32.ReleaseDC.restype = ctypes.c_int
    _user32.PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
    _user32.PrintWindow.restype = wintypes.BOOL
    _user32.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    _user32.SetProcessDpiAwarenessContext.restype = wintypes.BOOL

    _gdi32.CreateCompatibleDC.argtypes = [wintypes.HDC]
    _gdi32.CreateCompatibleDC.restype = wintypes.HDC
    _gdi32.CreateCompatibleBitmap.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int]
    _gdi32.CreateCompatibleBitmap.restype = wintypes.HBITMAP
    _gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HBITMAP]
    _gdi32.SelectObject.restype = wintypes.HBITMAP
    _gdi32.DeleteObject.argtypes = [wintypes.HBITMAP]
    _gdi32.DeleteObject.restype = wintypes.BOOL
    _gdi32.DeleteDC.argtypes = [wintypes.HDC]
    _gdi32.DeleteDC.restype = wintypes.BOOL
    _gdi32.GetDIBits.argtypes = [
        wintypes.HDC, wintypes.HBITMAP, ctypes.c_uint, ctypes.c_uint,
        ctypes.c_void_p, ctypes.POINTER(_BITMAPINFO), ctypes.c_uint,
    ]
    _gdi32.GetDIBits.restype = ctypes.c_int

    _kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    _kernel32.OpenProcess.restype = wintypes.HANDLE
    _kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, ctypes.c_wchar_p, ctypes.POINTER(wintypes.DWORD)
    ]
    _kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    _kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    _kernel32.CloseHandle.restype = wintypes.BOOL
else:
    _user32 = _gdi32 = _kernel32 = None


def _set_dpi_awareness() -> None:
    """Set per-monitor DPI awareness once, so coordinates stay physical pixels."""
    if sys.platform != "win32":
        return
    if _user32 is not None and _user32.SetProcessDpiAwarenessContext(
        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
    ):
        return
    try:
        shcore = ctypes.WinDLL("shcore", use_last_error=True)
        # PER_MONITOR_AWARE_V2 == 2 in the older Shcore API.
        shcore.SetProcessDpiAwareness(2)
    except (OSError, AttributeError):
        pass


_set_dpi_awareness()


def unavailable(reason: str) -> dict[str, Any]:
    return {"available": False, "reason": reason, "windows": []}


def _process_name(pid: int) -> str:
    """The executable basename for one pid, without command-line data."""
    if _kernel32 is None:
        return ""
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    handle = _kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return ""
    try:
        size = wintypes.DWORD(1024)
        path = ctypes.create_unicode_buffer(1024)
        if _kernel32.QueryFullProcessImageNameW(handle, 0, path, size):
            return Path(path.value).stem
        return ""
    finally:
        _kernel32.CloseHandle(handle)


def _window(hwnd: int) -> dict[str, Any] | None:
    """One visible, non-iconic top-level window, or None for shell/tool windows."""
    if _user32 is None or not _user32.IsWindowVisible(hwnd) or _user32.IsIconic(hwnd):
        return None
    style = int(_user32.GetWindowLongPtrW(hwnd, -16)) & 0xFFFFFFFF
    if not style & WS_CAPTION:
        return None
    ex_style = int(_user32.GetWindowLongPtrW(hwnd, -20)) & 0xFFFFFFFF
    if ex_style & WS_EX_TOOLWINDOW:
        return None
    pid = wintypes.DWORD()
    _user32.GetWindowThreadProcessId(hwnd, pid)
    if not pid.value:
        return None
    length = _user32.GetWindowTextLengthW(hwnd)
    title = ctypes.create_unicode_buffer(max(1, length + 1))
    if length:
        _user32.GetWindowTextW(hwnd, title, length + 1)
    class_name = ctypes.create_unicode_buffer(256)
    _user32.GetClassNameW(hwnd, class_name, 256)
    if not class_name.value or class_name.value in TOOL_CLASSES:
        return None
    rect = _RECT()
    if not _user32.GetWindowRect(hwnd, rect):
        return None
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width <= 0 or height <= 0:
        return None
    app = _process_name(pid.value)
    if not app:
        return None
    return {
        "windowId": int(hwnd),
        "pid": int(pid.value),
        "app": app[:MAX_WINDOW_CHARS],
        "title": title.value[:MAX_TITLE_CHARS],
        "className": class_name.value[:MAX_WINDOW_CHARS],
        "x": int(rect.left),
        "y": int(rect.top),
        "width": int(width),
        "height": int(height),
    }


def _win_windows() -> list[dict[str, Any]]:
    """Enumerate visible top-level windows with ctypes; no Screen Recording equivalent is needed."""
    if sys.platform != "win32":
        raise WinAppError("Native Windows window inventory needs a Windows host")
    windows: list[dict[str, Any]] = []
    seen: set[int] = set()

    def callback(hwnd: int, _lparam: int) -> bool:
        # Tool windows often have no visible owner, so accept only their own root window.
        if _user32 is not None and _user32.GetAncestor(hwnd, GA_ROOT) == hwnd:
            window = _window(hwnd)
            if window and window["windowId"] not in seen:
                seen.add(window["windowId"])
                windows.append(window)
        return True

    if not _user32.EnumWindows(_ENUM_WINDOWS_PROC(callback), 0):
        raise WinAppError("Windows window enumeration failed")
    windows.sort(key=lambda window: (window["app"].casefold(), window["title"].casefold(), window["windowId"]))
    return windows


def winapps_windows() -> dict[str, Any]:
    """The panel's read-only window inventory."""
    if sys.platform != "win32":
        return unavailable("Native Windows app mirror needs a Windows host")
    try:
        windows = _win_windows()
    except WinAppError as exc:
        return unavailable(str(exc))
    return {"available": True, "reason": None, "windows": windows}


def _png(width: int, height: int, bgra: bytes) -> bytes:
    """Encode a 32-bit BGRA buffer as an RGBA PNG with only the standard library."""
    rgba = bytearray(len(bgra))
    for offset in range(0, len(bgra), 4):
        rgba[offset] = bgra[offset + 2]
        rgba[offset + 1] = bgra[offset + 1]
        rgba[offset + 2] = bgra[offset]
        rgba[offset + 3] = bgra[offset + 3]
    raw = b"".join(
        b"\x00" + bytes(rgba[row * width * 4:(row + 1) * width * 4]) for row in range(height)
    )

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def winapps_window_screenshot(window_id: int) -> bytes:
    """A PNG of one on-screen window. Raises WinAppError when the id is stale or capture fails."""
    if sys.platform != "win32" or _user32 is None or _gdi32 is None:
        raise WinAppError("Native Windows app mirror needs a Windows host")
    try:
        hwnd = int(window_id)
    except (TypeError, ValueError):
        raise WinAppError("Invalid window id") from None
    window = next((window for window in _win_windows() if window["windowId"] == hwnd), None)
    if window is None:
        raise WinAppError("That window is not on screen anymore; refresh the mirror")
    if not _user32.IsWindowVisible(hwnd):
        raise WinAppError("That window is not on screen anymore; refresh the mirror")

    rect = _RECT()
    if not _user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        raise WinAppError("Could not read the window size")
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width <= 0 or height <= 0:
        raise WinAppError("Could not read the window size")

    screen_dc = _user32.GetWindowDC(hwnd)
    if not screen_dc:
        raise WinAppError("Could not open the window display context")
    memory_dc = _gdi32.CreateCompatibleDC(screen_dc)
    bitmap = _gdi32.CreateCompatibleBitmap(screen_dc, width, height)
    if not memory_dc or not bitmap:
        if memory_dc:
            _gdi32.DeleteDC(memory_dc)
        _user32.ReleaseDC(hwnd, screen_dc)
        raise WinAppError("Could not create the window capture surface")
    old_bitmap = _gdi32.SelectObject(memory_dc, bitmap)
    captured = _user32.PrintWindow(hwnd, memory_dc, PW_RENDERFULLCONTENT)
    bitmap_info = _BITMAPINFO()
    bitmap_info.bmiHeader.biSize = ctypes.sizeof(_BITMAPINFOHEADER)
    bitmap_info.bmiHeader.biWidth = width
    bitmap_info.bmiHeader.biHeight = -height
    bitmap_info.bmiHeader.biPlanes = 1
    bitmap_info.bmiHeader.biBitCount = 32
    bitmap_info.bmiHeader.biCompression = 0
    bitmap_info.bmiHeader.biSizeImage = width * height * 4
    pixels = (ctypes.c_ubyte * (width * height * 4))()
    rows = _gdi32.GetDIBits(memory_dc, bitmap, 0, height, pixels, ctypes.byref(bitmap_info), 0)
    _gdi32.SelectObject(memory_dc, old_bitmap)
    _gdi32.DeleteObject(bitmap)
    _gdi32.DeleteDC(memory_dc)
    _user32.ReleaseDC(hwnd, screen_dc)
    if not captured or rows != height:
        raise WinAppError("Could not capture that window; try another application window")
    return _png(width, height, bytes(pixels))


def doctor() -> dict[str, Any]:
    """Desktop session, elevation and one live capture probe result."""
    if sys.platform != "win32":
        return {"available": False, "elevated": False, "capture": False,
                "reason": "Native Windows app mirror needs a Windows host"}
    try:
        windows = _win_windows()
    except WinAppError as exc:
        return {"available": False, "elevated": False, "capture": False, "reason": str(exc)}
    capture = False
    reason: str | None = None
    for window in windows[:8]:
        try:
            png = winapps_window_screenshot(window["windowId"])
            capture = bool(png.startswith(b"\x89PNG"))
            break
        except WinAppError as exc:
            reason = str(exc)
    return {"available": bool(windows), "elevated": False, "capture": capture,
            "reason": reason if not capture else None, "windows": len(windows),
            "checkedAt": int(time.time())}


def main() -> int:
    """Print the JSON inventory; useful for a quick native check."""
    import json
    result = winapps_windows()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["available"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
