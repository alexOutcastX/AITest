# Neon Block City

A playable voxel city diorama in the style of the isometric neon-noir reference:
a floating slab in a dark void, blocky buildings with glowing windows, neon
marquees and pseudo-kanji banners, red lanterns, rooftop antennas with blinking
beacons, a CRT-TV rooftop prop — plus walking NPCs and car traffic with working
traffic lights that cars actually obey (they also brake for pedestrians and for
you).

## Play

Serve the repo root (ES modules need HTTP) and open `/city/`:

```sh
npx serve .            # or: python3 -m http.server 8000
# then visit http://localhost:8000/city/
```

No build step, no network dependencies — Three.js is vendored in `city/lib/`.

## Controls

| Input            | Action                     |
| ---------------- | -------------------------- |
| WASD / arrows    | Move (camera-relative)     |
| Q / E            | Rotate camera 90°          |
| Mouse wheel      | Zoom                       |
| Touch joystick   | Move (shown on mobile)     |

## Tech notes

- Three.js orthographic isometric camera + UnrealBloom for the neon glow.
- All static geometry is batched into two `InstancedMesh`es (lit voxels and
  emissive voxels), so the whole city is a handful of draw calls.
- Signs are generated `CanvasTexture`s (pixel text and procedural glyph
  columns, so no CJK font is required).
- Traffic: lane-following cars with a shared light cycle per intersection,
  car-following gaps, and pedestrian braking. NPCs walk sidewalk loops around
  their blocks.
- The city layout is seeded, so everyone sees the same city.
