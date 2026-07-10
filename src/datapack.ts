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

function changedRectangles(
    current: Uint8Array,
    previous: Uint8Array,
    width: number,
    height: number,
): string[] {
    const commands: string[] = [];
    const changed = new Int8Array(current.length);
    changed.fill(-1);

    for (let index = 0; index < current.length; index += 1) {
        if (current[index] !== previous[index]) {
            changed[index] = current[index];
        }
    }

    for (let z = 0; z < height; z += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = z * width + x;
            const state = changed[index];
            if (state < 0) {
                continue;
            }

            let rowWidth = 0;
            while (x + rowWidth < width && changed[index + rowWidth] === state) {
                rowWidth += 1;
            }

            let minimumWidth = rowWidth;
            let bestWidth = rowWidth;
            let bestHeight = 1;
            let bestArea = rowWidth;

            for (let endZ = z + 1; endZ < height; endZ += 1) {
                let nextWidth = 0;
                while (
                    nextWidth < minimumWidth &&
                    changed[endZ * width + x + nextWidth] === state
                ) {
                    nextWidth += 1;
                }
                if (nextWidth === 0) {
                    break;
                }

                minimumWidth = nextWidth;
                const area = minimumWidth * (endZ - z + 1);
                if (area > bestArea) {
                    bestArea = area;
                    bestWidth = minimumWidth;
                    bestHeight = endZ - z + 1;
                }
            }

            for (let clearZ = z; clearZ < z + bestHeight; clearZ += 1) {
                changed.fill(-1, clearZ * width + x, clearZ * width + x + bestWidth);
            }

            const block = state === 1 ? "minecraft:redstone_block" : "minecraft:air";
            if (bestWidth === 1 && bestHeight === 1) {
                commands.push(`setblock ${coordinate(x)} ~1 ${coordinate(z)} ${block}`);
            } else {
                commands.push(
                    `fill ${coordinate(x)} ~1 ${coordinate(z)} ${coordinate(x + bestWidth - 1)} ~1 ${coordinate(z + bestHeight - 1)} ${block}`,
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
        const commands = changedRectangles(current, previous, this.width, this.height);
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
                    `execute if score $render ${OBJECTIVE} matches ${frame} run function ${NAMESPACE}:frame/${frame}`,
                );
            }
        } else {
            const middle = Math.floor((start + end) / 2);
            const leftName = `${start}_${middle}`;
            const rightName = `${middle + 1}_${end}`;
            await this.writeDispatchNode(start, middle, leftName);
            await this.writeDispatchNode(middle + 1, end, rightName);
            commands.push(
                `execute if score $render ${OBJECTIVE} matches ${start}..${middle} run function ${NAMESPACE}:dispatch/${leftName}`,
                `execute if score $render ${OBJECTIVE} matches ${middle + 1}..${end} run function ${NAMESPACE}:dispatch/${rightName}`,
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
            "gamerule max_command_forks 65536",
            "gamerule max_command_sequence_length 65536",
            `scoreboard objectives add ${OBJECTIVE} dummy`,
            `function ${NAMESPACE}:remove`,
            `scoreboard players set $playing ${OBJECTIVE} 0`,
            `scoreboard players set $frame ${OBJECTIVE} 0`,
            `scoreboard players set $render ${OBJECTIVE} 0`,
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
                `scoreboard players set $render ${OBJECTIVE} 0`,
                `execute at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run fill ~ ~1 ~ ~${this.width - 1} ~1 ~${this.height - 1} minecraft:air`,
                `execute at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run fill ~ ~2 ~ ~${this.width - 1} ~2 ~${this.height - 1} minecraft:air`,
                `kill @e[type=minecraft:cushion,tag=${PIXEL_TAG}]`,
                `kill @e[type=minecraft:marker,tag=${ORIGIN_TAG}]`,
            ],
            start: [
                `execute unless score $playing ${OBJECTIVE} matches 1 run function ${NAMESPACE}:restart`,
            ],
            restart: [
                "gamerule max_command_forks 65536",
                "gamerule max_command_sequence_length 65536",
                `schedule clear ${NAMESPACE}:tick`,
                `execute at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run fill ~ ~1 ~ ~${this.width - 1} ~1 ~${this.height - 1} minecraft:air`,
                `execute if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run scoreboard players set $frame ${OBJECTIVE} 0`,
                `execute if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run scoreboard players set $render ${OBJECTIVE} 0`,
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
                `execute if score $playing ${OBJECTIVE} matches 1 run schedule function ${NAMESPACE}:tick 1t replace`,
                `execute if score $playing ${OBJECTIVE} matches 1 run scoreboard players operation $render ${OBJECTIVE} = $frame ${OBJECTIVE}`,
                `execute if score $playing ${OBJECTIVE} matches 1 run scoreboard players add $frame ${OBJECTIVE} 1`,
                `execute if score $playing ${OBJECTIVE} matches 1 if score $render ${OBJECTIVE} matches 0..${lastFrame} at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run function ${NAMESPACE}:dispatch/root`,
                `execute if score $playing ${OBJECTIVE} matches 1 if score $frame ${OBJECTIVE} matches ${frameCount}.. run scoreboard players set $playing ${OBJECTIVE} 0`,
                `execute unless score $playing ${OBJECTIVE} matches 1 run schedule clear ${NAMESPACE}:tick`,
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
