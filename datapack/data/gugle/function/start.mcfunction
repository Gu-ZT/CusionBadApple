schedule clear gugle:tick
execute at @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run fill ~ ~1 ~ ~127 ~1 ~95 minecraft:air
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run scoreboard players set $frame gugle_badapple 0
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run scoreboard players set $playing gugle_badapple 1
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run function gugle:tick
