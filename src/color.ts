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

export function oklchToHex(l: number, c: number, h: number): string {
    const [r, g, b] = oklchToSrgb255(l, c, h);
    return (
        "#" +
            [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()
    );
}
