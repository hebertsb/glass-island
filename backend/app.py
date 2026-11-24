"""Punto de entrada principal de GlassIsland (Dynamic Island para Windows 10/11).

Usa WebView2 nativo con recorte real de región Win32 (`SetWindowRgn` +
`CreateRoundRectRgn`) para esquinas 100 % redondeadas sin ningún fondo cuadrado
detrás, `WS_EX_TOOLWINDOW` (no ensucia Alt+Tab ni barra de tareas), soporte
DPI-aware, auto-ocultamiento sutil en el borde superior y expansión instantánea
al acercar el cursor.
"""

from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path
from typing import Any

import webview

from backend import windows_bridge as wb

ROOT = Path(__file__).resolve().parents[1]
DIST_INDEX = ROOT / "ui" / "dist" / "index.html"

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_APPWINDOW = 0x00040000


def _find_island_hwnd() -> int:
    return int(user32.FindWindowW(None, "GlassIsland") or 0)


def _apply_rounded_region(
    hwnd: int, width: int, height: int, radius: int, notch_top: bool
) -> None:
    """Recorta físicamente la ventana Win32 para eliminar las esquinas cuadradas."""
    if not hwnd:
        return
    # Escala DPI real de la ventana para que el recorte coincida al pixel
    try:
        dpi = user32.GetDpiForWindow(hwnd)
        scale = dpi / 96.0 if dpi else 1.0
    except Exception:
        scale = 1.0
    pw = max(1, int(round(width * scale)))
    ph = max(1, int(round(height * scale)))
    pr = max(4, int(round(radius * scale)))
    top_y = -pr if notch_top else 0
    hrgn = gdi32.CreateRoundRectRgn(0, top_y, pw + 1, ph + 1, pr * 2, pr * 2)
    if hrgn:
        user32.SetWindowRgn(hwnd, hrgn, True)


def _hide_from_taskbar_and_alttab(hwnd: int) -> None:
    if not hwnd:
        return
    style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
    style = (style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW
    user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style)


