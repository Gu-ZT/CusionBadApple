import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import ffmpegPath from "ffmpeg-static";

const VIDEO_EXTENSIONS = new Set([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm"]);

export interface DecodeOptions {
    inputPath: string;
    width: number;
    height: number;
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

    if (videos.length === 0) {
        throw new Error(`No supported video was found in ${inputDirectory}.`);
    }
    if (videos.length > 1) {
        throw new Error("More than one video exists in input/. Select one with --input <file>.");
    }
    return path.join(inputDirectory, videos[0]);
}

export async function* decodeVideo(options: DecodeOptions): AsyncGenerator<Uint8Array> {
    if (!ffmpegPath || !existsSync(ffmpegPath)) {
        throw new Error("FFmpeg is not installed. Run `pnpm install` and allow the ffmpeg-static build script.");
    }

    try {
        const inputStats = await stat(options.inputPath);
        if (!inputStats.isFile()) {
            throw new Error("not a file");
        }
    } catch {
        throw new Error(`Input video does not exist: ${options.inputPath}`);
    }

    const frameSize = options.width * options.height;
    const filter = [
        "fps=20",
        `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease:flags=lanczos`,
        `pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
        "format=gray",
    ].join(",");
    const args = [
        "-hide_banner",
        "-loglevel", "error",
        "-i", options.inputPath,
        "-map", "0:v:0",
        "-an",
        "-vf", filter,
    ];
    if (options.maxFrames !== undefined) {
        args.push("-frames:v", String(options.maxFrames));
    }
    args.push("-f", "rawvideo", "-pix_fmt", "gray", "pipe:1");

    const ffmpeg = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    ffmpeg.stderr.setEncoding("utf8");
    ffmpeg.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-8192);
    });

    const completion = new Promise<number | null>((resolve, reject) => {
        ffmpeg.once("error", reject);
        ffmpeg.once("close", resolve);
    });
    let pending = Buffer.alloc(0);

    try {
        for await (const chunk of ffmpeg.stdout) {
            pending = Buffer.concat([pending, chunk as Buffer]);
            while (pending.length >= frameSize) {
                yield Uint8Array.from(pending.subarray(0, frameSize));
                pending = pending.subarray(frameSize);
            }
        }

        const exitCode = await completion;
        if (exitCode !== 0) {
            throw new Error(`FFmpeg exited with code ${exitCode}: ${stderr.trim() || "unknown error"}`);
        }
        if (pending.length !== 0) {
            throw new Error(`FFmpeg returned an incomplete frame (${pending.length}/${frameSize} bytes).`);
        }
    } finally {
        if (ffmpeg.exitCode === null && ffmpeg.signalCode === null) {
            ffmpeg.kill();
        }
    }
}
