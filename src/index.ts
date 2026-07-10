import * as fs from 'node:fs';

const FUNCTION_PATH = "./datapack/data/gugle/function/";

function writeFileSync(path: string, data: string) {
    if (fs.existsSync(path)) {
        fs.writeFileSync(path, data)
    } else {
        fs.appendFileSync(path, data)
    }
}

function setup(width: number, height: number) {
    const SETUP_PATH = FUNCTION_PATH + 'setup.mcfunction'
    const FILL_COMMAND = `fill ~ ~2 ~ ~${width - 1} ~2 ~${height - 1} minecraft:redstone_lamp`
    writeFileSync(SETUP_PATH, FILL_COMMAND + '\n')
    for (let i = 0; i < width; i++) {
        for (let j = 0; j < height; j++) {
            const SUMMON_COMMAND = `summon minecraft:cushion ~${i} ~2.26 ~${j}`
            fs.appendFileSync(SETUP_PATH, SUMMON_COMMAND + '\n')
        }
    }
}

function remove(width: number, height: number) {
    const REMOVE_PATH = FUNCTION_PATH + 'remove.mcfunction'
    const FILL_AIR_COMMAND = `fill ~ ~2 ~ ~${width - 1} ~2 ~${height - 1} minecraft:air`
    const KILL_COMMAND = `kill @e[type=minecraft:cushion]`
    writeFileSync(REMOVE_PATH, FILL_AIR_COMMAND + '\n')
    fs.appendFileSync(REMOVE_PATH, KILL_COMMAND + '\n')
}

function main() {
    const WIDTH = 16 * 8;
    const HEIGHT = 16 * 6;
    setup(WIDTH, HEIGHT)
    remove(WIDTH, HEIGHT)
}

main()
