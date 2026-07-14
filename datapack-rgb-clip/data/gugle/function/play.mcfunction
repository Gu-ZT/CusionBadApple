schedule clear gugle:tick
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run scoreboard players set $frame gugle_badapple 0
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run scoreboard players set $render gugle_badapple 0
scoreboard players set $autostart gugle_badapple 0
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run scoreboard players add $starts gugle_badapple 1
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run scoreboard players set $playing gugle_badapple 1
execute if entity @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run function gugle:tick
