schedule clear gugle:tick
schedule clear gugle:setup_tick
scoreboard players set $playing gugle_badapple 0
scoreboard players set $frame gugle_badapple 0
scoreboard players set $render gugle_badapple 0
scoreboard players set $setup_row gugle_badapple 0
scoreboard players set $ready gugle_badapple 0
scoreboard players set $autostart gugle_badapple 0
execute at @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run fill ~ ~1 ~ ~127 ~1 ~95 minecraft:air
execute at @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run fill ~ ~2 ~ ~127 ~2 ~95 minecraft:air
kill @e[type=minecraft:cushion,tag=gugle_badapple_pixel]
kill @e[type=minecraft:marker,tag=gugle_badapple_origin]
