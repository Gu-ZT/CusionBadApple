export type GrayscaleConversionMode = "binary" | "dither";
export type RgbwConversionMode = "rgbw-nearest" | "rgbw-dither";
export type CushionColorConversionMode = "color-nearest" | "color-dither";
export type ConversionMode =
    | GrayscaleConversionMode
    | RgbwConversionMode
    | CushionColorConversionMode;

export function isRgbwMode(mode: ConversionMode): mode is RgbwConversionMode {
    return mode === "rgbw-nearest" || mode === "rgbw-dither";
}

export function isCushionColorMode(mode: ConversionMode): mode is CushionColorConversionMode {
    return mode === "color-nearest" || mode === "color-dither";
}

export interface CliOptions {
    help: boolean;
    input?: string;
    output: string;
    startSeconds: number;
    endSeconds?: number;
    width: number;
    height: number;
    mode: ConversionMode;
    threshold: number;
    invert: boolean;
    maxFrames?: number;
}

function integer(value: string, option: string, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${option} must be an integer between ${min} and ${max}.`);
    }
    return parsed;
}

function decimal(value: string, option: string, min: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min) {
        throw new Error(`${option} must be a number greater than or equal to ${min}.`);
    }
    return parsed;
}

function readValue(args: string[], index: number, inlineValue: string | undefined, option: string): [string, number] {
    if (inlineValue !== undefined && inlineValue !== "") {
        return [inlineValue, index];
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
        throw new Error(`${option} requires a value.`);
    }
    return [value, index + 1];
}

export function parseCli(args: string[]): CliOptions {
    const options: CliOptions = {
        help: false,
        output: "datapack",
        startSeconds: 0,
        width: 128,
        height: 96,
        mode: "binary",
        threshold: 128,
        invert: false,
    };

    for (let index = 0; index < args.length; index += 1) {
        const [name, inlineValue] = args[index].split("=", 2);

        switch (name) {
            case "--help":
            case "-h":
                options.help = true;
                break;
            case "--invert":
                options.invert = true;
                break;
            case "--input": {
                const [value, nextIndex] = readValue(args, index, inlineValue, name);
                options.input = value;
                index = nextIndex;
                break;
            }
            case "--output": {
                const [value, nextIndex] = readValue(args, index, inlineValue, name);
                options.output = value;
                index = nextIndex;
                break;
            }
            case "--start": {
                const [value, nextIndex] = readValue(args, index, inlineValue, name);
                options.startSeconds = decimal(value, name, 0);
                index = nextIndex;
                break;
            }
            case "--end": {
                const [value, nextIndex] = readValue(args, index, inlineValue, name);
                options.endSeconds = decimal(value, name, 0);
                index = nextIndex;
                break;
            }
            case "--width": {
                const [value, nextIndex] = readValue(args, index, inlineValue, name);
                options.width = integer(value, name, 1, 32768);
                index = nextIndex;
                break;
            }
            case "--height": {
                const [value, nextIndex] = readValue(args, index, inlineValue, name);
                options.height = integer(value, name, 1, 32768);
                index = nextIndex;
                break;
            }
            case "--threshold": {
                const [value, nextIndex] = readValue(args, index, inlineValue, name);
                options.threshold = integer(value, name, 0, 255);
                index = nextIndex;
                break;
            }
            case "--max-frames": {
                const [value, nextIndex] = readValue(args, index, inlineValue, name);
                options.maxFrames = integer(value, name, 1, Number.MAX_SAFE_INTEGER);
                index = nextIndex;
                break;
            }
            case "--mode": {
                const [value, nextIndex] = readValue(args, index, inlineValue, name);
                if (
                    value !== "binary" &&
                    value !== "dither" &&
                    value !== "rgbw-nearest" &&
                    value !== "rgbw-dither" &&
                    value !== "color-nearest" &&
                    value !== "color-dither"
                ) {
                    throw new Error(
                        "--mode must be binary, dither, rgbw-nearest, rgbw-dither, " +
                        "color-nearest, or color-dither.",
                    );
                }
                options.mode = value;
                index = nextIndex;
                break;
            }
            default:
                throw new Error(`Unknown option: ${name}. Use --help for usage.`);
        }
    }

    if (options.width * options.height > 32768) {
        throw new Error("The screen may contain at most 32768 blocks (Minecraft fill limit).");
    }
    if (isRgbwMode(options.mode) && (options.width % 2 !== 0 || options.height % 2 !== 0)) {
        throw new Error("RGBW modes require an even screen width and height.");
    }
    if (options.endSeconds !== undefined && options.endSeconds <= options.startSeconds) {
        throw new Error("--end must be greater than --start.");
    }

    return options;
}

export function printHelp(): void {
    console.log(`CusionBadApple video-to-datapack generator

Usage:
  pnpm start -- [options]

Options:
  --input <file>       Video path (default: the only video in input/)
  --output <directory> Datapack output directory (default: datapack/)
  --start <seconds>    Start time, inclusive (default: 0)
  --end <seconds>      End time, exclusive (default: end of video)
  --mode <mode>        binary, dither, rgbw-nearest, rgbw-dither,
                       color-nearest, or color-dither
                       (default: binary)
  --threshold <0-255>  Black/white threshold; grayscale modes only (default: 128)
  --width <blocks>     Screen width (default: 128)
  --height <blocks>    Screen height (default: 96)
  --invert             Invert lit and unlit pixels
  --max-frames <count> Convert only the first N frames (useful for testing)
  --help               Show this help

RGBW modes use a 2x2 R/G/B/W cushion layout for every logical video pixel.
Color modes use one cushion per pixel and the full 16-color dye palette.
The generated video always runs at 20 FPS: one frame per Minecraft tick.`);
}
