gamerule max_command_forks 65536
gamerule max_command_sequence_length 65536
scoreboard objectives add gugle_badapple dummy
function gugle:remove
scoreboard players set $playing gugle_badapple 0
scoreboard players set $frame gugle_badapple 0
scoreboard players set $render gugle_badapple 0
scoreboard players set $starts gugle_badapple 0
scoreboard players set $setup_row gugle_badapple 0
scoreboard players set $ready gugle_badapple 0
scoreboard players set $autostart gugle_badapple 0
summon minecraft:marker ~ ~ ~ {Tags:["gugle_badapple_origin"]}
fill ~ ~1 ~ ~127 ~1 ~95 minecraft:air
fill ~ ~2 ~ ~127 ~2 ~95 minecraft:stone
function gugle:setup_tick
