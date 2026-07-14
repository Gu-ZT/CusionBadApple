execute if score $ready gugle_badapple matches 0 run scoreboard players set $autostart gugle_badapple 1
execute if score $ready gugle_badapple matches 0 run tellraw @s {"text":"Screen setup in progress; playback queued."}
execute if score $ready gugle_badapple matches 1 unless score $playing gugle_badapple matches 1 run function gugle:restart
