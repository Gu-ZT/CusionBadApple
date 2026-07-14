execute as @e[type=minecraft:cushion,tag=gugle_badapple_pixel,scores={gugle_px=116,gugle_pz=49}] run data modify entity @s color set value "white"
execute as @e[type=minecraft:cushion,tag=gugle_badapple_pixel,scores={gugle_px=120..123,gugle_pz=49}] run data modify entity @s color set value "black"
fill ~41 ~2 ~48 ~44 ~2 ~48 minecraft:crying_obsidian
setblock ~59 ~2 ~48 minecraft:exposed_copper_bulb[lit=true]
fill ~73 ~2 ~48 ~74 ~2 ~48 minecraft:exposed_copper_bulb[lit=true]
setblock ~76 ~2 ~48 minecraft:exposed_copper_bulb[lit=true]
setblock ~116 ~2 ~49 minecraft:magma_block
fill ~120 ~2 ~49 ~123 ~2 ~49 minecraft:stone
fill ~111 ~2 ~50 ~114 ~2 ~50 minecraft:crying_obsidian
