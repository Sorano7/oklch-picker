import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";

const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 360;

export interface WindowControlsInit {
    pinned?: boolean;
    compact?: boolean;
    onPinChange?: (v: boolean) => void;
    onCompactChange?: (v: boolean) => void;
    onClose?: () => Promise<void>;
}

export function initWindowControls(init: WindowControlsInit = {}): void {
    const win = getCurrentWindow();

    document.querySelector("#close-btn")?.addEventListener("click", () => {
        void (async () => {
            await init.onClose?.();
            await win.close();
        })();
    });

    document.querySelector("#reset-btn")?.addEventListener("click", () => {
        void win.setSize(new LogicalSize(DEFAULT_WIDTH, DEFAULT_HEIGHT));
    });

    document.querySelector("#min-btn")?.addEventListener("click", () => {
        void win.minimize();
    });

    const pinBtn = document.querySelector<HTMLElement>("#pin-btn");
    let pinned = init.pinned ?? true;
    if (pinBtn) {
        pinBtn.classList.toggle("active", pinned);
        pinBtn.title = pinned ? "Always on top: on" : "Always on top: off";
        void win.setAlwaysOnTop(pinned);
    }
    pinBtn?.addEventListener("click", () => {
        pinned = !pinned;
        pinBtn.classList.toggle("active", pinned);
        pinBtn.title = pinned ? "Always on top: on" : "Always on top: off";
        void win.setAlwaysOnTop(pinned);
        init.onPinChange?.(pinned);
    });

    const compactBtn = document.querySelector<HTMLElement>("#compact-btn");
    let compact = init.compact ?? false;
    if (compactBtn) {
        document.body.classList.toggle("compact", compact);
        compactBtn.classList.toggle("active", compact);
        compactBtn.title = `Pin window: ${compact ? "on" : "off"}`;
    }
    compactBtn?.addEventListener("click", () => {
        compact = !compact;
        document.body.classList.toggle("compact", compact);
        compactBtn.classList.toggle("active", compact);
        compactBtn.title = `Pin window: ${compact ? "on" : "off"}`;
        init.onCompactChange?.(compact);
    });

    document.querySelectorAll<HTMLElement>("[data-resize]").forEach((el) => {
        el.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            void win.startResizeDragging(el.dataset.resize as never);
        });
    });
}
