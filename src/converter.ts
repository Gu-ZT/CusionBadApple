import {
    CushionColorConversionMode,
    GrayscaleConversionMode,
    RgbwConversionMode,
} from "./cli";
import { BRIGHTNESS_TIERS, nearestBrightnessTier } from "./brightness";
import { CUSHION_COLOR_PALETTE } from "./colors";

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

function nearestCushionColor(red: number, green: number, blue: number): number {
    const clampedRed = Math.max(0, Math.min(255, red));
    const clampedGreen = Math.max(0, Math.min(255, green));
    const clampedBlue = Math.max(0, Math.min(255, blue));
    const maximum = Math.max(clampedRed, clampedGreen, clampedBlue);
    if (maximum === 0) {
        return 0;
    }
    const normalizedRed = clampedRed / maximum * 255;
    const normalizedGreen = clampedGreen / maximum * 255;
    const normalizedBlue = clampedBlue / maximum * 255;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = 1; index < CUSHION_COLOR_PALETTE.length; index += 1) {
        const color = CUSHION_COLOR_PALETTE[index];
        const colorMaximum = Math.max(color.red, color.green, color.blue);
        const redError = normalizedRed - color.red / colorMaximum * 255;
        const greenError = normalizedGreen - color.green / colorMaximum * 255;
        const blueError = normalizedBlue - color.blue / colorMaximum * 255;
        const distance = redError * redError + greenError * greenError + blueError * blueError;
        if (distance < nearestDistance) {
            nearestIndex = index;
            nearestDistance = distance;
        }
    }

    return nearestIndex;
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
            const colorIndex = nearestCushionColor(
                pixels[pixelIndex],
                pixels[pixelIndex + 1],
                pixels[pixelIndex + 2],
            );
            const maximumChannel = Math.max(
                pixels[pixelIndex],
                pixels[pixelIndex + 1],
                pixels[pixelIndex + 2],
            );
            const brightnessIndex = nearestBrightnessTier(maximumChannel);
            const displayedColorIndex = brightnessIndex === 0 ? 0 : colorIndex;
            output[outputIndex] =
                brightnessIndex * CUSHION_COLOR_PALETTE.length + displayedColorIndex;

            if (mode !== "color-dither") {
                continue;
            }

            const color = CUSHION_COLOR_PALETTE[displayedColorIndex];
            const lightLevel = BRIGHTNESS_TIERS[brightnessIndex].level;
            const colorMaximum = Math.max(color.red, color.green, color.blue) || 1;
            const brightnessScale = lightLevel / 15;
            const errors = [
                pixels[pixelIndex] - color.red / colorMaximum * 255 * brightnessScale,
                pixels[pixelIndex + 1] - color.green / colorMaximum * 255 * brightnessScale,
                pixels[pixelIndex + 2] - color.blue / colorMaximum * 255 * brightnessScale,
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

            diffuse(x + 1, y, 7 / 16);
            diffuse(x - 1, y + 1, 3 / 16);
            diffuse(x, y + 1, 5 / 16);
            diffuse(x + 1, y + 1, 1 / 16);
        }
    }

    return output;
}
