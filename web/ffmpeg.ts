import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

let instance: FFmpeg | undefined;
let loadPromise: Promise<FFmpeg> | undefined;
const loadProgressListeners = new Set<(ratio: number) => void>();
let loadProgress = 0;

function reportLoadProgress(ratio: number): void {
    loadProgress = Math.max(loadProgress, Math.min(1, ratio));
    for (const listener of loadProgressListeners) listener(loadProgress);
}

async function fetchWithProgress(url: string, base: number, weight: number): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load FFmpeg asset (${response.status}).`);
    const total = Number(response.headers.get("content-length")) || 0;
    if (!response.body) {
        const blob = await response.blob();
        reportLoadProgress(base + weight);
        return URL.createObjectURL(blob);
    }

    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let received = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(new Uint8Array(value).buffer);
        received += value.byteLength;
        if (total > 0) reportLoadProgress(base + received / total * weight);
    }
    reportLoadProgress(base + weight);
    return URL.createObjectURL(new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" }));
}

export function preloadFFmpeg(onProgress?: (ratio: number) => void): Promise<FFmpeg> {
    onProgress?.(loadProgress);
    if (instance?.loaded) return Promise.resolve(instance);
    if (onProgress) loadProgressListeners.add(onProgress);
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        instance = new FFmpeg();
        const [loadedCoreURL, loadedWasmURL] = await Promise.all([
            fetchWithProgress(coreURL, 0, 0.05),
            fetchWithProgress(wasmURL, 0.05, 0.9),
        ]);
        try {
            await instance.load({ coreURL: loadedCoreURL, wasmURL: loadedWasmURL });
            reportLoadProgress(1);
            loadProgressListeners.clear();
            return instance;
        } finally {
            URL.revokeObjectURL(loadedCoreURL);
            URL.revokeObjectURL(loadedWasmURL);
        }
    })().catch((reason) => {
        instance = undefined;
        loadPromise = undefined;
        loadProgress = 0;
        loadProgressListeners.clear();
        throw reason;
    });
    return loadPromise;
}

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

async function ffmpegInstance(onLoad?: () => void): Promise<FFmpeg> {
    const loadedInstance = await preloadFFmpeg();
    onLoad?.();
    return loadedInstance;
}

export async function decodeVideoWasm(options: BrowserDecodeOptions): Promise<Uint8Array> {
    const ffmpeg = await ffmpegInstance(options.onLoad);
    const progressHandler = ({ progress }: { progress: number }) => options.onProgress?.(Math.max(0, Math.min(1, progress)));
    ffmpeg.on("progress", progressHandler);
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
    try {
        const code = await ffmpeg.exec(args);
        if (code !== 0) throw new Error(`FFmpeg exited with code ${code}.`);
        const data = await ffmpeg.readFile(output);
        return typeof data === "string" ? new TextEncoder().encode(data) : data;
    } finally {
        ffmpeg.off("progress", progressHandler);
        await ffmpeg.deleteFile(input).catch(() => undefined);
        await ffmpeg.deleteFile(output).catch(() => undefined);
    }
}
