import JSZip from "jszip";
import { BRIGHTNESS_TIERS } from "../src/brightness";
import { ConversionMode, isCushionColorMode, isRgbwMode } from "../src/cli";
import { CUSHION_COLOR_PALETTE } from "../src/colors";
import { COLOR_DIRTY_DELTA_E, convertCushionColorFrame, convertFrame, convertRgbwFrame, filterCushionColorChanges } from "../src/converter";
import { DatapackBuilder, DisplayMode } from "../src/datapack";
import { decodeVideoWasm } from "./ffmpeg";
import { getVirtualFiles, resetVirtualFiles, writeFile } from "./virtual-fs";

const PACK_META = `{"pack":{"description":"CusionBadApple Web","min_format":110,"max_format":110}}\n`;

export interface WebGenerateOptions {
    file: File;
    mode: ConversionMode;
    width: number;
    height: number;
    threshold: number;
    invert: boolean;
    start: number;
    end?: number;
    macroStorage: boolean;
    uuidEntities: boolean;
    onStage: (stage: string, progress: number) => void;
}

export async function generateDatapack(options: WebGenerateOptions): Promise<Blob> {
    const rgbw = isRgbwMode(options.mode);
    const cushionColor = isCushionColorMode(options.mode);
    const logicalWidth = rgbw ? options.width / 2 : options.width;
    const logicalHeight = rgbw ? options.height / 2 : options.height;
    const channels = rgbw || cushionColor ? 3 : 1;
    options.onStage("wasm", 0);
    const raw = await decodeVideoWasm({
        file: options.file,
        width: logicalWidth,
        height: logicalHeight,
        rgb: channels === 3,
        start: options.start,
        end: options.end,
        onLoad: () => options.onStage("decode", 0),
        onProgress: (progress) => options.onStage("decode", progress * 0.45),
    });
    const frameSize = logicalWidth * logicalHeight * channels;
    if (raw.length % frameSize !== 0) throw new Error(`Incomplete raw frame data: ${raw.length % frameSize} bytes.`);
    const frameCount = raw.length / frameSize;
    if (frameCount === 0) throw new Error("FFmpeg produced no frames.");

    resetVirtualFiles();
    await writeFile("output/pack.mcmeta", PACK_META);
    const displayMode: DisplayMode = cushionColor ? "cushion-color" : rgbw ? "rgbw" : "redstone";
    const builder = new DatapackBuilder("output", options.width, options.height, displayMode, options.macroStorage, options.uuidEntities);
    await builder.prepare();
    let previous: Uint8Array<ArrayBufferLike> = new Uint8Array(options.width * options.height);
    let commands = 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
        const decoded = raw.subarray(frame * frameSize, (frame + 1) * frameSize);
        const converted = cushionColor
            ? convertCushionColorFrame(decoded, logicalWidth, logicalHeight, options.mode as never, options.invert)
            : rgbw
                ? convertRgbwFrame(decoded, logicalWidth, logicalHeight, options.mode as never, options.invert)
                : convertFrame(decoded, options.width, options.height, options.mode as never, options.threshold, options.invert);
        const current = cushionColor ? filterCushionColorChanges(converted, previous) : converted;
        commands += await builder.writeFrame(frame, current, previous);
        previous = current;
        options.onStage("generate", 0.45 + (frame + 1) / frameCount * 0.45);
    }
    await builder.finish(frameCount, {
        input: options.file.name,
        fps: 20,
        mode: options.mode,
        threshold: options.threshold,
        inverted: options.invert,
        logicalWidth,
        logicalHeight,
        subpixelLayout: rgbw ? "R G / B W" : undefined,
        palette: cushionColor ? CUSHION_COLOR_PALETTE.map((color) => color.name) : undefined,
        brightnessLevels: cushionColor ? BRIGHTNESS_TIERS.map((tier) => tier.level) : undefined,
        clipStartSeconds: options.start,
        clipEndSeconds: options.end,
        macroStorage: options.macroStorage,
        uuidEntities: options.uuidEntities,
        colorMetric: cushionColor ? "CIEDE2000" : undefined,
        calibration: cushionColor ? "palette screenshot, 192 median-sampled states" : undefined,
        dirtyDeltaE: cushionColor ? COLOR_DIRTY_DELTA_E : undefined,
        commands,
    });
    options.onStage("zip", 0.92);
    const zip = new JSZip();
    for (const [name, value] of getVirtualFiles("output")) zip.file(name, value);
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } }, ({ percent }) => options.onStage("zip", 0.92 + percent / 100 * 0.08));
    options.onStage("done", 1);
    return blob;
}