class IslandApi:
    """API puente expuesta a React en `window.pywebview.api`."""

    def __init__(self) -> None:
        self._window: webview.Window | None = None
        self._hwnd: int = 0
        self._anchor = "top-center"
        self._custom_x: int | None = None
        self._custom_y: int | None = None

    def bind(self, window: webview.Window) -> None:
        self._window = window

    def _get_hwnd(self) -> int:
        if not self._hwnd:
            self._hwnd = _find_island_hwnd()
            if self._hwnd:
                _hide_from_taskbar_and_alttab(self._hwnd)
        return self._hwnd

    def get_screen_info(self) -> dict[str, int]:
        sw, sh = wb.get_screen_size()
        return {"width": sw, "height": sh}

    def set_geometry(
        self,
        width: int,
        height: int,
        anchor: str = "top-center",
        margin: int = 0,
        custom_x: int | None = None,
        custom_y: int | None = None,
        radius: int = 20,
        notch_top: bool = False,
    ) -> dict[str, Any]:
        """Redimensiona, posiciona y recorta con precisión las esquinas redondeadas."""
        if self._window is None:
            return {"ok": False}
        self._anchor = anchor
        sw, sh = wb.get_screen_size()
        w = max(72, min(int(width), sw - 20))
        h = max(8, min(int(height), sh - 60))

        if anchor == "free" and custom_x is not None and custom_y is not None:
            x = max(0, min(int(custom_x), sw - w))
            y = max(0, min(int(custom_y), sh - h - 40))
        elif anchor == "top-left":
            x, y = margin, margin
        elif anchor == "top-right":
            x, y = sw - w - margin, margin
        elif anchor == "bottom-center":
            x, y = (sw - w) // 2, sh - h - 52
        elif anchor == "left-center":
            x, y = margin, (sh - h) // 2
        elif anchor == "right-center":
            x, y = sw - w - margin, (sh - h) // 2
        else:
            x, y = (sw - w) // 2, 0 if notch_top else margin

        self._window.resize(w, h)
        self._window.move(x, y)
        hwnd = self._get_hwnd()
        _apply_rounded_region(hwnd, w, h, int(radius), bool(notch_top))
        return {"ok": True, "x": x, "y": y, "w": w, "h": h}

    def move_by(self, dx: int, dy: int) -> dict[str, Any]:
        if self._window is None:
            return {"ok": False}
        sw, sh = wb.get_screen_size()
        nx = max(0, min(int(self._window.x + dx), sw - int(self._window.width)))
        ny = max(0, min(int(self._window.y + dy), sh - int(self._window.height)))
        self._window.move(nx, ny)
        self._custom_x, self._custom_y = nx, ny
        return {"ok": True, "x": nx, "y": ny}

    def snap_current_position(self) -> dict[str, Any]:
        if self._window is None:
            return {"anchor": "top-center"}
        sw, sh = wb.get_screen_size()
        cx = self._window.x + self._window.width / 2
        threshold = 90

        if self._window.y < threshold:
            if cx < sw * 0.3:
                anchor = "top-left"
            elif cx > sw * 0.7:
                anchor = "top-right"
            else:
                anchor = "top-center"
        elif self._window.y + self._window.height > sh - threshold - 40:
            anchor = "bottom-center"
        elif self._window.x < threshold:
            anchor = "left-center"
        elif self._window.x + self._window.width > sw - threshold:
            anchor = "right-center"
        else:
            anchor = "free"

        return {
            "anchor": anchor,
            "x": int(self._window.x),
            "y": int(self._window.y),
        }

    def pick_files_for_shelf(self) -> list[dict[str, Any]]:
        if self._window is None:
            return []
        paths = self._window.create_file_dialog(
            webview.OPEN_DIALOG, allow_multiple=True
        )
        if not paths:
            return []
        out = []
        for p in paths:
            try:
                st = os.stat(p)
                out.append(
                    {
                        "path": p,
                        "name": Path(p).name,
                        "size_bytes": int(st.st_size),
                    }
                )
            except OSError:
                continue
        return out

    def pick_folder_for_shortcut(self) -> str:
        if self._window is None:
            return ""
        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        return str(result[0]) if result else ""

    def get_telemetry(self) -> dict[str, Any]:
        return wb.get_system_telemetry()

    def get_now_playing(self) -> dict[str, Any]:
        return wb.get_now_playing()

    def media_control(self, action: str) -> dict[str, Any]:
        return wb.media_command(action)

    def get_brightness(self) -> int:
        return wb.get_screen_brightness()

    def set_brightness(self, level: int) -> dict[str, Any]:
        return wb.set_screen_brightness(level)

    def get_clipboard(self) -> str:
        return wb.get_clipboard_text()

    def set_clipboard(self, text: str) -> bool:
        return wb.set_clipboard_text(text)

    def launch(self, target: str) -> dict[str, Any]:
        return wb.launch_target(target)

    def load_config(self) -> dict[str, Any]:
        return wb.load_config()

    def save_config(self, data: dict[str, Any]) -> bool:
        return wb.save_config(data)

    def quit_app(self) -> None:
        if self._window is not None:
            self._window.destroy()


def main() -> None:
    if not DIST_INDEX.is_file():
        print(
            f"Falta compilar el frontend en {DIST_INDEX}. Ejecuta: npm --prefix ui run build"
        )
        sys.exit(1)

    api = IslandApi()
    sw, _ = wb.get_screen_size()
    init_w, init_h = 108, 22
    window = webview.create_window(
        title="GlassIsland",
        url=DIST_INDEX.as_uri(),
        js_api=api,
        width=init_w,
        height=init_h,
        x=(sw - init_w) // 2,
        y=0,
        frameless=True,
        easy_drag=False,
        on_top=True,
        transparent=True,
        background_color="#0c0f16",
        shadow=False,
    )
    api.bind(window)

    def _on_shown() -> None:
        hwnd = api._get_hwnd()
        _apply_rounded_region(hwnd, init_w, init_h, 12, True)

    window.events.shown += _on_shown
    webview.start(gui="edgechromium", debug=False)


if __name__ == "__main__":
    main()
