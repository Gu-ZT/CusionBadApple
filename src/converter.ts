import {
    CushionColorConversionMode,
    GrayscaleConversionMode,
    RgbwConversionMode,
} from "./cli";
import { CALIBRATED_STATES } from "./calibration";

const RED_BIT = 1;
const GREEN_BIT = 2;
const BLUE_BIT = 4;
const WHITE_BIT = 8;
const NEUTRAL_CHANNEL_TOLERANCE = 12;

interface RgbwPaletteEntry {
    bits: number;
    red: number;
    green: number;
    blue: number;
}

const RGBW_PALETTE_BITS = [
    0,
    RED_BIT,
    GREEN_BIT,
    BLUE_BIT,
    RED_BIT | GREEN_BIT,
    RED_BIT | BLUE_BIT,
    GREEN_BIT | BLUE_BIT,
    WHITE_BIT,
];

const RGBW_PALETTE: RgbwPaletteEntry[] = RGBW_PALETTE_BITS.map((bits) => {
    const white = (bits & WHITE_BIT) !== 0;
    return {
        bits,
        red: white || (bits & RED_BIT) !== 0 ? 255 : 0,
        green: white || (bits & GREEN_BIT) !== 0 ? 255 : 0,
        blue: white || (bits & BLUE_BIT) !== 0 ? 255 : 0,
    };
});
const BLACK_ENTRY = RGBW_PALETTE[0];
const WHITE_ENTRY = RGBW_PALETTE[RGBW_PALETTE.length - 1];

function nearestRgbw(red: number, green: number, blue: number): RgbwPaletteEntry {
    const clampedRed = Math.max(0, Math.min(255, red));
    const clampedGreen = Math.max(0, Math.min(255, green));
    const clampedBlue = Math.max(0, Math.min(255, blue));
    let nearest = RGBW_PALETTE[0];
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const entry of RGBW_PALETTE) {
        const redError = clampedRed - entry.red;
        const greenError = clampedGreen - entry.green;
        const blueError = clampedBlue - entry.blue;
        const distance = redError * redError + greenError * greenError + blueError * blueError;
        if (distance < nearestDistance) {
            nearest = entry;
            nearestDistance = distance;
        }
    }

    return nearest;
}

function writeRgbwPixel(
    output: Uint8Array,
    logicalX: number,
    logicalY: number,
    logicalWidth: number,
    bits: number,
): void {
    const physicalWidth = logicalWidth * 2;
    const topLeft = logicalY * 2 * physicalWidth + logicalX * 2;
    output[topLeft] = (bits & RED_BIT) !== 0 ? 1 : 0;
    output[topLeft + 1] = (bits & GREEN_BIT) !== 0 ? 1 : 0;
    output[topLeft + physicalWidth] = (bits & BLUE_BIT) !== 0 ? 1 : 0;
    output[topLeft + physicalWidth + 1] = (bits & WHITE_BIT) !== 0 ? 1 : 0;
}

function binaryFrame(gray: Uint8Array, threshold: number, invert: boolean): Uint8Array {
    const output = new Uint8Array(gray.length);
    for (let index = 0; index < gray.length; index += 1) {
        const white = gray[index] >= threshold;
        output[index] = white !== invert ? 1 : 0;
    }
    return output;
}

function ditherFrame(
    gray: Uint8Array,
    width: number,
    height: number,
    threshold: number,
    invert: boolean,
): Uint8Array {
    const pixels = Float32Array.from(gray);
    const output = new Uint8Array(gray.length);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            const white = pixels[index] >= threshold;
            const quantized = white ? 255 : 0;
            const error = pixels[index] - quantized;
            output[index] = white !== invert ? 1 : 0;

            if (x + 1 < width) {
                pixels[index + 1] += error * 7 / 16;
            }
            if (y + 1 < height) {
                if (x > 0) {
                    pixels[index + width - 1] += error * 3 / 16;
                }
                pixels[index + width] += error * 5 / 16;
                if (x + 1 < width) {
                    pixels[index + width + 1] += error / 16;
                }
            }
        }
    }

    return output;
}

