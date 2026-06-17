import { oklchToSrgb255, inGamut, type Oklch } from "./color";

// Max chroma in the LC square
const C_MAX = 0.37;

const RING_L = 0.65;
const RING_C = 0.16;

// Internal resolution
const SQUARE_RES = 200;

const BOUNDARY_SAMPLES = 128;

// RDP tolerance for locked-drag projection
const PROJECT_TOL = 0.03;

type DragMode = "ring" | "square" | null;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function enc(x: number): number {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
}

function rdp(pts: Array<[number, number]>, tol: number): Array<[number, number]> {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [sx, sy] = pts[s];
    const [ex, ey] = pts[e];
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.hypot(dx, dy) || 1;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i];
      const d = Math.abs((px - sx) * dy - (py - sy) * dx) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

export class Picker {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ringCanvas = document.createElement("canvas");
  private squareCanvas = document.createElement("canvas");

  private dpr = 1;
  private size = 0; // CSS px

  private color: Oklch;

  // Geometry in CSS px, relative to canvas top-left.
  private cx = 0;
  private cy = 0;
  private outerR = 0;
  private innerEdge = 0;
  private secOuter = 0; // hue availability ring
  private secInner = 0;
  private secWidth = 0;
  private squareSide = 0;
  private half = 0;

  private locked = true;

  // Max in-gamut chroma per lightness for current hue, normalized 0..1. Index i → lightness i/(N-1).
  private boundary: number[] = [];

  // RDP-simplified boundary for locked-drag projection.
  private projPath: Array<[number, number]> = [];

  // Cached secondary ring arc runs, keyed on (l, c).
  private secArcRuns: Array<[number, number]> = [];
  private secArcL = NaN;
  private secArcC = NaN;

  private dragMode: DragMode = null;

  onChange: (c: Oklch) => void = () => {};

