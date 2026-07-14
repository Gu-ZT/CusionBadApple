import * as path from "node:path";
import { BRIGHTNESS_TIERS } from "./brightness";
import { isCushionColorMode, isRgbwMode, parseCli, printHelp } from "./cli";
import { CUSHION_COLOR_PALETTE } from "./colors";
import { convertCushionColorFrame, convertFrame, convertRgbwFrame } from "./converter";
import { DatapackBuilder, DisplayMode } from "./datapack";
import { decodeVideo, findInputVideo } from "./video";

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
    const cushionColor = isCushionColorMode(options.mode);
    const rgbInput = rgbw || cushionColor;
    const logicalWidth = rgbw ? options.width / 2 : options.width;
    const logicalHeight = rgbw ? options.height / 2 : options.height;
    const displayMode: DisplayMode = cushionColor
        ? "cushion-color"
        : rgbw ? "rgbw" : "redstone";
    const builder = new DatapackBuilder(
        datapackPath,
        options.width,
        options.height,
        displayMode,
        options.macroStorage,
    );

    await builder.prepare();

    let previousFrame: Uint8Array = new Uint8Array(options.width * options.height);
    let frameCount = 0;
    let commandCount = 0;

    console.log(`Input: ${inputPath}`);
    console.log(
        `Converting at 20 FPS: ${options.width}x${options.height}, mode=${options.mode}` +
        (rgbw ? `, logical=${logicalWidth}x${logicalHeight}` : "") +
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
        const currentFrame = isCushionColorMode(options.mode)
            ? convertCushionColorFrame(
                decodedFrame,
                logicalWidth,
                logicalHeight,
                options.mode,
                options.invert,
            )
            : isRgbwMode(options.mode)
                ? convertRgbwFrame(
                    decodedFrame,
                    logicalWidth,
                    logicalHeight,
                    options.mode,
                    options.invert,
                )
                : convertFrame(
                    decodedFrame,
                    options.width,
                    options.height,
                    options.mode,
                    options.threshold,
                    options.invert,
                );
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
        subpixelLayout: rgbw ? "R G / B W" : undefined,
        palette: cushionColor
            ? CUSHION_COLOR_PALETTE.map((color) => color.name)
            : undefined,
        brightnessLevels: cushionColor
            ? BRIGHTNESS_TIERS.map((tier) => tier.level)
            : undefined,
        macroStorage: options.macroStorage,
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
