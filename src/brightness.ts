export const BRIGHTNESS_TIERS = [
    { level: 0, block: "minecraft:stone" },
    { level: 3, block: "minecraft:magma_block" },
    { level: 4, block: "minecraft:oxidized_copper_bulb[lit=true]" },
    { level: 6, block: "minecraft:sculk_catalyst[bloom=true]" },
    { level: 7, block: "minecraft:respawn_anchor[charges=2]" },
    { level: 8, block: "minecraft:weathered_copper_bulb[lit=true]" },
    { level: 9, block: "minecraft:redstone_ore[lit=true]" },
    { level: 10, block: "minecraft:crying_obsidian" },
    { level: 11, block: "minecraft:respawn_anchor[charges=3]" },
    { level: 12, block: "minecraft:exposed_copper_bulb[lit=true]" },
    { level: 13, block: "minecraft:furnace[lit=true]" },
    { level: 15, block: "minecraft:copper_bulb[lit=true]" },
] as const;

export function nearestBrightnessTier(value: number): number {
    const targetLevel = Math.max(0, Math.min(255, value)) / 255 * 15;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < BRIGHTNESS_TIERS.length; index += 1) {
        const distance = Math.abs(targetLevel - BRIGHTNESS_TIERS[index].level);
        if (distance < nearestDistance) {
            nearestIndex = index;
            nearestDistance = distance;
        }
    }

    return nearestIndex;
}
