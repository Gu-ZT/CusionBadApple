execute if score $playing gugle_badapple matches 1 run schedule function gugle:tick 1t replace
execute if score $playing gugle_badapple matches 1 run scoreboard players operation $render gugle_badapple = $frame gugle_badapple
execute if score $playing gugle_badapple matches 1 run scoreboard players add $frame gugle_badapple 1
execute if score $playing gugle_badapple matches 1 if score $render gugle_badapple matches 0..1142 at @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run function gugle:dispatch/root
execute if score $playing gugle_badapple matches 1 if score $frame gugle_badapple matches 1143.. run scoreboard players set $playing gugle_badapple 0
execute unless score $playing gugle_badapple matches 1 run schedule clear gugle:tick
