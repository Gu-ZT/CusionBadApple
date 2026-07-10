import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { ConversionMode } from "./cli";

const NAMESPACE = "gugle";
const OBJECTIVE = "gugle_badapple";
const ORIGIN_TAG = "gugle_badapple_origin";
const PIXEL_TAG = "gugle_badapple_pixel";
const DISPATCH_LEAF_SIZE = 8;

interface BuildMetadata {
    input: string;
    fps: number;
    mode: ConversionMode;
    threshold: number;
    inverted: boolean;
    commands: number;
}

function coordinate(value: number): string {
    return value === 0 ? "~" : `~${value}`;
}

function changedRuns(
    current: Uint8Array,
    previous: Uint8Array,
    width: number,
    height: number,
): string[] {
    const commands: string[] = [];

    for (let z = 0; z < height; z += 1) {
        let x = 0;
        while (x < width) {
            const index = z * width + x;
            if (current[index] === previous[index]) {
                x += 1;
                continue;
            }

            const state = current[index];
            const start = x;
            x += 1;
            while (
                x < width &&
                current[z * width + x] !== previous[z * width + x] &&
                current[z * width + x] === state
            ) {
                x += 1;
            }

            const end = x - 1;
            const block = state === 1 ? "minecraft:redstone_block" : "minecraft:air";
            if (start === end) {
                commands.push(`setblock ${coordinate(start)} ~1 ${coordinate(z)} ${block}`);
            } else {
                commands.push(
                    `fill ${coordinate(start)} ~1 ${coordinate(z)} ${coordinate(end)} ~1 ${coordinate(z)} ${block}`,
                );
            }
        }
    }

    return commands;
}

export class DatapackBuilder {
    private readonly functionRoot: string;
    private readonly temporaryRoot: string;
    private readonly temporaryFrameRoot: string;
    private readonly temporaryDispatchRoot: string;

    public constructor(
        private readonly datapackRoot: string,
        private readonly width: number,
        private readonly height: number,
    ) {
        this.functionRoot = path.join(datapackRoot, "data", NAMESPACE, "function");
        this.temporaryRoot = path.join(datapackRoot, ".build", "function");
        this.temporaryFrameRoot = path.join(this.temporaryRoot, "frame");
        this.temporaryDispatchRoot = path.join(this.temporaryRoot, "dispatch");
    }

    public async prepare(): Promise<void> {
        await rm(path.join(this.datapackRoot, ".build"), { recursive: true, force: true });
        await mkdir(this.temporaryFrameRoot, { recursive: true });
        await mkdir(this.temporaryDispatchRoot, { recursive: true });
    }

    public async writeFrame(
        frame: number,
        current: Uint8Array,
        previous: Uint8Array,
    ): Promise<number> {
        const commands = changedRuns(current, previous, this.width, this.height);
        const contents = commands.length > 0
            ? `${commands.join("\n")}\n`
            : "# No pixels changed in this frame.\n";
        await writeFile(path.join(this.temporaryFrameRoot, `${frame}.mcfunction`), contents, "utf8");
        return commands.length;
    }

    public async finish(frameCount: number, metadata: BuildMetadata): Promise<void> {
        await this.writeDispatchNode(0, frameCount - 1, "root");
        await this.writeControlFunctions(frameCount);
        await mkdir(this.functionRoot, { recursive: true });

        for (const directory of ["frame", "dispatch"]) {
            const destination = path.join(this.functionRoot, directory);
            await rm(destination, { recursive: true, force: true });
            await rename(path.join(this.temporaryRoot, directory), destination);
        }

        const generatedFiles = [
            "setup",
            "remove",
            "start",
            "restart",
            "pause",
            "resume",
            "stop",
            "status",
            "tick",
        ];
        for (const name of generatedFiles) {
            await rename(
                path.join(this.temporaryRoot, `${name}.mcfunction`),
                path.join(this.functionRoot, `${name}.mcfunction`),
            );
        }

        await writeFile(
            path.join(this.datapackRoot, "generated.json"),
            `${JSON.stringify({
                ...metadata,
                width: this.width,
                height: this.height,
                frames: frameCount,
                durationSeconds: frameCount / metadata.fps,
            }, null, 2)}\n`,
            "utf8",
        );
        await rm(path.join(this.datapackRoot, ".build"), { recursive: true, force: true });
    }

    private async writeDispatchNode(start: number, end: number, name: string): Promise<void> {
        const commands: string[] = [];
        if (end - start + 1 <= DISPATCH_LEAF_SIZE) {
            for (let frame = start; frame <= end; frame += 1) {
                commands.push(
                    `execute if score $frame ${OBJECTIVE} matches ${frame} run function ${NAMESPACE}:frame/${frame}`,
                );
            }
        } else {
            const middle = Math.floor((start + end) / 2);
            const leftName = `${start}_${middle}`;
            const rightName = `${middle + 1}_${end}`;
            await this.writeDispatchNode(start, middle, leftName);
            await this.writeDispatchNode(middle + 1, end, rightName);
            commands.push(
                `execute if score $frame ${OBJECTIVE} matches ${start}..${middle} run function ${NAMESPACE}:dispatch/${leftName}`,
                `execute if score $frame ${OBJECTIVE} matches ${middle + 1}..${end} run function ${NAMESPACE}:dispatch/${rightName}`,
            );
        }
        await writeFile(
            path.join(this.temporaryDispatchRoot, `${name}.mcfunction`),
            `${commands.join("\n")}\n`,
            "utf8",
        );
    }

