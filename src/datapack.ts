import { access, copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { BRIGHTNESS_TIERS } from "./brightness";
import { ConversionMode } from "./cli";
import { CUSHION_COLOR_PALETTE } from "./colors";

const NAMESPACE = "gugle";
const OBJECTIVE = "gugle_badapple";
const ORIGIN_TAG = "gugle_badapple_origin";
const PIXEL_TAG = "gugle_badapple_pixel";
const PIXEL_X_OBJECTIVE = "gugle_px";
const PIXEL_Z_OBJECTIVE = "gugle_pz";
const DISPATCH_LEAF_SIZE = 8;
const PIXEL_UUID_STRIDE = 32768;

export type DisplayMode = "redstone" | "rgbw" | "cushion-color";

interface BuildMetadata {
    input: string;
    fps: number;
    mode: ConversionMode;
    threshold: number;
    inverted: boolean;
    logicalWidth: number;
    logicalHeight: number;
    subpixelLayout?: string;
    palette?: string[];
    brightnessLevels?: number[];
    clipStartSeconds: number;
    clipEndSeconds?: number;
    macroStorage: boolean;
    uuidEntities: boolean;
    commands: number;
}

interface PixelUuid {
    nbt: string;
    target: string;
}

type RgbwCushionColor = "red" | "green" | "blue" | "white";

function rgbwCushionColor(x: number, z: number): RgbwCushionColor {
    if (z % 2 === 0) {
        return x % 2 === 0 ? "red" : "green";
    }
    return x % 2 === 0 ? "blue" : "white";
}

function coordinate(value: number): string {
    return value === 0 ? "~" : `~${value}`;
}

function hexadecimal(value: number, width: number): string {
    return (value >>> 0).toString(16).slice(-width).padStart(width, "0");
}

function pixelUuid(x: number, z: number): PixelUuid {
    const coordinateId = z * PIXEL_UUID_STRIDE + x;
    const parts = [
        0x6775676c | 0,
        0x652d4000 | 0,
        0x80000000 | 0,
        coordinateId | 0,
    ];
    const target =
        `${hexadecimal(parts[0], 8)}-${hexadecimal(parts[1] >>> 16, 4)}-` +
        `${hexadecimal(parts[1], 4)}-${hexadecimal(parts[2] >>> 16, 4)}-` +
        `${hexadecimal(parts[2], 4)}${hexadecimal(parts[3], 8)}`;
    return {
        nbt: `[I;${parts.join(",")}]`,
        target,
    };
}

interface ChangedRectangle {
    x: number;
    z: number;
    width: number;
    height: number;
    state: number;
}

function changedRectangles(
    current: Uint8Array,
    previous: Uint8Array,
    width: number,
    height: number,
    mapState: (state: number) => number = (state) => state,
): ChangedRectangle[] {
    const rectangles: ChangedRectangle[] = [];
    const changed = new Int8Array(current.length);
    changed.fill(-1);

    for (let index = 0; index < current.length; index += 1) {
        const currentState = mapState(current[index]);
        if (currentState !== mapState(previous[index])) {
            changed[index] = currentState;
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

            rectangles.push({ x, z, width: bestWidth, height: bestHeight, state });
        }
    }

    return rectangles;
}

function scoreRange(start: number, length: number): string {
    return length === 1 ? String(start) : `${start}..${start + length - 1}`;
}

export class DatapackBuilder {
    private readonly functionRoot: string;
    private readonly temporaryRoot: string;
    private readonly temporaryFrameRoot: string;
    private readonly temporaryDispatchRoot: string;
    private readonly temporarySetupChunkRoot: string;
    private readonly temporarySetupDispatchRoot: string;
    private readonly temporaryMacroStateRoot: string;
    private readonly pixelUuids: PixelUuid[];

    public constructor(
        private readonly datapackRoot: string,
        private readonly width: number,
        private readonly height: number,
        private readonly displayMode: DisplayMode,
        private readonly macroStorage: boolean,
        private readonly uuidEntities: boolean,
    ) {
        if (macroStorage && uuidEntities) {
            throw new Error("Macro storage and fixed-UUID rendering cannot be enabled together.");
        }
        this.functionRoot = path.join(datapackRoot, "data", NAMESPACE, "function");
        this.temporaryRoot = path.join(datapackRoot, ".build", "function");
        this.temporaryFrameRoot = path.join(this.temporaryRoot, "frame");
        this.temporaryDispatchRoot = path.join(this.temporaryRoot, "dispatch");
        this.temporarySetupChunkRoot = path.join(this.temporaryRoot, "setup_chunk");
        this.temporarySetupDispatchRoot = path.join(this.temporaryRoot, "setup_dispatch");
        this.temporaryMacroStateRoot = path.join(this.temporaryRoot, "macro_state");
        this.pixelUuids = uuidEntities
            ? Array.from({ length: width * height }, (_, index) =>
                pixelUuid(index % width, Math.floor(index / width)),
            )
            : [];
    }

    public async prepare(): Promise<void> {
        await mkdir(this.datapackRoot, { recursive: true });
        const packMetadataPath = path.join(this.datapackRoot, "pack.mcmeta");
        try {
            await access(packMetadataPath);
        } catch {
            const templatePath = path.resolve("datapack", "pack.mcmeta");
            if (path.resolve(packMetadataPath) === templatePath) {
                throw new Error(`Missing datapack metadata template: ${templatePath}`);
            }
            await copyFile(templatePath, packMetadataPath);
        }
        await rm(path.join(this.datapackRoot, ".build"), { recursive: true, force: true });
        await mkdir(this.temporaryFrameRoot, { recursive: true });
        await mkdir(this.temporaryDispatchRoot, { recursive: true });
        await mkdir(this.temporarySetupChunkRoot, { recursive: true });
        await mkdir(this.temporarySetupDispatchRoot, { recursive: true });
        if (this.macroStorage) {
            await mkdir(this.temporaryMacroStateRoot, { recursive: true });
        }
    }

    public async writeFrame(
        frame: number,
        current: Uint8Array,
        previous: Uint8Array,
    ): Promise<number> {
        const commands = this.displayMode === "cushion-color" && this.macroStorage
            ? this.macroStorageFrameCommands(current, previous)
            : this.displayMode === "cushion-color"
            ? [
                ...(this.uuidEntities
                    ? this.uuidColorCommands(current, previous)
                    : changedRectangles(
                        current,
                        previous,
                        this.width,
                        this.height,
                        (state) => state % CUSHION_COLOR_PALETTE.length,
                    ).map((rectangle) => this.colorRectangleCommand(rectangle))),
                ...changedRectangles(
                    current,
                    previous,
                    this.width,
                    this.height,
                    (state) => Math.floor(state / CUSHION_COLOR_PALETTE.length),
                ).map((rectangle) => this.brightnessRectangleCommand(rectangle)),
            ]
            : changedRectangles(current, previous, this.width, this.height)
                .map((rectangle) => this.redstoneRectangleCommand(rectangle));
        const contents = commands.length > 0
            ? `${commands.join("\n")}\n`
            : "# No pixels changed in this frame.\n";
        await writeFile(path.join(this.temporaryFrameRoot, `${frame}.mcfunction`), contents, "utf8");
        return commands.length;
    }

    private macroStorageFrameCommands(
        current: Uint8Array,
        previous: Uint8Array,
    ): string[] {
        const rows: string[] = [];

        for (let z = 0; z < this.height; z += 1) {
            const entries: string[] = [];
            for (let x = 0; x < this.width; x += 1) {
                const index = z * this.width + x;
                if (current[index] !== previous[index]) {
                    entries.push(`p_${x}_${z}:{s:${current[index]}}`);
                }
            }
            if (entries.length > 0) {
                rows.push(entries.join(","));
            }
        }

        if (rows.length === 0) {
            return ["data modify storage gugle:video current set value {}"];
        }

        const continuedRows = rows.map((row, index) =>
            `${row}${index < rows.length - 1 ? "," : ""}\\`,
        );
        const storageCommand = [
            "data modify storage gugle:video current set value {\\",
            ...continuedRows,
            "}",
        ].join("\n");

        return [
            storageCommand,
            `execute as @e[type=minecraft:cushion,tag=${PIXEL_TAG}] ` +
                `run function ${NAMESPACE}:macro_lookup with entity @s`,
        ];
    }

    private uuidColorCommands(current: Uint8Array, previous: Uint8Array): string[] {
        const commands: string[] = [];
        for (let index = 0; index < current.length; index += 1) {
            const colorIndex = current[index] % CUSHION_COLOR_PALETTE.length;
            if (colorIndex === previous[index] % CUSHION_COLOR_PALETTE.length) {
                continue;
            }
            const color = CUSHION_COLOR_PALETTE[colorIndex];
            const uuid = this.pixelUuids[index];
            if (!color || !uuid) {
                throw new Error(`Invalid fixed-UUID color pixel index: ${index}.`);
            }
            commands.push(
                `data modify entity ${uuid.target} color set value "${color.name}"`,
            );
        }
        return commands;
    }

    private colorRectangleCommand(rectangle: ChangedRectangle): string {
        const color = CUSHION_COLOR_PALETTE[rectangle.state];
        if (!color) {
            throw new Error(`Invalid cushion color index: ${rectangle.state}.`);
        }
        const selector = [
            "@e[type=minecraft:cushion",
            `tag=${PIXEL_TAG}`,
            `scores={${PIXEL_X_OBJECTIVE}=${scoreRange(rectangle.x, rectangle.width)},` +
                `${PIXEL_Z_OBJECTIVE}=${scoreRange(rectangle.z, rectangle.height)}}]`,
        ].join(",");
        return `execute as ${selector} run data modify entity @s color set value "${color.name}"`;
    }

    private brightnessRectangleCommand(rectangle: ChangedRectangle): string {
        const tier = BRIGHTNESS_TIERS[rectangle.state];
        if (!tier) {
            throw new Error(`Invalid brightness tier index: ${rectangle.state}.`);
        }
        return this.blockRectangleCommand(rectangle, 2, tier.block);
    }

    private redstoneRectangleCommand(rectangle: ChangedRectangle): string {
        const block = rectangle.state === 1 ? "minecraft:redstone_block" : "minecraft:air";
        return this.blockRectangleCommand(rectangle, 1, block);
    }

    private blockRectangleCommand(
        rectangle: ChangedRectangle,
        y: number,
        block: string,
    ): string {
        if (rectangle.width === 1 && rectangle.height === 1) {
            return `setblock ${coordinate(rectangle.x)} ~${y} ${coordinate(rectangle.z)} ${block}`;
        }
        return (
            `fill ${coordinate(rectangle.x)} ~${y} ${coordinate(rectangle.z)} ` +
            `${coordinate(rectangle.x + rectangle.width - 1)} ~${y} ` +
            `${coordinate(rectangle.z + rectangle.height - 1)} ${block}`
        );
    }

    public async finish(frameCount: number, metadata: BuildMetadata): Promise<void> {
        await this.writeDispatchNode(
            0,
            frameCount - 1,
            "root",
            this.temporaryDispatchRoot,
            "$render",
            "frame",
            "dispatch",
        );
        await this.writeDispatchNode(
            0,
            this.height - 1,
            "root",
            this.temporarySetupDispatchRoot,
            "$setup_row",
            "setup_chunk",
            "setup_dispatch",
        );
        if (this.macroStorage) {
            await this.writeMacroStateFunctions();
        }
        await this.writeControlFunctions(frameCount);
        await mkdir(this.functionRoot, { recursive: true });

        const generatedDirectories = ["frame", "dispatch", "setup_chunk", "setup_dispatch"];
        if (this.macroStorage) {
            generatedDirectories.push("macro_state");
        }
        for (const directory of [
            "frame",
            "dispatch",
            "setup_chunk",
            "setup_dispatch",
            "macro_state",
        ]) {
            const destination = path.join(this.functionRoot, directory);
            await rm(destination, { recursive: true, force: true });
            if (generatedDirectories.includes(directory)) {
                await rename(path.join(this.temporaryRoot, directory), destination);
            }
        }

        const generatedFiles = [
            "setup",
            "remove",
            "start",
            "restart",
            "play",
            "pause",
            "resume",
            "stop",
            "status",
            "tick",
            "setup_tick",
        ];
        if (this.macroStorage) {
            generatedFiles.push("macro_lookup", "macro_apply");
        } else {
            await rm(path.join(this.functionRoot, "macro_lookup.mcfunction"), { force: true });
            await rm(path.join(this.functionRoot, "macro_apply.mcfunction"), { force: true });
        }
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

    private async writeMacroStateFunctions(): Promise<void> {
        for (let brightness = 0; brightness < BRIGHTNESS_TIERS.length; brightness += 1) {
            for (let color = 0; color < CUSHION_COLOR_PALETTE.length; color += 1) {
                const state = brightness * CUSHION_COLOR_PALETTE.length + color;
                const commands = [
                    `data modify entity @s color set value "${CUSHION_COLOR_PALETTE[color].name}"`,
                    `execute at @s run setblock ~ ~ ~ ${BRIGHTNESS_TIERS[brightness].block}`,
                ];
                await writeFile(
                    path.join(this.temporaryMacroStateRoot, `${state}.mcfunction`),
                    `${commands.join("\n")}\n`,
                    "utf8",
                );
            }
        }
    }

    private async writeDispatchNode(
        start: number,
        end: number,
        name: string,
        outputRoot: string,
        scoreHolder: string,
        leafDirectory: string,
        branchDirectory: string,
    ): Promise<void> {
        const commands: string[] = [];
        if (end - start + 1 <= DISPATCH_LEAF_SIZE) {
            for (let value = start; value <= end; value += 1) {
                commands.push(
                    `execute if score ${scoreHolder} ${OBJECTIVE} matches ${value} ` +
                        `run function ${NAMESPACE}:${leafDirectory}/${value}`,
                );
            }
        } else {
            const middle = Math.floor((start + end) / 2);
            const leftName = `${start}_${middle}`;
            const rightName = `${middle + 1}_${end}`;
            await this.writeDispatchNode(
                start,
                middle,
                leftName,
                outputRoot,
                scoreHolder,
                leafDirectory,
                branchDirectory,
            );
            await this.writeDispatchNode(
                middle + 1,
                end,
                rightName,
                outputRoot,
                scoreHolder,
                leafDirectory,
                branchDirectory,
            );
            commands.push(
                `execute if score ${scoreHolder} ${OBJECTIVE} matches ${start}..${middle} ` +
                    `run function ${NAMESPACE}:${branchDirectory}/${leftName}`,
                `execute if score ${scoreHolder} ${OBJECTIVE} matches ${middle + 1}..${end} ` +
                    `run function ${NAMESPACE}:${branchDirectory}/${rightName}`,
            );
        }
        await writeFile(
            path.join(outputRoot, `${name}.mcfunction`),
            `${commands.join("\n")}\n`,
            "utf8",
        );
    }

    private async writeControlFunctions(frameCount: number): Promise<void> {
        const lastFrame = frameCount - 1;
        const commandSequenceLimit = this.macroStorage ? 131072 : 65536;
        await this.writeSetupChunks();
        const setup: string[] = [
            "gamerule max_command_forks 65536",
            `gamerule max_command_sequence_length ${commandSequenceLimit}`,
            `scoreboard objectives add ${OBJECTIVE} dummy`,
            ...(this.displayMode === "cushion-color" &&
                !this.macroStorage &&
                !this.uuidEntities
                ? [
                    `scoreboard objectives add ${PIXEL_X_OBJECTIVE} dummy`,
                    `scoreboard objectives add ${PIXEL_Z_OBJECTIVE} dummy`,
                ]
                : []),
            `function ${NAMESPACE}:remove`,
            `scoreboard players set $playing ${OBJECTIVE} 0`,
            `scoreboard players set $frame ${OBJECTIVE} 0`,
            `scoreboard players set $render ${OBJECTIVE} 0`,
            `scoreboard players set $starts ${OBJECTIVE} 0`,
            `scoreboard players set $setup_row ${OBJECTIVE} 0`,
            `scoreboard players set $ready ${OBJECTIVE} 0`,
            `scoreboard players set $autostart ${OBJECTIVE} 0`,
            `summon minecraft:marker ~ ~ ~ {Tags:["${ORIGIN_TAG}"]}`,
            `fill ~ ~1 ~ ~${this.width - 1} ~1 ~${this.height - 1} minecraft:air`,
            `fill ~ ~2 ~ ~${this.width - 1} ~2 ~${this.height - 1} ` +
                (this.displayMode === "cushion-color"
                    ? BRIGHTNESS_TIERS[0].block
                    : "minecraft:redstone_lamp"),
            `function ${NAMESPACE}:setup_tick`,
        ];

        const resetDisplay = this.displayMode === "cushion-color"
            ? [
                ...(this.macroStorage
                    ? ["data modify storage gugle:video current set value {}"]
                    : []),
                `execute as @e[type=minecraft:cushion,tag=${PIXEL_TAG}] ` +
                    "run data modify entity @s color set value \"black\"",
                `execute at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] ` +
                    `run fill ~ ~2 ~ ~${this.width - 1} ~2 ~${this.height - 1} ` +
                    BRIGHTNESS_TIERS[0].block,
            ]
            : [
                `execute at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] ` +
                    `run fill ~ ~1 ~ ~${this.width - 1} ~1 ~${this.height - 1} minecraft:air`,
            ];

        const files: Record<string, string[]> = {
            setup,
            remove: [
                `schedule clear ${NAMESPACE}:tick`,
                `schedule clear ${NAMESPACE}:setup_tick`,
                `scoreboard players set $playing ${OBJECTIVE} 0`,
                `scoreboard players set $frame ${OBJECTIVE} 0`,
                `scoreboard players set $render ${OBJECTIVE} 0`,
                `scoreboard players set $setup_row ${OBJECTIVE} 0`,
                `scoreboard players set $ready ${OBJECTIVE} 0`,
                `scoreboard players set $autostart ${OBJECTIVE} 0`,
                `execute at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run fill ~ ~1 ~ ~${this.width - 1} ~1 ~${this.height - 1} minecraft:air`,
                `execute at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run fill ~ ~2 ~ ~${this.width - 1} ~2 ~${this.height - 1} minecraft:air`,
                `kill @e[type=minecraft:cushion,tag=${PIXEL_TAG}]`,
                `kill @e[type=minecraft:marker,tag=${ORIGIN_TAG}]`,
            ],
            start: [
                `execute if score $ready ${OBJECTIVE} matches 0 run scoreboard players set $autostart ${OBJECTIVE} 1`,
                `execute if score $ready ${OBJECTIVE} matches 0 run tellraw @s {"text":"Screen setup in progress; playback queued."}`,
                `execute if score $ready ${OBJECTIVE} matches 1 unless score $playing ${OBJECTIVE} matches 1 run function ${NAMESPACE}:restart`,
            ],
            restart: [
                "gamerule max_command_forks 65536",
                `gamerule max_command_sequence_length ${commandSequenceLimit}`,
                `schedule clear ${NAMESPACE}:tick`,
                ...resetDisplay,
                `function ${NAMESPACE}:play`,
            ],
            play: [
                `schedule clear ${NAMESPACE}:tick`,
                `execute if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run scoreboard players set $frame ${OBJECTIVE} 0`,
                `execute if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run scoreboard players set $render ${OBJECTIVE} 0`,
                `scoreboard players set $autostart ${OBJECTIVE} 0`,
                `execute if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run scoreboard players add $starts ${OBJECTIVE} 1`,
                `execute if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run scoreboard players set $playing ${OBJECTIVE} 1`,
                `execute if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run function ${NAMESPACE}:tick`,
            ],
            pause: [
                `scoreboard players set $playing ${OBJECTIVE} 0`,
                `schedule clear ${NAMESPACE}:tick`,
            ],
            resume: [
                `execute if score $ready ${OBJECTIVE} matches 1 if score $frame ${OBJECTIVE} matches 0..${lastFrame} if entity @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run scoreboard players set $playing ${OBJECTIVE} 1`,
                `execute if score $playing ${OBJECTIVE} matches 1 run schedule function ${NAMESPACE}:tick 1t replace`,
            ],
            stop: [
                `scoreboard players set $playing ${OBJECTIVE} 0`,
                `scoreboard players set $frame ${OBJECTIVE} 0`,
                `schedule clear ${NAMESPACE}:tick`,
                ...resetDisplay,
            ],
            status: [
                `tellraw @s [{"text":"BadApple frame: "},{"score":{"name":"$frame","objective":"${OBJECTIVE}"}},{"text":"/${lastFrame}, playing: "},{"score":{"name":"$playing","objective":"${OBJECTIVE}"}},{"text":", ready: "},{"score":{"name":"$ready","objective":"${OBJECTIVE}"}},{"text":", setup row: "},{"score":{"name":"$setup_row","objective":"${OBJECTIVE}"}},{"text":"/${this.height}, starts: "},{"score":{"name":"$starts","objective":"${OBJECTIVE}"}}]`,
            ],
            tick: [
                `execute if score $playing ${OBJECTIVE} matches 1 run schedule function ${NAMESPACE}:tick 1t replace`,
                `execute if score $playing ${OBJECTIVE} matches 1 run scoreboard players operation $render ${OBJECTIVE} = $frame ${OBJECTIVE}`,
                `execute if score $playing ${OBJECTIVE} matches 1 run scoreboard players add $frame ${OBJECTIVE} 1`,
                `execute if score $playing ${OBJECTIVE} matches 1 if score $render ${OBJECTIVE} matches 0..${lastFrame} at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run function ${NAMESPACE}:dispatch/root`,
                `execute if score $playing ${OBJECTIVE} matches 1 if score $frame ${OBJECTIVE} matches ${frameCount}.. run scoreboard players set $playing ${OBJECTIVE} 0`,
                `execute unless score $playing ${OBJECTIVE} matches 1 run schedule clear ${NAMESPACE}:tick`,
            ],
            setup_tick: [
                `execute if score $ready ${OBJECTIVE} matches 0 run schedule function ${NAMESPACE}:setup_tick 1t replace`,
                `execute if score $ready ${OBJECTIVE} matches 0 at @e[type=minecraft:marker,tag=${ORIGIN_TAG},limit=1] run function ${NAMESPACE}:setup_dispatch/root`,
                `execute if score $ready ${OBJECTIVE} matches 0 run scoreboard players add $setup_row ${OBJECTIVE} 1`,
                `execute if score $setup_row ${OBJECTIVE} matches ${this.height}.. run scoreboard players set $ready ${OBJECTIVE} 1`,
                `execute if score $ready ${OBJECTIVE} matches 1 run schedule clear ${NAMESPACE}:setup_tick`,
                `execute if score $ready ${OBJECTIVE} matches 1 run tellraw @a {"text":"BadApple screen setup complete."}`,
                `execute if score $ready ${OBJECTIVE} matches 1 if score $autostart ${OBJECTIVE} matches 1 run function ${NAMESPACE}:play`,
            ],
        };

        if (this.macroStorage) {
            files.macro_lookup = [
                `$function ${NAMESPACE}:macro_apply with storage gugle:video current.$(CustomName)`,
            ];
            files.macro_apply = [
                `$function ${NAMESPACE}:macro_state/$(s)`,
            ];
        }

        for (const [name, commands] of Object.entries(files)) {
            await writeFile(
                path.join(this.temporaryRoot, `${name}.mcfunction`),
                `${commands.join("\n")}\n`,
                "utf8",
            );
        }
    }

    private async writeSetupChunks(): Promise<void> {
        for (let z = 0; z < this.height; z += 1) {
            const commands: string[] = [];
            for (let x = 0; x < this.width; x += 1) {
                const color = this.displayMode === "rgbw"
                    ? rgbwCushionColor(x, z)
                    : this.displayMode === "cushion-color" ? "black" : undefined;
                const colorNbt = color ? `,color:"${color}"` : "";
                const macroNameNbt = this.macroStorage
                    ? `,CustomName:'"p_${x}_${z}"'`
                    : "";
                const uuid = this.uuidEntities
                    ? this.pixelUuids[z * this.width + x]
                    : undefined;
                const uuidNbt = uuid ? `,UUID:${uuid.nbt}` : "";
                commands.push(
                    `summon minecraft:cushion ~${x} ~2.26 ~${z} ` +
                        `{Tags:["${PIXEL_TAG}"]${colorNbt}${macroNameNbt}${uuidNbt}}`,
                );
                if (
                    this.displayMode === "cushion-color" &&
                    !this.macroStorage &&
                    !this.uuidEntities
                ) {
                    const cushionSelector =
                        `@e[type=minecraft:cushion,tag=${PIXEL_TAG},sort=nearest,limit=1,distance=..0.1]`;
                    commands.push(
                        `execute positioned ~${x} ~2.26 ~${z} as ${cushionSelector} ` +
                            `run scoreboard players set @s ${PIXEL_X_OBJECTIVE} ${x}`,
                        `execute positioned ~${x} ~2.26 ~${z} as ${cushionSelector} ` +
                            `run scoreboard players set @s ${PIXEL_Z_OBJECTIVE} ${z}`,
                    );
                }
            }
            await writeFile(
                path.join(this.temporarySetupChunkRoot, `${z}.mcfunction`),
                `${commands.join("\n")}\n`,
                "utf8",
            );
        }
    }
}
