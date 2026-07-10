# CusionBadApple

Converts a video into a Minecraft datapack that drives a redstone-lamp screen at
20 frames per second (one frame per game tick).

## Generate

Install dependencies, put exactly one video in `input/`, then run:

```powershell
pnpm install
pnpm start -- --mode binary
```

Floyd-Steinberg dithering is also available:

```powershell
pnpm start -- --mode dither
```

The default screen is 128 by 96 blocks. Run `pnpm start -- --help` for threshold,
size, inversion, explicit input path, and test-frame options. The converter keeps
the source aspect ratio and pads unused screen space with black.

## Use in Minecraft

Copy/install the generated `datapack/` in a world, then run these functions:

```mcfunction
/function gugle:setup
/function gugle:start
/function gugle:restart
/function gugle:pause
/function gugle:resume
/function gugle:stop
/function gugle:status
/function gugle:remove
```

`start` is idempotent while the video is playing, so repeated button or command
block triggers do not jump back to frame zero. Use `restart` when an intentional
restart is needed. `status` prints the current frame, playing state, and restart
count.

Run `setup` at the lower north-west corner of the screen. The screen occupies
positive X and positive Z, with redstone blocks at Y+1 and lamps at Y+2.

Frame functions contain only pixels that changed since the previous frame.
Adjacent changes are combined into two-dimensional `fill` rectangles to reduce
command count. `setup` also raises `max_command_forks` and
`max_command_sequence_length` so busy frames cannot cut off the next scheduled
tick.
