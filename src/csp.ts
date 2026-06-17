// Frontend side of the Clip Studio Paint bridge.

import { invoke } from "@tauri-apps/api/core";
import { oklchToHsl, type Oklch } from "./color";

const MIN_INTERVAL_MS = 40;
const RECONNECT_MS = 3000;

export interface CspStatus {
  connected: boolean;
  reason: string; // "Unknown" = OK; anything else = error detail; "" = never tried
}

let connected = false;
let pending: Oklch | null = null;
let sending = false;
let lastSent = 0;
let statusCallback: (s: CspStatus) => void = () => {};

export function setStatusCallback(cb: (s: CspStatus) => void): void {
  statusCallback = cb;
}

function applyStatus(s: CspStatus): void {
  connected = s.connected;
  statusCallback(s);
}

async function connect(): Promise<void> {
  try {
    const status = await invoke<CspStatus>("csp_connect");
    applyStatus(status);
  } catch (e) {
    applyStatus({ connected: false, reason: String(e) });
  }
}

export function reconnect(): void {
  void connect();
}

async function flush(): Promise<void> {
  if (sending || pending === null) return;

  const wait = MIN_INTERVAL_MS - (performance.now() - lastSent);
  if (wait > 0) {
    setTimeout(() => void flush(), wait);
    return;
  }

  const color = pending;
  pending = null;
  sending = true;
  lastSent = performance.now();

  try {
    if (!connected) await connect();
    if (connected) {
      const { h, s, l } = oklchToHsl(color.l, color.c, color.h);
      await invoke("csp_set_color", { h, s, l });
    }
  } catch (e) {
    // a failed send drops the socket in Rust
    applyStatus({ connected: false, reason: "Send failed" });
    console.warn("CSP set color failed:", e);
  } finally {
    sending = false;
    if (pending !== null) void flush();
  }
}

// Only the latest pending color is ever sent.
export function pushColor(color: Oklch): void {
  pending = color;
  void flush();
}

export function startCsp(): void {
  void connect();
  setInterval(() => {
    if (!connected) void connect();
  }, RECONNECT_MS);
}
