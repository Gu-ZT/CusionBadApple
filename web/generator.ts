import JSZip from "jszip";
import { BRIGHTNESS_TIERS } from "../src/brightness";
import { ConversionMode, isCushionColorMode, isRgbwMode } from "../src/cli";
import { CUSHION_COLOR_PALETTE } from "../src/colors";
import { COLOR_DIRTY_DELTA_E, convertCushionColorFrame, convertFrame, convertRgbwFrame, filterCushionColorChanges } from "../src/converter";
import { DatapackBuilder, DisplayMode } from "../src/datapack";
import { decodeVideoWasm } from "./ffmpeg";
import { getVirtualFiles, resetVirtualFiles, writeFile } from "./virtual-fs";

const PACK_META = `{"pack":{"description":"CusionBadApple Web","min_format":110,"max_format":110}}\n`;
const IMAGE_TAG = "gugle_badapple_image";

export function isImageFile(file: File): boolean {
    return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name);
}

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
    compactUuidMacro: boolean;
    onStage: (stage: string, progress: number) => void;
}

function relativeCoordinate(value: number): string {
    return value === 0 ? "~" : `~${value}`;
}

function rgbwColor(x: number, z: number): "red" | "green" | "blue" | "white" {
    if (z % 2 === 0) return x % 2 === 0 ? "red" : "green";
    return x % 2 === 0 ? "blue" : "white";
}

async function decodeImage(file: File, width: number, height: number): Promise<Uint8Array> {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser does not provide a 2D canvas context.");
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const scale = Math.min(width / bitmap.width, height / bitmap.height);
    const drawWidth = Math.max(1, Math.round(bitmap.width * scale));
    const drawHeight = Math.max(1, Math.round(bitmap.height * scale));
    context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    bitmap.close();
    const rgba = context.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let index = 0; index < width * height; index += 1) {
        rgb[index * 3] = rgba[index * 4];
        rgb[index * 3 + 1] = rgba[index * 4 + 1];
        rgb[index * 3 + 2] = rgba[index * 4 + 2];
    }
    return rgb;
}

function appendRuns(
    commands: string[],
    values: Uint8Array,
    width: number,
    height: number,
    y: number,
    blockFor: (value: number) => string | undefined,
): void {
    for (let z = 0; z < height; z += 1) {
        let x = 0;
        while (x < width) {
            const value = values[z * width + x];
            const block = blockFor(value);
            let end = x + 1;
            while (end < width && values[z * width + end] === value) end += 1;
            if (block) {
                const startX = relativeCoordinate(x);
                const endX = relativeCoordinate(end - 1);
                commands.push(end - x === 1
                    ? `setblock ${startX} ~${y} ${relativeCoordinate(z)} ${block}`
                    : `fill ${startX} ~${y} ${relativeCoordinate(z)} ${endX} ~${y} ${relativeCoordinate(z)} ${block}`);
            }
            x = end;
        }
    }
}

async function generateImageDatapack(options: WebGenerateOptions): Promise<Blob> {
    const rgbw = isRgbwMode(options.mode);
    const cushionColor = isCushionColorMode(options.mode);
    const logicalWidth = rgbw ? options.width / 2 : options.width;
    const logicalHeight = rgbw ? options.height / 2 : options.height;
    options.onStage("image", 0.05);
    const rgb = await decodeImage(options.file, logicalWidth, logicalHeight);
    const converted = cushionColor
        ? convertCushionColorFrame(rgb, logicalWidth, logicalHeight, options.mode as never, options.invert)
        : rgbw
            ? convertRgbwFrame(rgb, logicalWidth, logicalHeight, options.mode as never, options.invert)
            : convertFrame(
                Uint8Array.from({ length: logicalWidth * logicalHeight }, (_, index) =>
                    Math.round(rgb[index * 3] * 0.299 + rgb[index * 3 + 1] * 0.587 + rgb[index * 3 + 2] * 0.114)),
                options.width,
                options.height,
                options.mode as never,
                options.threshold,
                options.invert,
            );

    options.onStage("generate", 0.35);
    const commands = [
        "gamerule max_command_sequence_length 131072",
        `kill @e[type=minecraft:cushion,tag=${IMAGE_TAG}]`,
        `fill ~ ~1 ~ ${relativeCoordinate(options.width - 1)} ~1 ${relativeCoordinate(options.height - 1)} minecraft:air`,
        `fill ~ ~2 ~ ${relativeCoordinate(options.width - 1)} ~2 ${relativeCoordinate(options.height - 1)} ` +
            (cushionColor ? BRIGHTNESS_TIERS[0].block : "minecraft:air"),
    ];

    if (cushionColor) {
        for (let z = 0; z < options.height; z += 1) {
            for (let x = 0; x < options.width; x += 1) {
                const state = converted[z * options.width + x];
                const color = CUSHION_COLOR_PALETTE[state % CUSHION_COLOR_PALETTE.length];
                if (!color) throw new Error(`Invalid image color state at ${x},${z}.`);
                commands.push(
                    `summon minecraft:cushion ${relativeCoordinate(x)} ~2.26 ${relativeCoordinate(z)} ` +
                    `{Tags:["${IMAGE_TAG}"],color:"${color.name}"}`,
                );
            }
        }
        appendRuns(
            commands,
            converted,
            options.width,
            options.height,
            2,
            (state) => {
                const tier = BRIGHTNESS_TIERS[Math.floor(state / CUSHION_COLOR_PALETTE.length)];
                return tier && tier.level > 0 ? tier.block : undefined;
            },
        );
    } else if (rgbw) {
        for (let z = 0; z < options.height; z += 1) {
            for (let x = 0; x < options.width; x += 1) {
                commands.push(
                    `summon minecraft:cushion ${relativeCoordinate(x)} ~2.26 ${relativeCoordinate(z)} ` +
                    `{Tags:["${IMAGE_TAG}"],color:"${rgbwColor(x, z)}"}`,
                );
            }
        }
        appendRuns(commands, converted, options.width, options.height, 1, (state) =>
            state ? "minecraft:redstone_block" : undefined);
    } else {
        appendRuns(commands, converted, options.width, options.height, 1, (state) =>
            state ? "minecraft:redstone_block" : undefined);
    }

    resetVirtualFiles();
    await writeFile("output/pack.mcmeta", PACK_META);
    await writeFile("output/data/gugle/function/image.mcfunction", `${commands.join("\n")}\n`);
    options.onStage("zip", 0.92);
    const zip = new JSZip();
    for (const [name, value] of getVirtualFiles("output")) zip.file(name, value);
    const blob = await zip.generateAsync(
        { type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } },
        ({ percent }) => options.onStage("zip", 0.92 + percent / 100 * 0.08),
    );
    options.onStage("done", 1);
    return blob;
}

export async function generateDatapack(options: WebGenerateOptions): Promise<Blob> {
    if (isImageFile(options.file)) return generateImageDatapack(options);
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
    const builder = new DatapackBuilder(
        "output",
        options.width,
        options.height,
        displayMode,
        options.macroStorage,
        options.uuidEntities,
        options.compactUuidMacro,
    );
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
        compactUuidMacro: options.compactUuidMacro,
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
