import { Picker } from "./picker";
import { oklchToHex, type Oklch } from "./color";
import { initWindowControls } from "./window";
import { startCsp, pushColor } from "./csp";

const INITIAL: Oklch = { l: 0.72, c: 0.15, h: 30 };

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fallback for contexts where the async clipboard API is unavailable.
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

window.addEventListener("DOMContentLoaded", () => {
  initWindowControls();
  startCsp();

  const canvas = document.querySelector<HTMLCanvasElement>("#picker-canvas")!;
  const wrap = document.querySelector<HTMLElement>("#picker-wrap")!;
  const hexEl = document.querySelector<HTMLElement>("#hex")!;
  const swatch = document.querySelector<HTMLElement>("#swatch")!;
  const footer = document.querySelector<HTMLElement>("#footer")!;
  const hint = document.querySelector<HTMLElement>("#copy-hint")!;

  const picker = new Picker(canvas, INITIAL);
  picker.onChange = (c) => {
    const hex = oklchToHex(c.l, c.c, c.h);
    hexEl.textContent = hex;
    swatch.style.background = hex;
    pushColor(c);
  };

  const lockBtn = document.querySelector<HTMLButtonElement>("#lock-btn")!;
  let locked = true;
  lockBtn.addEventListener("click", () => {
    locked = !locked;
    picker.setLocked(locked);
    lockBtn.textContent = locked ? "🔒" : "🔓";
    lockBtn.classList.toggle("active", locked);
    lockBtn.title = `Lock selection to in-gamut: ${locked ? "on" : "off"}`;
  });

  const fit = () => {
    const size = Math.max(40, Math.min(wrap.clientWidth, wrap.clientHeight));
    picker.resize(size);
  };
  new ResizeObserver(fit).observe(wrap);

  // Scale titlebar and footer text with window size.
  const scaleRoot = () => {
    const px = Math.max(8, Math.min(18, Math.min(window.innerWidth, window.innerHeight) / 26));
    document.documentElement.style.fontSize = px + "px";
  };
  scaleRoot();
  window.addEventListener("resize", scaleRoot);

  // First paint once layout has settled.
  requestAnimationFrame(() => {
    fit();
    picker.onChange(picker.getColor());
  });

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
});
