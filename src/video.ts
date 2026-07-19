import { readFile, readdir, stat } from "node:fs/promises";
import * as path from "node:path";

const VIDEO_EXTENSIONS = new Set([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm"]);

interface WasmCore {
    FS: {
        writeFile(name: string, value: Uint8Array): void;
        readFile(name: string): Uint8Array;
        unlink(name: string): void;
    };
    exec(...args: string[]): number;
}

type CreateWasmCore = (options: { wasmBinary: Uint8Array }) => Promise<WasmCore>;

export interface DecodeOptions {
    inputPath: string;
    width: number;
    height: number;
    pixelFormat?: "gray" | "rgb24";
    startSeconds?: number;
    endSeconds?: number;
    maxFrames?: number;
}

export async function findInputVideo(inputDirectory: string): Promise<string> {
    let entries: string[];
    try {
        entries = await readdir(inputDirectory);
    } catch {
        throw new Error(`Input directory does not exist: ${inputDirectory}`);
    }
    const videos = entries
        .filter((entry) => VIDEO_EXTENSIONS.has(path.extname(entry).toLowerCase()))
        .sort((left, right) => left.localeCompare(right));
    if (videos.length === 0) throw new Error(`No supported video was found in ${inputDirectory}.`);
    if (videos.length > 1) throw new Error("More than one video exists in input/. Select one with --input <file>.");
    return path.join(inputDirectory, videos[0]);
}

async function loadWasmCore(): Promise<WasmCore> {
    const corePath = require.resolve("@ffmpeg/core");
    const wasmPath = path.join(path.dirname(corePath), "ffmpeg-core.wasm");
    const wasmBinary = Uint8Array.from(await readFile(wasmPath));
    const globalScope = globalThis as unknown as {
        self: typeof globalThis;
        location: { href: string };
    };
    globalScope.self = globalThis;
    globalScope.location = { href: `file:///${corePath.replace(/\\/g, "/")}` };
    const createCore = require("@ffmpeg/core") as CreateWasmCore;
    return createCore({ wasmBinary });
}

export async function* decodeVideo(options: DecodeOptions): AsyncGenerator<Uint8Array> {
    try {
        const inputStats = await stat(options.inputPath);
        if (!inputStats.isFile()) throw new Error("not a file");
    } catch {
        throw new Error(`Input video does not exist: ${options.inputPath}`);
    }

    const core = await loadWasmCore();
    const inputName = `input${path.extname(options.inputPath).toLowerCase() || ".mp4"}`;
    const outputName = "frames.raw";
    core.FS.writeFile(inputName, Uint8Array.from(await readFile(options.inputPath)));
    const pixelFormat = options.pixelFormat ?? "gray";
    const filter = [
        "fps=20",
        `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease:flags=lanczos`,
        `pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
        `format=${pixelFormat}`,
    ].join(",");
    const args = ["-hide_banner", "-loglevel", "error"];
    if ((options.startSeconds ?? 0) > 0) args.push("-ss", String(options.startSeconds));
    args.push("-i", inputName);
    if (options.endSeconds !== undefined) args.push("-t", String(options.endSeconds - (options.startSeconds ?? 0)));
    args.push("-map", "0:v:0", "-an", "-vf", filter);
    if (options.maxFrames !== undefined) args.push("-frames:v", String(options.maxFrames));
    args.push("-f", "rawvideo", "-pix_fmt", pixelFormat, outputName);
    const exitCode = core.exec(...args);
    if (exitCode !== 0) throw new Error(`FFmpeg WASM exited with code ${exitCode}.`);

    const raw = core.FS.readFile(outputName);
    const channels = pixelFormat === "rgb24" ? 3 : 1;
    const frameSize = options.width * options.height * channels;
    if (raw.length % frameSize !== 0) {
        throw new Error(`FFmpeg WASM returned an incomplete frame (${raw.length % frameSize}/${frameSize} bytes).`);
    }
    for (let offset = 0; offset < raw.length; offset += frameSize) {
        yield raw.slice(offset, offset + frameSize);
    }
    core.FS.unlink(inputName);
    core.FS.unlink(outputName);
}
