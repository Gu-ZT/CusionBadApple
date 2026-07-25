/// <reference lib="webworker" />

import { BRIGHTNESS_TIERS } from "../src/brightness";
import { CALIBRATED_STATES } from "../src/calibration";
import {
    ConversionMode,
    isCushionColorMode,
    isRgb3Mode,
    isRgbwMode,
    screenScaleForMode,
} from "../src/cli";
import { CUSHION_COLOR_PALETTE } from "../src/colors";
import {
    convertCushionColorFrame,
    convertFrame,
    convertRgb3Frame,
    convertRgbwFrame,
} from "../src/converter";
import { RGB3_LAMP_LEVELS, RGB3_LAYOUT } from "../src/rgb3";

interface PreviewRequest {
    rgba: Uint8ClampedArray<ArrayBuffer>;
    width: number;
    height: number;
    mode: ConversionMode;
    threshold: number;
    orderedDitherAmplitude: number;
    invert: boolean;
}

interface PreviewResponse {
    rgba?: Uint8ClampedArray<ArrayBuffer>;
    width?: number;
    height?: number;
    error?: string;
}

const OFF_COLOR = [8, 9, 10] as const;
const RGBW_COLORS = {
    red: [255, 59, 48],
    green: [52, 199, 89],
    blue: [61, 126, 255],
    white: [255, 255, 255],
} as const;
const RGB3_COLORS = RGB3_LAYOUT.map((cell) => {
    const brightness = BRIGHTNESS_TIERS.findIndex(
        (tier) => tier.level === RGB3_LAMP_LEVELS[cell.lamp],
    );
    const color = CUSHION_COLOR_PALETTE.findIndex((entry) => entry.name === cell.color);
    const calibrated = CALIBRATED_STATES[brightness * CUSHION_COLOR_PALETTE.length + color];
    if (!calibrated) throw new Error(`Missing calibrated RGB 3x3 preview color for ${cell.color}${cell.lamp}.`);
    return [calibrated.red, calibrated.green, calibrated.blue] as const;
});

function toRgb(rgba: Uint8ClampedArray<ArrayBuffer>, pixelCount: number): Uint8Array {
    if (rgba.length !== pixelCount * 4) {
        throw new Error(`Invalid preview frame size: expected ${pixelCount * 4}, got ${rgba.length}.`);
    }
    const rgb = new Uint8Array(pixelCount * 3);
    for (let index = 0; index < pixelCount; index += 1) {
        rgb[index * 3] = rgba[index * 4];
        rgb[index * 3 + 1] = rgba[index * 4 + 1];
        rgb[index * 3 + 2] = rgba[index * 4 + 2];
    }
    return rgb;
}

function rgbwColor(index: number, width: number): readonly [number, number, number] {
    const x = index % width;
    const y = Math.floor(index / width);
    if (y % 2 === 0) return x % 2 === 0 ? RGBW_COLORS.red : RGBW_COLORS.green;
    return x % 2 === 0 ? RGBW_COLORS.blue : RGBW_COLORS.white;
}

function rgb3Color(index: number, width: number): readonly [number, number, number] {
    const x = index % width;
    const y = Math.floor(index / width);
    return RGB3_COLORS[y % 3 * 3 + x % 3];
}

function renderPreview(request: PreviewRequest): Required<Omit<PreviewResponse, "error">> {
    const pixelCount = request.width * request.height;
    const rgb = toRgb(request.rgba, pixelCount);
    const rgbwMode = isRgbwMode(request.mode) ? request.mode : undefined;
    const rgb3Mode = isRgb3Mode(request.mode) ? request.mode : undefined;
    const cushionColorMode = isCushionColorMode(request.mode) ? request.mode : undefined;
    const converted = cushionColorMode
        ? convertCushionColorFrame(
            rgb,
            request.width,
            request.height,
            cushionColorMode,
            request.invert,
            request.orderedDitherAmplitude,
        )
        : rgbwMode
            ? convertRgbwFrame(rgb, request.width, request.height, rgbwMode, request.invert)
            : rgb3Mode
                ? convertRgb3Frame(rgb, request.width, request.height, rgb3Mode, request.invert)
                : convertFrame(
                    Uint8Array.from({ length: pixelCount }, (_, index) =>
                        Math.round(
                            rgb[index * 3] * 0.299 +
                            rgb[index * 3 + 1] * 0.587 +
                            rgb[index * 3 + 2] * 0.114,
                        )),
                    request.width,
                    request.height,
                    request.mode as never,
                    request.threshold,
                    request.invert,
                );
    const scale = screenScaleForMode(request.mode);
    const width = request.width * scale;
    const height = request.height * scale;
    if (converted.length !== width * height) {
        throw new Error(`Invalid converted preview size: expected ${width * height}, got ${converted.length}.`);
    }

    const output = new Uint8ClampedArray(converted.length * 4);
    for (let index = 0; index < converted.length; index += 1) {
        let color: readonly [number, number, number];
        if (cushionColorMode) {
            const calibrated = CALIBRATED_STATES[converted[index]];
            if (!calibrated) throw new Error(`Missing calibrated preview color state ${converted[index]}.`);
            color = [calibrated.red, calibrated.green, calibrated.blue];
        } else if (!converted[index]) {
            color = OFF_COLOR;
        } else if (rgbwMode) {
            color = rgbwColor(index, width);
        } else if (rgb3Mode) {
            color = rgb3Color(index, width);
        } else {
            color = RGBW_COLORS.white;
        }
        output[index * 4] = color[0];
        output[index * 4 + 1] = color[1];
        output[index * 4 + 2] = color[2];
        output[index * 4 + 3] = 255;
    }
    return { rgba: output, width, height };
}

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.addEventListener("message", (event: MessageEvent<PreviewRequest>) => {
    try {
        const response = renderPreview(event.data);
        worker.postMessage(response, [response.rgba.buffer]);
    } catch (reason) {
        const response: PreviewResponse = {
            error: reason instanceof Error ? reason.message : String(reason),
        };
        worker.postMessage(response);
    }
});

export {};
