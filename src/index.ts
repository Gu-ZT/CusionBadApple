import * as path from "node:path";
import { BRIGHTNESS_TIERS } from "./brightness";
import {
    isCushionColorMode,
    isRgb3Mode,
    isRgbwMode,
    parseCli,
    printHelp,
    screenScaleForMode,
} from "./cli";
import { CUSHION_COLOR_PALETTE } from "./colors";
import {
    convertCushionColorFrame,
    convertFrame,
    convertRgb3Frame,
    convertRgbwFrame,
    filterCushionColorChanges,
} from "./converter";
import { DatapackBuilder, DisplayMode } from "./datapack";
import { decodeVideo, findInputVideo } from "./video";
import { RGB3_LAMP_LEVELS } from "./rgb3";

async function main(): Promise<void> {
    const options = parseCli(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const inputPath = options.input
        ? path.resolve(options.input)
        : await findInputVideo(path.resolve("input"));
    const datapackPath = path.resolve(options.output);
    const rgbw = isRgbwMode(options.mode);
    const rgb3 = isRgb3Mode(options.mode);
    const cushionColor = isCushionColorMode(options.mode);
    const rgbInput = rgbw || rgb3 || cushionColor;
    const logicalWidth = options.width;
    const logicalHeight = options.height;
    const screenScale = screenScaleForMode(options.mode);
    const screenWidth = logicalWidth * screenScale;
    const screenHeight = logicalHeight * screenScale;
    const displayMode: DisplayMode = cushionColor
        ? "cushion-color"
        : rgbw ? "rgbw" : rgb3 ? "rgb3" : "redstone";
    const builder = new DatapackBuilder(
        datapackPath,
        screenWidth,
        screenHeight,
        displayMode,
        options.macroStorage,
        options.uuidEntities,
        options.compactUuidMacro,
    );

    await builder.prepare();

    let previousFrame: Uint8Array = new Uint8Array(screenWidth * screenHeight);
    let frameCount = 0;
    let commandCount = 0;

    console.log(`Input: ${inputPath}`);
    console.log(
        `Converting at 20 FPS: ${logicalWidth}x${logicalHeight}, mode=${options.mode}` +
        (screenScale > 1 ? `, screen=${screenWidth}x${screenHeight}` : "") +
        (options.startSeconds > 0 || options.endSeconds !== undefined
            ? `, clip=${options.startSeconds}s..${options.endSeconds ?? "end"}s`
            : "") +
        (options.invert ? ", inverted" : ""),
    );

    for await (const decodedFrame of decodeVideo({
        inputPath,
        width: logicalWidth,
        height: logicalHeight,
        pixelFormat: rgbInput ? "rgb24" : "gray",
        startSeconds: options.startSeconds,
        endSeconds: options.endSeconds,
        maxFrames: options.maxFrames,
    })) {
        const convertedFrame = isCushionColorMode(options.mode)
            ? convertCushionColorFrame(
                decodedFrame,
                logicalWidth,
                logicalHeight,
                options.mode,
                options.invert,
                options.orderedDitherAmplitude,
            )
            : isRgbwMode(options.mode)
                ? convertRgbwFrame(
                    decodedFrame,
                    logicalWidth,
                    logicalHeight,
                    options.mode,
                    options.invert,
                )
                : isRgb3Mode(options.mode)
                    ? convertRgb3Frame(
                        decodedFrame,
                        logicalWidth,
                        logicalHeight,
                        options.mode,
                        options.invert,
                    )
                : convertFrame(
                    decodedFrame,
                    logicalWidth,
                    logicalHeight,
                    options.mode,
                    options.threshold,
                    options.invert,
                );
        const currentFrame = cushionColor
            ? filterCushionColorChanges(convertedFrame, previousFrame, options.dirtyDeltaE)
            : convertedFrame;
        commandCount += await builder.writeFrame(frameCount, currentFrame, previousFrame);
        previousFrame = currentFrame;
        frameCount += 1;

        if (frameCount % 100 === 0) {
            console.log(`Converted ${frameCount} frames...`);
        }
    }

    if (frameCount === 0) {
        throw new Error("FFmpeg did not produce any video frames.");
    }

    await builder.finish(frameCount, {
        input: path.relative(process.cwd(), inputPath),
        fps: 20,
        mode: options.mode,
        threshold: options.threshold,
        inverted: options.invert,
        logicalWidth,
        logicalHeight,
        subpixelLayout: rgbw
            ? "R G / B W"
            : rgb3 ? "R0 G2 B1 / G1 B0 R2 / B2 R1 G0" : undefined,
        palette: cushionColor
            ? CUSHION_COLOR_PALETTE.map((color) => color.name)
            : undefined,
        brightnessLevels: cushionColor
            ? BRIGHTNESS_TIERS.map((tier) => tier.level)
            : rgb3 ? [...RGB3_LAMP_LEVELS] : undefined,
        macroStorage: options.macroStorage,
        uuidEntities: options.uuidEntities,
        compactUuidMacro: options.compactUuidMacro,
        colorMetric: cushionColor ? "CIEDE2000" : undefined,
        calibration: cushionColor ? "palette screenshot, 192 median-sampled states" : undefined,
        dirtyDeltaE: cushionColor ? options.dirtyDeltaE : undefined,
        orderedDitherAmplitude: options.mode === "color-ordered"
            ? options.orderedDitherAmplitude
            : undefined,
        clipStartSeconds: options.startSeconds,
        clipEndSeconds: options.endSeconds,
        commands: commandCount,
    });

    console.log(
        `Done: ${frameCount} frames (${(frameCount / 20).toFixed(2)} s), ` +
        `${commandCount} frame commands.`,
    );
    console.log(`Datapack: ${datapackPath}`);
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
});
