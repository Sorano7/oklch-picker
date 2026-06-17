import { invoke } from "@tauri-apps/api/core";

interface CspSettings {
    host: string;
    port: number;
    token: string;
    session_id: string;
}

export function initSettings(onSave: () => void): void {
    const panel = document.querySelector<HTMLElement>("#settings-panel")!;
    const settingsBtn = document.querySelector<HTMLButtonElement>("#settings-btn")!;
    const closeBtn = document.querySelector<HTMLButtonElement>("#s-close")!;
    const saveBtn = document.querySelector<HTMLButtonElement>("#s-save")!;
    const hostEl = document.querySelector<HTMLInputElement>("#s-host")!;
    const portEl = document.querySelector<HTMLInputElement>("#s-port")!;
    const tokenEl = document.querySelector<HTMLInputElement>("#s-token")!;
    const sessionEl = document.querySelector<HTMLInputElement>("#s-session")!;

    async function open() {
        const s = await invoke<CspSettings>("csp_get_settings");
        hostEl.value = s.host;
        portEl.value = String(s.port);
        tokenEl.value = s.token;
        sessionEl.value = s.session_id;
        panel.classList.add("open");
        settingsBtn.classList.add("active");
        hostEl.focus();
    }

    function close() {
        panel.classList.remove("open");
        settingsBtn.classList.remove("active");
    }

    async function save() {
        const settings: CspSettings = {
            host: hostEl.value.trim() || "127.0.0.1",
            port: Math.max(1, Math.min(65535, parseInt(portEl.value, 10) || 32035)),
            token: tokenEl.value.trim(),
            session_id: sessionEl.value.trim(),
        };
        try {
            await invoke("csp_save_settings", { settings });
            close();
            onSave();
        } catch (e) {
            console.error("Failed to save settings:", e);
        }
    }

    settingsBtn.addEventListener("click", open);
    closeBtn.addEventListener("click", close);
    saveBtn.addEventListener("click", () => void save());

    panel.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
    });
}
