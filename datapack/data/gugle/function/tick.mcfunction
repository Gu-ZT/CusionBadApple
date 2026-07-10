execute if score $playing gugle_badapple matches 1 if score $frame gugle_badapple matches 0..4380 at @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run function gugle:dispatch/root
execute if score $playing gugle_badapple matches 1 run scoreboard players add $frame gugle_badapple 1
execute if score $playing gugle_badapple matches 1 if score $frame gugle_badapple matches 4381.. run scoreboard players set $playing gugle_badapple 0
execute if score $playing gugle_badapple matches 1 run schedule function gugle:tick 1t replace
