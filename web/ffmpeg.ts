import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

let instance: FFmpeg | undefined;

export interface BrowserDecodeOptions {
    file: File;
    width: number;
    height: number;
    rgb: boolean;
    start: number;
    end?: number;
    onLoad?: () => void;
    onProgress?: (ratio: number) => void;
}

async function ffmpegInstance(onLoad?: () => void, onProgress?: (ratio: number) => void): Promise<FFmpeg> {
    if (!instance) {
        instance = new FFmpeg();
        instance.on("progress", ({ progress }) => onProgress?.(Math.max(0, Math.min(1, progress))));
        await instance.load({ coreURL, wasmURL });
    }
    onLoad?.();
    return instance;
}

export async function decodeVideoWasm(options: BrowserDecodeOptions): Promise<Uint8Array> {
    const ffmpeg = await ffmpegInstance(options.onLoad, options.onProgress);
    const extension = options.file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "mp4";
    const input = `input.${extension}`;
    const output = "frames.raw";
    await ffmpeg.writeFile(input, await fetchFile(options.file));
    const filter = [
        "fps=20",
        `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease:flags=lanczos`,
        `pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
        `format=${options.rgb ? "rgb24" : "gray"}`,
    ].join(",");
    const args = ["-hide_banner", "-loglevel", "error"];
    if (options.start > 0) args.push("-ss", String(options.start));
    args.push("-i", input);
    if (options.end !== undefined) args.push("-t", String(options.end - options.start));
    args.push("-map", "0:v:0", "-an", "-vf", filter, "-f", "rawvideo", "-pix_fmt", options.rgb ? "rgb24" : "gray", output);
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`FFmpeg exited with code ${code}.`);
    const data = await ffmpeg.readFile(output);
    await ffmpeg.deleteFile(input);
    await ffmpeg.deleteFile(output);
    return typeof data === "string" ? new TextEncoder().encode(data) : data;
}
