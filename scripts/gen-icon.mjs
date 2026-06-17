// Generates src-tauri/icons/app-icon-1024.png, then run:
//   pnpm tauri icon src-tauri/icons/app-icon-1024.png
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- OKLCH → sRGB (mirrors color.ts) ----
function hueColor(h) {
    const L = 0.65, C = 0.16;
    const hr = h * Math.PI / 180;
    const a = C * Math.cos(hr), b = C * Math.sin(hr);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const Lc = l_ ** 3, M = m_ ** 3, S = s_ ** 3;
    const enc = x => {
        const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
        return Math.round(Math.max(0, Math.min(1, v)) * 255);
    };
    const r = enc(4.0767416621 * Lc - 3.3077115913 * M + 0.2309699292 * S);
    const g = enc(-1.2684380046 * Lc + 2.6097574011 * M - 0.3413193965 * S);
    const bv = enc(-0.0041960863 * Lc - 0.7034186147 * M + 1.707614701 * S);
    return `rgb(${r},${g},${bv})`;
}

// ---- Geometry ----
const SIZE = 1024;
const cx = SIZE / 2, cy = SIZE / 2;
const BG = '#1a1a1d';
const RX = 224;           // rounded-rect corner radius (~22%, matches macOS icon convention)
const outerR = 440;       // hue ring outer radius
const innerR = 330;       // hue ring inner radius (ring width 110px ≈ 25% – slightly thicker than in-app)
const secR = 305;         // white inner ring centre radius
const secW = 14;          // white inner ring stroke width (spans 298–312, gap of 18px below ring)

// ---- 360 hue wedges (pie slices from centre) ----
// Red at West: screen_angle = hue * π/180 + π  (mirrors the picker exactly)
const PI = Math.PI;
let wedges = '';
for (let h = 0; h < 360; h++) {
    const a0 = (h * PI) / 180 + PI - 0.02;
    const a1 = ((h + 1) * PI) / 180 + PI + 0.02;
    const x1 = (cx + outerR * Math.cos(a0)).toFixed(2);
    const y1 = (cy + outerR * Math.sin(a0)).toFixed(2);
    const x2 = (cx + outerR * Math.cos(a1)).toFixed(2);
    const y2 = (cy + outerR * Math.sin(a1)).toFixed(2);
    wedges += `<path d="M ${cx},${cy} L ${x1},${y1} A ${outerR},${outerR} 0 0 1 ${x2},${y2} Z" fill="${hueColor(h + 0.5)}"/>`;
}

// ---- SVG ----
// Layer order:
//   1. Background rounded-square
//   2. 360 pie wedges  (naturally bounded by outerR, never reach image edges)
//   3. Filled circle at innerR with BG colour  → punches the donut hole
//   4. White inner ring (inside the donut hole)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" rx="${RX}" fill="${BG}"/>
  ${wedges}
  <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="${BG}"/>
  <circle cx="${cx}" cy="${cy}" r="${secR}" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="${secW}"/>
</svg>`;

// ---- Render & write ----
const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } });
const png = resvg.render().asPng();

const out = join(__dirname, '..', 'src-tauri', 'icons', 'app-icon-1024.png');
writeFileSync(out, png);
console.log(`Written: ${out}`);
console.log('Now run:  pnpm tauri icon src-tauri/icons/app-icon-1024.png');
