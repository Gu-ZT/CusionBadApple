export type Rgb3Channel = 0 | 1 | 2;
export type Rgb3Lamp = 0 | 1 | 2;
export type Rgb3Color = "red" | "green" | "blue";

export interface Rgb3Cell {
    channel: Rgb3Channel;
    lamp: Rgb3Lamp;
    color: Rgb3Color;
}

export const RGB3_LAMP_LEVELS = [15, 12, 8] as const;
export const RGB3_LAMP_BLOCKS = [
    "minecraft:copper_bulb[lit=true]",
    "minecraft:exposed_copper_bulb[lit=true]",
    "minecraft:weathered_copper_bulb[lit=true]",
] as const;

export const RGB3_LAYOUT: readonly Rgb3Cell[] = [
    { channel: 0, lamp: 0, color: "red" },
    { channel: 1, lamp: 2, color: "green" },
    { channel: 2, lamp: 1, color: "blue" },
    { channel: 1, lamp: 1, color: "green" },
    { channel: 2, lamp: 0, color: "blue" },
    { channel: 0, lamp: 2, color: "red" },
    { channel: 2, lamp: 2, color: "blue" },
    { channel: 0, lamp: 1, color: "red" },
    { channel: 1, lamp: 0, color: "green" },
];

export function rgb3Cell(x: number, z: number): Rgb3Cell {
    return RGB3_LAYOUT[z % 3 * 3 + x % 3];
}
