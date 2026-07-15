scoreboard players set $playing gugle_badapple 0
scoreboard players set $frame gugle_badapple 0
schedule clear gugle:tick
execute as @e[type=minecraft:cushion,tag=gugle_badapple_pixel] run data modify entity @s color set value "black"
execute at @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run fill ~ ~2 ~ ~127 ~2 ~95 minecraft:stone