  constructor(canvas: HTMLCanvasElement, initial: Oklch) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.color = { ...initial };
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
  }

  getColor(): Oklch {
    return { ...this.color };
  }

  setColor(c: Oklch): void {
    this.color = { ...c };
    this.renderSquare();
    this.composite();
    this.onChange(this.getColor());
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
  }

  resize(cssSize: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.size = cssSize;
    const px = Math.round(cssSize * this.dpr);
    this.canvas.width = px;
    this.canvas.height = px;
    this.canvas.style.width = cssSize + "px";
    this.canvas.style.height = cssSize + "px";

    this.computeGeometry();
    this.renderRing();
    this.renderSquare();
    this.composite();
  }

  private computeGeometry(): void {
    const s = this.size;
    this.cx = s / 2;
    this.cy = s / 2;

    const margin = Math.max(6, s * 0.045);
    this.outerR = s / 2 - margin;
    const ringWidth = Math.max(8, this.outerR * 0.18);
    this.innerEdge = this.outerR - ringWidth;
    const secGap = Math.max(2, this.outerR * 0.025);
    this.secOuter = this.innerEdge - secGap;
    this.secWidth = Math.max(1.5, this.outerR * 0.022);
    this.secInner = this.secOuter - this.secWidth;
    const gap = s * 0.02;
    this.squareSide = Math.max(0, (this.secInner - gap) * Math.SQRT2);
    this.half = this.squareSide / 2;
  }

  // Only depends on size; rendered once per resize.
  private renderRing(): void {
    const rc = this.ringCanvas;
    rc.width = this.canvas.width;
    rc.height = this.canvas.height;
    const c = rc.getContext("2d")!;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.size, this.size);

    const { cx, cy, outerR } = this;
    // Hue increases clockwise from East (screen angle = hue).
    for (let h = 0; h < 360; h++) {
      const a0 = (h * Math.PI) / 180 - 0.02;
      const a1 = ((h + 1) * Math.PI) / 180 + 0.02;
      c.beginPath();
      c.moveTo(cx, cy);
      c.arc(cx, cy, outerR, a0, a1);
      c.closePath();
      const [r, g, b] = oklchToSrgb255(RING_L, RING_C, h + 0.5);
      c.fillStyle = `rgb(${r},${g},${b})`;
      c.fill();
    }

    c.globalCompositeOperation = "destination-out";
    c.beginPath();
    c.arc(cx, cy, this.innerEdge, 0, Math.PI * 2);
    c.fill();
    c.globalCompositeOperation = "source-over";
  }

  // C->horizontal; L->vertical
  private renderSquare(): void {
    const sc = this.squareCanvas;
    sc.width = SQUARE_RES;
    sc.height = SQUARE_RES;
    const c = sc.getContext("2d")!;
    const img = c.createImageData(SQUARE_RES, SQUARE_RES);
    const data = img.data;
    const h = this.color.h;

    // Hue is constant; compute trig once and inline the Oklab→linear-RGB matrix.
    const hr = (h * Math.PI) / 180;
    const cosH = Math.cos(hr);
    const sinH = Math.sin(hr);
    const dL = 0.3963377774 * cosH + 0.2158037573 * sinH;
    const dM = -0.1055613458 * cosH - 0.0638541728 * sinH;
    const dS = -0.0894841775 * cosH - 1.291485548 * sinH;

    let i = 0;
    for (let py = 0; py < SQUARE_RES; py++) {
      const l = 1 - py / (SQUARE_RES - 1);
      for (let px = 0; px < SQUARE_RES; px++) {
        const ch = (px / (SQUARE_RES - 1)) * C_MAX;
        const l_ = l + ch * dL;
        const m_ = l + ch * dM;
        const s_ = l + ch * dS;
        const L = l_ * l_ * l_;
        const M = m_ * m_ * m_;
        const S = s_ * s_ * s_;
        data[i++] = enc(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S);
        data[i++] = enc(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S);
        data[i++] = enc(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S);
        data[i++] = 255;
      }
    }
    c.putImageData(img, 0, 0);

    this.computeBoundary();
  }

  private maxChroma(l: number, h: number): number {
    if (inGamut(l, C_MAX, h)) return C_MAX;
    let lo = 0;
    let hi = C_MAX;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (inGamut(l, mid, h)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  private computeBoundary(): void {
    const h = this.color.h;
    const arr = new Array<number>(BOUNDARY_SAMPLES);
    const pts = new Array<[number, number]>(BOUNDARY_SAMPLES);
    for (let i = 0; i < BOUNDARY_SAMPLES; i++) {
      const l = i / (BOUNDARY_SAMPLES - 1);
      const u = this.maxChroma(l, h) / C_MAX;
      arr[i] = u;
      pts[i] = [u, l];
    }
    this.boundary = arr;
    this.projPath = rdp(pts, PROJECT_TOL);
  }

  // Nearest in-gamut point in normalized coords (u = chroma/C_MAX, v = lightness).
  private projectIntoGamut(u: number, v: number): [number, number] {
    const b = this.boundary;
    const N = b.length;
    if (N < 2) return [u, v];

    const f = v * (N - 1);
    const i0 = Math.min(N - 2, Math.max(0, Math.floor(f)));
    const frac = f - i0;
    const uMax = b[i0] * (1 - frac) + b[i0 + 1] * frac;
    if (u <= uMax) return [u, v]; // already in gamut

    // Project onto the simplified boundary path; nearest point may be edge or vertex.
    const p = this.projPath;
    if (p.length < 2) return [u, v];
    let bestU = u;
    let bestV = v;
    let bestD = Infinity;
    for (let i = 0; i < p.length - 1; i++) {
      const [au, av] = p[i];
      const [bu, bv] = p[i + 1];
      const dx = bu - au;
      const dy = bv - av;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((u - au) * dx + (v - av) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const pu = au + t * dx;
      const pv = av + t * dy;
      const ddu = u - pu;
      const ddv = v - pv;
      const d = ddu * ddu + ddv * ddv;
      if (d < bestD) {
        bestD = d;
        bestU = pu;
        bestV = pv;
      }
    }
    return [bestU, bestV];
  }

  private composite(): void {
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Already at device resolution.
    ctx.drawImage(this.ringCanvas, 0, 0);

    if (this.squareSide > 0) {
      const left = (this.cx - this.half) * d;
      const top = (this.cy - this.half) * d;
      const side = this.squareSide * d;
      ctx.drawImage(this.squareCanvas, left, top, side, side);
      this.drawGamut(left, top, side, d);
    }

    this.drawSecondaryRing(d);
    this.drawRingMarker(d);
    this.drawSquareMarker(d);
  }

  // Hue availability ring: white where current L/C is in sRGB gamut.
  private drawSecondaryRing(d: number): void {
    if (this.secInner <= 0) return;
    const l = this.color.l;
    const c = this.color.c;

    if (l !== this.secArcL || c !== this.secArcC) {
      this.secArcL = l;
      this.secArcC = c;
      const runs: Array<[number, number]> = [];
      let runStart = -1;
      for (let h = 0; h <= 360; h++) {
        const ok = h < 360 && inGamut(l, c, h);
        if (ok && runStart < 0) {
          runStart = h;
        } else if (!ok && runStart >= 0) {
          runs.push([runStart, h]);
          runStart = -1;
        }
      }
      this.secArcRuns = runs;
    }

    const ctx = this.ctx;
    const cx = this.cx * d;
    const cy = this.cy * d;
    const r = ((this.secInner + this.secOuter) / 2) * d;
    ctx.lineWidth = this.secWidth * d;
    ctx.lineCap = "butt";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";

    for (const [start, end] of this.secArcRuns) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, (start * Math.PI) / 180, (end * Math.PI) / 180);
      ctx.stroke();
    }
  }

  // Gamut boundary line; out-of-gamut region muted and hatched.
  private drawGamut(left: number, top: number, side: number, d: number): void {
    const ctx = this.ctx;
    const N = this.boundary.length;
    if (N < 2) return;

    const bx = (i: number) => left + this.boundary[i] * side;
    const by = (i: number) => top + (1 - i / (N - 1)) * side;

    const region = new Path2D();
    region.moveTo(bx(0), by(0));
    for (let i = 1; i < N; i++) region.lineTo(bx(i), by(i));
    region.lineTo(left + side, top);
    region.lineTo(left + side, top + side);
    region.closePath();

    ctx.save();
    ctx.clip(region);
    ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
    ctx.fillRect(left, top, side, side);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.26)";
    ctx.lineWidth = Math.max(1, this.size * 0.004 * d);
    const step = Math.max(7, side * 0.055);
    ctx.beginPath();
    for (let o = -side; o <= side; o += step) {
      ctx.moveTo(left + o, top);
      ctx.lineTo(left + o + side, top + side);
    }
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(bx(0), by(0));
    for (let i = 1; i < N; i++) ctx.lineTo(bx(i), by(i));
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, this.size * 0.0042 * d);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.stroke();
  }

  private drawRingMarker(d: number): void {
    const midR = (this.outerR + this.innerEdge) / 2;
    const ang = (this.color.h * Math.PI) / 180;
    const x = (this.cx + midR * Math.cos(ang)) * d;
    const y = (this.cy + midR * Math.sin(ang)) * d;
    this.drawMarker(x, y, Math.max(4, this.size * 0.02) * d);
  }

  private drawSquareMarker(d: number): void {
    if (this.squareSide <= 0) return;
    const l = clamp(this.color.l, 0, 1);
    const chroma = clamp(this.color.c, 0, C_MAX);
    const x = (this.cx - this.half + (chroma / C_MAX) * this.squareSide) * d;
    const y = (this.cy - this.half + (1 - l) * this.squareSide) * d;
    this.drawMarker(x, y, Math.max(4, this.size * 0.02) * d);
  }

  // Double ring (dark outer, light inner) so the swatch color shows through.
  private drawMarker(x: number, y: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, r * 0.3);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r - ctx.lineWidth * 0.4, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.stroke();
  }

  private localPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    const { x, y } = this.localPoint(e);
    const dx = x - this.cx;
    const dy = y - this.cy;

    if (Math.abs(dx) <= this.half && Math.abs(dy) <= this.half) {
      this.dragMode = "square";
    } else {
      const r = Math.hypot(dx, dy);
      this.dragMode =
        r <= this.outerR + 4 && r >= this.innerEdge - 4 ? "ring" : null;
    }

    if (!this.dragMode) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.applyPoint(x, y);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const { x, y } = this.localPoint(e);
    this.applyPoint(x, y);
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.dragMode = null;
    this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
  };

  private applyPoint(x: number, y: number): void {
    if (this.dragMode === "ring") {
      const deg = (Math.atan2(y - this.cy, x - this.cx) * 180) / Math.PI;
      this.color.h = (deg + 360) % 360;
      this.renderSquare();
    } else if (this.dragMode === "square") {
      let u = clamp((x - (this.cx - this.half)) / this.squareSide, 0, 1);
      let v = clamp(1 - (y - (this.cy - this.half)) / this.squareSide, 0, 1);
      // Locked: project onto gamut boundary so the cursor slides along it.
      if (this.locked) [u, v] = this.projectIntoGamut(u, v);
      this.color.c = u * C_MAX;
      this.color.l = v;
    } else {
      return;
    }
    this.composite();
    this.onChange(this.getColor());
  }
}