    private async writeControlFunctions(frameCount: number): Promise<void> {
        const lastFrame = frameCount - 1;
        const setup: string[] = [
            `scoreboard objectives add ${OBJECTIVE} dummy`,
            `function ${NAMESPACE}:remove`,
            `scoreboard players set $playing ${OBJECTIVE} 0`,
            `scoreboard players set $frame ${OBJECTIVE} 0`,
            `scoreboard players set $starts ${OBJECTIVE} 0`,
            `summon minecraft:marker ~ ~ ~ {Tags:["${ORIGIN_TAG}"]}`,
            `fill ~ ~1 ~ ~${this.width - 1} ~1 ~${this.height - 1} minecraft:air`,
            `fill ~ ~2 ~ ~${this.width - 1} ~2 ~${this.height - 1} minecraft:redstone_lamp`,
        ];
        for (let x = 0; x < this.width; x += 1) {
            for (let z = 0; z < this.height; z += 1) {
                setup.push(
                    `summon minecraft:cushion ~${x} ~2.26 ~${z} {Tags:["${PIXEL_TAG}"]}`,
                );
            }
        }

        const files: Record<string, string[]> = {
            setup,
            remove: [
                `schedule clear ${NAMESPACE}:tick`,
                `scoreboard players set $playing ${OBJECTIVE} 0`,
                `scoreboard players set $frame ${OBJECTIVE} 0`,
                `execute at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run fill ~ ~1 ~ ~${this.width - 1} ~1 ~${this.height - 1} minecraft:air`,
                `execute at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run fill ~ ~2 ~ ~${this.width - 1} ~2 ~${this.height - 1} minecraft:air`,
                `kill @e[type=minecraft:cushion,tag=${PIXEL_TAG}]`,
                `kill @e[type=minecraft:marker,tag=${ORIGIN_TAG}]`,
            ],
            start: [
                `execute unless score $playing ${OBJECTIVE} matches 1 run function ${NAMESPACE}:restart`,
            ],
            restart: [
                `schedule clear ${NAMESPACE}:tick`,
                `execute at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run fill ~ ~1 ~ ~${this.width - 1} ~1 ~${this.height - 1} minecraft:air`,
                `execute if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run scoreboard players set $frame ${OBJECTIVE} 0`,
                `execute if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run scoreboard players add $starts ${OBJECTIVE} 1`,
                `execute if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run scoreboard players set $playing ${OBJECTIVE} 1`,
                `execute if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run function ${NAMESPACE}:tick`,
            ],
            pause: [
                `scoreboard players set $playing ${OBJECTIVE} 0`,
                `schedule clear ${NAMESPACE}:tick`,
            ],
            resume: [
                `execute if score $frame ${OBJECTIVE} matches 0..${lastFrame} if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run scoreboard players set $playing ${OBJECTIVE} 1`,
                `execute if score $playing ${OBJECTIVE} matches 1 run schedule function ${NAMESPACE}:tick 1t replace`,
            ],
            stop: [
                `scoreboard players set $playing ${OBJECTIVE} 0`,
                `scoreboard players set $frame ${OBJECTIVE} 0`,
                `schedule clear ${NAMESPACE}:tick`,
                `execute at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run fill ~ ~1 ~ ~${this.width - 1} ~1 ~${this.height - 1} minecraft:air`,
            ],
            status: [
                `tellraw @s [{"text":"BadApple frame: "},{"score":{"name":"$frame","objective":"${OBJECTIVE}"}},{"text":"/${lastFrame}, playing: "},{"score":{"name":"$playing","objective":"${OBJECTIVE}"}},{"text":", starts: "},{"score":{"name":"$starts","objective":"${OBJECTIVE}"}}]`,
            ],
            tick: [
                `execute if score $playing ${OBJECTIVE} matches 1 if score $frame ${OBJECTIVE} matches 0..${lastFrame} at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run function ${NAMESPACE}:dispatch/root`,
                `execute if score $playing ${OBJECTIVE} matches 1 run scoreboard players add $frame ${OBJECTIVE} 1`,
                `execute if score $playing ${OBJECTIVE} matches 1 if score $frame ${OBJECTIVE} matches ${frameCount}.. run scoreboard players set $playing ${OBJECTIVE} 0`,
                `execute if score $playing ${OBJECTIVE} matches 1 run schedule function ${NAMESPACE}:tick 1t replace`,
            ],
        };

        for (const [name, commands] of Object.entries(files)) {
            await writeFile(
                path.join(this.temporaryRoot, `${name}.mcfunction`),
                `${commands.join("\n")}\n`,
                "utf8",
            );
        }
    }
}
