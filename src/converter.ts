import { ConversionMode } from "./cli";

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
    mode: ConversionMode,
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