const BAYER_4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
] as const;

function orderedFrame(gray: Uint8Array, width: number, height: number, threshold: number, invert: boolean): Uint8Array {
    const output = new Uint8Array(gray.length);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            const thresholdOffset = (BAYER_4[y % 4][x % 4] - 7.5) * 16;
            const white = gray[index] >= threshold + thresholdOffset;
            output[index] = white !== invert ? 1 : 0;
        }
    }
    return output;
}

export function convertFrame(
    gray: Uint8Array,
    width: number,
    height: number,
    mode: GrayscaleConversionMode,
    threshold: number,
    invert: boolean,
): Uint8Array {
    if (gray.length !== width * height) {
        throw new Error(`Invalid grayscale frame size: expected ${width * height}, got ${gray.length}.`);
    }

    return mode === "dither"
        ? ditherFrame(gray, width, height, threshold, invert)
        : mode === "ordered"
            ? orderedFrame(gray, width, height, threshold, invert)
            : binaryFrame(gray, threshold, invert);
}

export function convertRgbwFrame(
    rgb: Uint8Array,
    logicalWidth: number,
    logicalHeight: number,
    mode: RgbwConversionMode,
    invert: boolean,
): Uint8Array {
    const expectedLength = logicalWidth * logicalHeight * 3;
    if (rgb.length !== expectedLength) {
        throw new Error(`Invalid RGB frame size: expected ${expectedLength}, got ${rgb.length}.`);
    }

    const output = new Uint8Array(logicalWidth * logicalHeight * 4);
    const pixels = Float32Array.from(rgb, (value) => invert ? 255 - value : value);

    for (let y = 0; y < logicalHeight; y += 1) {
        for (let x = 0; x < logicalWidth; x += 1) {
            const pixelIndex = (y * logicalWidth + x) * 3;
            const sourceRed = invert ? 255 - rgb[pixelIndex] : rgb[pixelIndex];
            const sourceGreen = invert ? 255 - rgb[pixelIndex + 1] : rgb[pixelIndex + 1];
            const sourceBlue = invert ? 255 - rgb[pixelIndex + 2] : rgb[pixelIndex + 2];
            const sourceMinimum = Math.min(sourceRed, sourceGreen, sourceBlue);
            const sourceMaximum = Math.max(sourceRed, sourceGreen, sourceBlue);
            const neutral = sourceMaximum - sourceMinimum <= NEUTRAL_CHANNEL_TOLERANCE;
            const workingLuminance = (
                pixels[pixelIndex] +
                pixels[pixelIndex + 1] +
                pixels[pixelIndex + 2]
            ) / 3;
            const entry = neutral
                ? (workingLuminance >= 255 / 2 ? WHITE_ENTRY : BLACK_ENTRY)
                : nearestRgbw(
                    pixels[pixelIndex],
                    pixels[pixelIndex + 1],
                    pixels[pixelIndex + 2],
                );
            writeRgbwPixel(output, x, y, logicalWidth, entry.bits);

            if (mode !== "rgbw-dither") {
                continue;
            }

            const neutralError = workingLuminance - entry.red;
            const errors = neutral
                ? [neutralError, neutralError, neutralError]
                : [
                    pixels[pixelIndex] - entry.red,
                    pixels[pixelIndex + 1] - entry.green,
                    pixels[pixelIndex + 2] - entry.blue,
                ];
            const diffuse = (targetX: number, targetY: number, weight: number): void => {
                if (
                    targetX < 0 ||
                    targetX >= logicalWidth ||
                    targetY < 0 ||
                    targetY >= logicalHeight
                ) {
                    return;
                }
                const targetIndex = (targetY * logicalWidth + targetX) * 3;
                for (let channel = 0; channel < 3; channel += 1) {
                    pixels[targetIndex + channel] += errors[channel] * weight;
                }
            };

            diffuse(x + 1, y, 7 / 16);
            diffuse(x - 1, y + 1, 3 / 16);
            diffuse(x, y + 1, 5 / 16);
            diffuse(x + 1, y + 1, 1 / 16);
        }
    }

    return output;
}

