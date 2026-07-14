gamerule max_command_forks 65536
gamerule max_command_sequence_length 65536
schedule clear gugle:tick
execute as @e[type=minecraft:cushion,tag=gugle_badapple_pixel] run data modify entity @s color set value "black"
execute at @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run fill ~ ~2 ~ ~127 ~2 ~95 minecraft:stone
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run scoreboard players set $frame gugle_badapple 0
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run scoreboard players set $render gugle_badapple 0
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run scoreboard players add $starts gugle_badapple 1
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run scoreboard players set $playing gugle_badapple 1
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run function gugle:tick
