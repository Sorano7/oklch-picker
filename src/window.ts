import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";

// Default window size, matching tauri.conf.json.
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 360;

// Frameless window: no native resize border, so we drive it via Tauri API.
export function initWindowControls(): void {
    const win = getCurrentWindow();

    document.querySelector("#close-btn")?.addEventListener("click", () => {
        void win.close();
    });

    document.querySelector("#reset-btn")?.addEventListener("click", () => {
        void win.setSize(new LogicalSize(DEFAULT_WIDTH, DEFAULT_HEIGHT));
    });

    document.querySelector("#min-btn")?.addEventListener("click", () => {
        void win.minimize();
    });

    const pinBtn = document.querySelector<HTMLElement>("#pin-btn");
    let pinned = true; // matches alwaysOnTop in tauri.conf.json
    pinBtn?.addEventListener("click", () => {
        pinned = !pinned;
        pinBtn.classList.toggle("active", pinned);
        pinBtn.title = pinned ? "Always on top: on" : "Always on top: off";
        void win.setAlwaysOnTop(pinned);
    });

    const compactBtn = document.querySelector<HTMLElement>("#compact-btn");
    let compact = false;
    compactBtn?.addEventListener("click", () => {
        compact = !compact;
        document.body.classList.toggle("compact", compact);
        compactBtn.classList.toggle("active", compact);
        compactBtn.title = `Pin window: ${compact ? "on" : "off"}`;
    });

    document.querySelectorAll<HTMLElement>("[data-resize]").forEach((el) => {
        el.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            void win.startResizeDragging(el.dataset.resize as never);
        });
    });
}