interface LabColor { l: number; a: number; b: number }

function rgbToLab(red: number, green: number, blue: number): LabColor {
    const linear = (value: number): number => {
        const normalized = Math.max(0, Math.min(255, value)) / 255;
        return normalized <= 0.04045
            ? normalized / 12.92
            : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };
    const r = linear(red);
    const g = linear(green);
    const b = linear(blue);
    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
    const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const f = (value: number): number => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
    const fx = f(x); const fy = f(y); const fz = f(z);
    return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function deltaE2000(first: LabColor, second: LabColor): number {
    const deg = Math.PI / 180;
    const c1 = Math.hypot(first.a, first.b);
    const c2 = Math.hypot(second.a, second.b);
    const meanC = (c1 + c2) / 2;
    const g = 0.5 * (1 - Math.sqrt(Math.pow(meanC, 7) / (Math.pow(meanC, 7) + Math.pow(25, 7))));
    const ap1 = (1 + g) * first.a;
    const ap2 = (1 + g) * second.a;
    const cp1 = Math.hypot(ap1, first.b);
    const cp2 = Math.hypot(ap2, second.b);
    const hp = (a: number, b: number): number => {
        if (a === 0 && b === 0) return 0;
        const angle = Math.atan2(b, a) / deg;
        return angle < 0 ? angle + 360 : angle;
    };
    const h1 = hp(ap1, first.b); const h2 = hp(ap2, second.b);
    const dL = second.l - first.l;
    const dC = cp2 - cp1;
    let dh = h2 - h1;
    if (cp1 * cp2 === 0) dh = 0;
    else if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
    const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin(dh * deg / 2);
    const meanL = (first.l + second.l) / 2;
    const meanCp = (cp1 + cp2) / 2;
    let meanHp = h1 + h2;
    if (cp1 * cp2 === 0) meanHp = h1 + h2;
    else if (Math.abs(h1 - h2) <= 180) meanHp = (h1 + h2) / 2;
    else meanHp = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
    const t = 1 - 0.17 * Math.cos((meanHp - 30) * deg) + 0.24 * Math.cos(2 * meanHp * deg) +
        0.32 * Math.cos((3 * meanHp + 6) * deg) - 0.20 * Math.cos((4 * meanHp - 63) * deg);
    const sl = 1 + 0.015 * Math.pow(meanL - 50, 2) / Math.sqrt(20 + Math.pow(meanL - 50, 2));
    const sc = 1 + 0.045 * meanCp;
    const sh = 1 + 0.015 * meanCp * t;
    const rt = -2 * Math.sqrt(Math.pow(meanCp, 7) / (Math.pow(meanCp, 7) + Math.pow(25, 7))) *
        Math.sin(60 * Math.exp(-Math.pow((meanHp - 275) / 25, 2)) * deg);
    return Math.sqrt(Math.pow(dL / sl, 2) + Math.pow(dC / sc, 2) + Math.pow(dH / sh, 2) + rt * (dC / sc) * (dH / sh));
}

const CALIBRATED_LAB = CALIBRATED_STATES.map((color) => rgbToLab(color.red, color.green, color.blue));
const EXACT_CALIBRATED_STATES = new Map<number, number>(
    CALIBRATED_STATES.map((color, state) => [
        color.red << 16 | color.green << 8 | color.blue,
        state,
    ]),
);

const CIEDE_LOOKUP = (() => {
    const lookup = new Uint8Array(32 * 32 * 32);
    for (let red = 0; red < 32; red += 1) {
        for (let green = 0; green < 32; green += 1) {
            for (let blue = 0; blue < 32; blue += 1) {
                const source = rgbToLab(red * 8 + 4, green * 8 + 4, blue * 8 + 4);
                let nearestState = 0;
                let nearestDistance = Number.POSITIVE_INFINITY;
                for (let state = 0; state < CALIBRATED_LAB.length; state += 1) {
                    const distance = deltaE2000(source, CALIBRATED_LAB[state]);
                    if (distance < nearestDistance) {
                        nearestState = state;
                        nearestDistance = distance;
                    }
                }
                lookup[(red * 32 + green) * 32 + blue] = nearestState;
            }
        }
    }
    return lookup;
})();

export function nearestCalibratedState(red: number, green: number, blue: number): number {
    const clampedRed = Math.max(0, Math.min(255, Math.round(red)));
    const clampedGreen = Math.max(0, Math.min(255, Math.round(green)));
    const clampedBlue = Math.max(0, Math.min(255, Math.round(blue)));
    const exact = EXACT_CALIBRATED_STATES.get(
        clampedRed << 16 | clampedGreen << 8 | clampedBlue,
    );
    if (exact !== undefined) return exact;
    const quantize = (value: number): number => Math.max(0, Math.min(255, value)) >> 3;
    return CIEDE_LOOKUP[(quantize(red) * 32 + quantize(green)) * 32 + quantize(blue)];
}

export const COLOR_DIRTY_DELTA_E = 10;

export function filterCushionColorChanges(
    target: Uint8Array,
    displayed: Uint8Array,
    threshold: number = COLOR_DIRTY_DELTA_E,
): Uint8Array {
    if (target.length !== displayed.length) {
        throw new Error(
            `Color state size mismatch: target=${target.length}, displayed=${displayed.length}.`,
        );
    }
    const output = displayed.slice();
    for (let index = 0; index < target.length; index += 1) {
        const targetState = target[index];
        const displayedState = displayed[index];
        const targetLab = CALIBRATED_LAB[targetState];
        const displayedLab = CALIBRATED_LAB[displayedState];
        if (!targetLab || !displayedLab) {
            throw new Error(
                `Invalid calibrated state at pixel ${index}: ` +
                    `target=${targetState}, displayed=${displayedState}.`,
            );
        }
        if (deltaE2000(targetLab, displayedLab) > threshold) {
            output[index] = targetState;
        }
    }
    return output;
}

export function convertCushionColorFrame(
    rgb: Uint8Array,
    width: number,
    height: number,
    mode: CushionColorConversionMode,
    invert: boolean,
): Uint8Array {
    const expectedLength = width * height * 3;
    if (rgb.length !== expectedLength) {
        throw new Error(`Invalid RGB frame size: expected ${expectedLength}, got ${rgb.length}.`);
    }

    const output = new Uint8Array(width * height);
    const pixels = Float32Array.from(rgb, (value) => invert ? 255 - value : value);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const outputIndex = y * width + x;
            const pixelIndex = outputIndex * 3;
            if (mode === "color-ordered") {
                const offset = (BAYER_4[y % 4][x % 4] - 7.5) * 10;
                pixels[pixelIndex] += offset;
                pixels[pixelIndex + 1] += offset;
                pixels[pixelIndex + 2] += offset;
            }
            const state = nearestCalibratedState(
                pixels[pixelIndex], pixels[pixelIndex + 1], pixels[pixelIndex + 2],
            );
            output[outputIndex] = state;

            if (mode !== "color-dither") {
                continue;
            }

            const calibrated = CALIBRATED_STATES[state];
            const errors = [
                pixels[pixelIndex] - calibrated.red,
                pixels[pixelIndex + 1] - calibrated.green,
                pixels[pixelIndex + 2] - calibrated.blue,
            ];
            const diffuse = (targetX: number, targetY: number, weight: number): void => {
                if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) {
                    return;
                }
                const targetIndex = (targetY * width + targetX) * 3;
                for (let channel = 0; channel < 3; channel += 1) {
                    pixels[targetIndex + channel] += errors[channel] * weight;
                }
            };

            if (mode === "color-dither") {
                diffuse(x + 1, y, 7 / 16);
                diffuse(x - 1, y + 1, 3 / 16);
                diffuse(x, y + 1, 5 / 16);
                diffuse(x + 1, y + 1, 1 / 16);
            }
        }
    }

    return output;
}
