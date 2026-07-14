execute as @e[type=minecraft:cushion,tag=gugle_badapple_pixel,scores={gugle_px=61,gugle_pz=11}] run data modify entity @s color set value "white"
execute as @e[type=minecraft:cushion,tag=gugle_badapple_pixel,scores={gugle_px=54..55,gugle_pz=20}] run data modify entity @s color set value "white"
execute as @e[type=minecraft:cushion,tag=gugle_badapple_pixel,scores={gugle_px=86,gugle_pz=31}] run data modify entity @s color set value "light_gray"
execute as @e[type=minecraft:cushion,tag=gugle_badapple_pixel,scores={gugle_px=60,gugle_pz=83}] run data modify entity @s color set value "purple"
setblock ~61 ~2 ~11 minecraft:respawn_anchor[charges=2]
setblock ~52 ~2 ~21 minecraft:exposed_copper_bulb[lit=true]
setblock ~34 ~2 ~61 minecraft:crying_obsidian
setblock ~67 ~2 ~63 minecraft:furnace[lit=true]
setblock ~74 ~2 ~87 minecraft:magma_block
