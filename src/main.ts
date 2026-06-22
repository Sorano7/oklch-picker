import { invoke } from "@tauri-apps/api/core";
import { Picker } from "./picker";
import { oklchToHex, type Oklch } from "./color";
import { initWindowControls } from "./window";
import { startCsp, pushColor, reconnect, setStatusCallback, setColorFromCspCallback, type CspStatus } from "./csp";
import { initSettings } from "./settings";

interface SavedState {
    color: [number, number, number];
    locked: boolean;
    always_on_top: boolean;
    compact: boolean;
}

interface AppState {
    color: Oklch;
    locked: boolean;
    alwaysOnTop: boolean;
    compact: boolean;
}

const DEFAULT: AppState = {
    color: { l: 0.72, c: 0.15, h: 30 },
    locked: true,
    alwaysOnTop: true,
    compact: false,
};

async function copyText(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
    }
}

window.addEventListener("DOMContentLoaded", () => { void init(); });

async function init(): Promise<void> {
    // Load persisted state, fall back to defaults on any error.
    let saved: SavedState;
    try {
        saved = await invoke<SavedState>("state_load");
    } catch {
        saved = {
            color: [DEFAULT.color.l, DEFAULT.color.c, DEFAULT.color.h],
            locked: DEFAULT.locked,
            always_on_top: DEFAULT.alwaysOnTop,
            compact: DEFAULT.compact,
        };
    }

    const state: AppState = {
        color: { l: saved.color[0], c: saved.color[1], h: saved.color[2] },
        locked: saved.locked,
        alwaysOnTop: saved.always_on_top,
        compact: saved.compact,
    };

    // Debounced for color drags; immediate for toggle events and on-close flush.
    let saveTimer = 0;
    async function flushSave(): Promise<void> {
        window.clearTimeout(saveTimer);
        try {
            await invoke("state_save", {
                color: [state.color.l, state.color.c, state.color.h] as [number, number, number],
                locked: state.locked,
                alwaysOnTop: state.alwaysOnTop,
                compact: state.compact,
            });
        } catch (e) {
            console.warn("state_save failed:", e);
        }
    }
    function scheduleSave(): void {
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => void flushSave(), 600);
    }

    initWindowControls({
        pinned: state.alwaysOnTop,
        compact: state.compact,
        onPinChange: (v) => { state.alwaysOnTop = v; void flushSave(); },
        onCompactChange: (v) => { state.compact = v; void flushSave(); },
        onClose: flushSave,
    });

    const canvas = document.querySelector<HTMLCanvasElement>("#picker-canvas")!;
    const wrap = document.querySelector<HTMLElement>("#picker-wrap")!;
    const hexEl = document.querySelector<HTMLElement>("#hex")!;
    const swatch = document.querySelector<HTMLElement>("#swatch")!;
    const footer = document.querySelector<HTMLElement>("#footer")!;
    const hint = document.querySelector<HTMLElement>("#copy-hint")!;
    const dot = document.querySelector<HTMLElement>("#csp-dot")!;

    let cspConnected = false;
    setStatusCallback((s: CspStatus) => {
        cspConnected = s.connected;
        dot.classList.toggle("connected", s.connected);
        dot.classList.toggle("error", !s.connected && s.reason !== "");
        const label = s.connected
            ? "CSP: connected"
            : s.reason
                ? `CSP: ${s.reason}`
                : "CSP: not connected";
        dot.title = label;
    });

    initSettings(() => reconnect());

    const picker = new Picker(canvas, state.color);
    picker.setLocked(state.locked);

    let initialized = false;
    let updatingFromCsp = false;

    picker.onChange = (c) => {
        state.color = c;
        const hex = oklchToHex(c.l, c.c, c.h);
        hexEl.textContent = hex;
        swatch.style.background = hex;
        if (!updatingFromCsp) pushColor(c);
        if (initialized) scheduleSave();
    };

    setColorFromCspCallback((incoming) => {
        const cur = picker.getColor();

        // When chroma is negligible the hue is undefined (e.g. black → CSP reports H=0).
        // Preserve the user's current hue so the ring doesn't jump.
        const next: typeof incoming = incoming.c < 0.005
            ? { ...incoming, h: cur.h }
            : incoming;

        // Skip if the color hasn't changed meaningfully; catches CSP echoing back what we
        // just sent (roundtrip through HSL quantisation keeps the diff well below 0.002).
        const rawDh = Math.abs(next.h - cur.h) % 360;
        const dh = rawDh > 180 ? 360 - rawDh : rawDh;
        if (Math.abs(next.l - cur.l) < 0.002 &&
            Math.abs(next.c - cur.c) < 0.002 &&
            (next.c < 0.005 || dh < 0.5)) return;

        updatingFromCsp = true;
        picker.setColor(next);
        updatingFromCsp = false;
    });

    const lockBtn = document.querySelector<HTMLButtonElement>("#lock-btn")!;
    lockBtn.classList.toggle("active", state.locked);
    lockBtn.title = `Lock to in-gamut: ${state.locked ? "on" : "off"}`;
    lockBtn.addEventListener("click", () => {
        state.locked = !state.locked;
        picker.setLocked(state.locked);
        lockBtn.classList.toggle("active", state.locked);
        lockBtn.title = `Lock to in-gamut: ${state.locked ? "on" : "off"}`;
        void flushSave();
    });

    wrap.addEventListener("pointerleave", () => {
        if (cspConnected && state.alwaysOnTop) void invoke("focus_csp_window");
    });

    const fit = () => {
        const size = Math.max(40, Math.min(wrap.clientWidth, wrap.clientHeight));
        picker.resize(size);
    };
    new ResizeObserver(fit).observe(wrap);

    const scaleRoot = () => {
        const px = Math.max(8, Math.min(18, Math.min(window.innerWidth, window.innerHeight) / 26));
        document.documentElement.style.fontSize = px + "px";
    };
    scaleRoot();
    window.addEventListener("resize", scaleRoot);

    requestAnimationFrame(() => {
        fit();
        picker.onChange(picker.getColor());
        initialized = true;
    });

    void startCsp();

    let hintTimer = 0;
    footer.addEventListener("click", async () => {
        await copyText(hexEl.textContent ?? "");
        hint.textContent = "copied!";
        footer.classList.add("copied");
        window.clearTimeout(hintTimer);
        hintTimer = window.setTimeout(() => {
            hint.textContent = "click to copy";
            footer.classList.remove("copied");
        }, 1200);
    });
}
