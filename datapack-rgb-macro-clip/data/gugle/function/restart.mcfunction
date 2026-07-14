gamerule max_command_forks 65536
gamerule max_command_sequence_length 131072
schedule clear gugle:tick
data modify storage gugle:video current set value {}
execute as @e[type=minecraft:cushion,tag=gugle_badapple_pixel] run data modify entity @s color set value "black"
execute at @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run fill ~ ~2 ~ ~127 ~2 ~95 minecraft:stone
function gugle:play
