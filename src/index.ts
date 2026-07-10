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
    const SCOREBOARD_COMMAND = "scoreboard objectives add gugle_badapple dummy"
    writeFileSync(SETUP_PATH, FILL_COMMAND + '\n')
    fs.appendFileSync(SETUP_PATH, SCOREBOARD_COMMAND + '\n')
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

function frame(width: number, height: number, frame: number, frames: number) {
    const FRAME_PATH = FUNCTION_PATH + `frame_${frame}.mcfunction`
    const _FRAME_PATH = FUNCTION_PATH + `_frame_${frame}.mcfunction`
    const SCOREBOARD_COMMAND = `scoreboard players set $pause gugle_badapple ${frame}`
    const NEXT_FRAME_COMMAND = `schedule function gugle:frame_${frame + 1} 1t`
    // setblock ~ ~ ~ minecraft:redstone_block
    for (let i = 0; i < width; i++) {
        for (let j = 0; j < height; j++) {
            // if(...)
            const SET_BLCOK_COMMAND = `setblock ~${i} ~1 ~${j} minecraft:redstone_block`
            fs.appendFileSync(_FRAME_PATH, SET_BLCOK_COMMAND + '\n')
        }
    }
}


function start() {
}


function pause() {
    //scoreboard players set $pause gugle_badapple 1
}


function stop() {
    //scoreboard players set $stop gugle_badapple 1
}

function main() {
    const WIDTH = 16 * 8;
    const HEIGHT = 16 * 6;
    setup(WIDTH, HEIGHT)
    remove(WIDTH, HEIGHT)
}

main()
