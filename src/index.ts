import * as path from "node:path";
import { parseCli, printHelp } from "./cli";
import { convertFrame } from "./converter";
import { DatapackBuilder } from "./datapack";
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
    const datapackPath = path.resolve("datapack");
    const builder = new DatapackBuilder(datapackPath, options.width, options.height);

    await builder.prepare();

    let previousFrame: Uint8Array = new Uint8Array(options.width * options.height);
    let frameCount = 0;
    let commandCount = 0;

    console.log(`Input: ${inputPath}`);
    console.log(
        `Converting at 20 FPS: ${options.width}x${options.height}, mode=${options.mode}` +
        (options.invert ? ", inverted" : ""),
    );

    for await (const grayFrame of decodeVideo({
        inputPath,
        width: options.width,
        height: options.height,
        maxFrames: options.maxFrames,
    })) {
        const currentFrame = convertFrame(
            grayFrame,
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
        commands: commandCount,
    });

    console.log(
        `Done: ${frameCount} frames (${(frameCount / 20).toFixed(2)} s), ${commandCount} block commands.`,
    );
    console.log(`Datapack: ${datapackPath}`);
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
});
