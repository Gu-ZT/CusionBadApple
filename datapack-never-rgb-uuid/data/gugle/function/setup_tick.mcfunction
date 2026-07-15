execute if score $ready gugle_badapple matches 0 run schedule function gugle:setup_tick 1t replace
execute if score $ready gugle_badapple matches 0 at @e[type=minecraft:marker,tag=gugle_badapple_origin,limit=1] run function gugle:setup_dispatch/root
execute if score $ready gugle_badapple matches 0 run scoreboard players add $setup_row gugle_badapple 1
execute if score $setup_row gugle_badapple matches 96.. run scoreboard players set $ready gugle_badapple 1
execute if score $ready gugle_badapple matches 1 run schedule clear gugle:setup_tick
execute if score $ready gugle_badapple matches 1 run tellraw @a {"text":"BadApple screen setup complete."}
execute if score $ready gugle_badapple matches 1 if score $autostart gugle_badapple matches 1 run function gugle:play
