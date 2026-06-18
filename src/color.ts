// OKLCH <-> sRGB conversions, after Björn Ottosson's Oklab.
// Ranges: l 0..1, c 0..~0.4, h 0..360 (degrees).

export interface Oklch {
    l: number;
    c: number;
    h: number;
}

export interface LinearRgb {
    r: number;
    g: number;
    b: number;
}

// Channels may exceed [0, 1] when out of gamut.
export function oklchToLinearSrgb(l: number, c: number, h: number): LinearRgb {
    const hr = (h * Math.PI) / 180;
    const a = c * Math.cos(hr);
    const b = c * Math.sin(hr);

    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.291485548 * b;

    const L = l_ * l_ * l_;
    const M = m_ * m_ * m_;
    const S = s_ * s_ * s_;

    return {
        r: 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
        g: -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
        b: -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
    };
}

function clamp01(x: number): number {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

function encode255(x: number): number {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(clamp01(v) * 255);
}

export function oklchToSrgb255(l: number, c: number, h: number): [number, number, number] {
    const lin = oklchToLinearSrgb(l, c, h);
    return [encode255(lin.r), encode255(lin.g), encode255(lin.b)];
}

export function inGamut(l: number, c: number, h: number): boolean {
    const { r, g, b } = oklchToLinearSrgb(l, c, h);
    const eps = 1e-4;
    return (
        r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps
    );
}

function encode01(x: number): number {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return clamp01(v);
}

// HSL in 0..1 (hue normalized, not degrees); gamut-clamped to match the hex swatch.
export function oklchToHsl(
    l: number,
    c: number,
    h: number,
): { h: number; s: number; l: number } {
    const lin = oklchToLinearSrgb(l, c, h);
    const r = encode01(lin.r);
    const g = encode01(lin.g);
    const b = encode01(lin.b);

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const li = (max + min) / 2;
    const d = max - min;

    let s = 0;
    let hue = 0;
    if (d > 1e-9) {
        s = d / (1 - Math.abs(2 * li - 1));
        if (max === r) hue = (((g - b) / d) % 6 + 6) % 6;
        else if (max === g) hue = (b - r) / d + 2;
        else hue = (r - g) / d + 4;
        hue /= 6;
    }
    return { h: hue, s, l: li };
}

// HSL (all 0..1) to OKLCH; inverse of oklchToHsl.
export function hslToOklch(h: number, s: number, l: number): Oklch {
    // HSL → sRGB
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h * 6;
    const x = chroma * (1 - Math.abs(hp % 2 - 1));
    const m = l - chroma / 2;
    let r = 0, g = 0, b = 0;
    if (hp < 1)      { r = chroma; g = x; }
    else if (hp < 2) { r = x;      g = chroma; }
    else if (hp < 3) {             g = chroma; b = x; }
    else if (hp < 4) {             g = x;      b = chroma; }
    else if (hp < 5) { r = x;                  b = chroma; }
    else             { r = chroma;              b = x; }
    r += m; g += m; b += m;

    // sRGB → linear
    const lin = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    const lr = lin(r), lg = lin(g), lb = lin(b);

    // Linear sRGB → OKLab
    const l_ = Math.cbrt(0.4121656120 * lr + 0.5362752080 * lg + 0.0514575653 * lb);
    const m_ = Math.cbrt(0.2118591070 * lr + 0.6807189584 * lg + 0.1074065790 * lb);
    const s_ = Math.cbrt(0.0883097947 * lr + 0.2818474174 * lg + 0.6302613616 * lb);

    const L  =  0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const a  =  1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const bk =  0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

    const C = Math.sqrt(a * a + bk * bk);
    let H = Math.atan2(bk, a) * 180 / Math.PI;
    if (H < 0) H += 360;
    return { l: L, c: C, h: H };
}

export function oklchToHex(l: number, c: number, h: number): string {
    const [r, g, b] = oklchToSrgb255(l, c, h);
    return (
        "#" +
            [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()
    );
}
