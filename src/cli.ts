export type ConversionMode = "binary" | "dither";

export interface CliOptions {
    help: boolean;
    input?: string;
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
                if (value !== "binary" && value !== "dither") {
                    throw new Error("--mode must be either binary or dither.");
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

    return options;
}

export function printHelp(): void {
    console.log(`CusionBadApple video-to-datapack generator

Usage:
  pnpm start -- [options]

Options:
  --input <file>       Video path (default: the only video in input/)
  --mode <mode>        binary or dither (default: binary)
  --threshold <0-255>  Black/white threshold (default: 128)
  --width <blocks>     Screen width (default: 128)
  --height <blocks>    Screen height (default: 96)
  --invert             Invert lit and unlit pixels
  --max-frames <count> Convert only the first N frames (useful for testing)
  --help               Show this help

The generated video always runs at 20 FPS: one frame per Minecraft tick.`);
}
