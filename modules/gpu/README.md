# svg-gpu

Draws SVG display lists on the GPU through [graphics-gpu-scene](https://github.com/silk-lang/lib-graphics/tree/main/modules/gpu_scene).
Dependents import it as `svg_gpu`.

```silk
import svg_gpu.scene as svgGpu

// `list` comes from svg_render.lib.record; `view` is an RGBA8Unorm texture of the list's size.
let lowering = run svgGpu.render(&mut renderer, &device, &queue, &list, &view)
```

`record(&list, &mut scene)` fills a `gpu_scene.Scene` without drawing it, so the scene can be
drawn more than once or inspected.

## How a display list lowers

`svg_raster.lower` walks the display list the way the CPU executor does. Coverage is still
computed on the CPU, with the same paths, strokes, clip planes and tolerances, so the strips the
GPU paints are the strips the CPU paints. Paints and layers go to a canvas
(`svg_raster.canvas`), and `SceneCanvas` here forwards them to the scene:

| Display list | On the canvas |
| --- | --- |
| Fills and strokes, including dashes, `crispEdges` and projective clip planes | Coverage runs with a solid, gradient or image paint |
| Patterns and pixelated image expansion | Tiles rendered on the CPU once per size, painted as images |
| Groups with opacity and any blend mode | `pushLayer` and `popLayer` |
| Clip paths | A mask from the CPU clip coverage, applied when the group composites |
| Alpha and luminance masks | `popMask`, intersected with the group's clips |

What the canvas cannot express runs on the CPU executor and is drawn as one image:

- each filter and each embedded SVG image, on its own;
- linearRGB painting and compositing, linearRGB luminance masks and composited CSS mask layers,
  through their innermost enclosing group with normal blending and sRGB compositing;
- the whole list when no such group exists, or when a filter reads the backdrop
  (`BackgroundImage`).

`Lowering` reports how many ranges ran on the CPU, whether the whole list did, and how many
masks were made.

## Exactness

`svg_raster.lower.PixmapCanvas` is the CPU model of the GPU canvas, built from `vector.layer`.
The GPU matches it byte for byte (gradients may land on a neighbouring ramp entry in f32, within
2 levels). The model matches the CPU executor byte for byte, except that a group with clips or
masks is scaled once at composite time rather than once per clip and mask, which can round one
level differently per mask. On the reftest inputs every render is currently byte-identical.

## Tests

From the repository root, with a Vulkan, Metal or D3D driver (CI uses lavapipe):

```sh
silk task test-gpu            # every suite
silk task test-gpu painting   # some suites
```

Windows GPU builds invoke the pinned lib-native package's `prepare-windows`
Silk task to provision imports and stage runtime DLLs.

It renders every input under `modules/tests/fixtures/<suite>/inputs` with the CPU executor,
the CPU model and the GPU, and prints the inputs that differ. The unit tests in
`modules/render/src/lower_tests.silk` compare the model with the CPU executor without a GPU.
The check runs in the `svg-gpu` CI workflow.

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `modules/gpu` | `svg-gpu` | `SceneCanvas`, `record` and `render` |
| `modules/gpu/tests` | `svg-gpu-tests` | The CPU and GPU comparison over the reftest inputs |
