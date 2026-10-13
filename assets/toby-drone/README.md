# Toby companion drone

Original editable industrial drone: cast gunmetal chassis, ochre enamel covers, twin guarded lift ducts, comically small hydraulic tool arms, an oversized crooked CRT head, recessed phosphor display, fasteners, cables, chipped edges, repair straps and mismatched bent aerials. It measures about 1.58 tiles across the lift housings. No Factorio art is copied into these files.

`toby.blend` contains separate editable parts, materials, camera, lighting and a packed animated screen texture. Timeline markers identify seven eight-frame expression clips: idle 1–8, inspecting 9–16, thinking 17–24, working 25–32, speaking 33–40, success 41–48, error 49–56. The body faces -Y. `screen-source.png` is the editable expression sheet; `finish.py` regenerates its shapes. The moving/working state shares the working display; runtime movement supplies translation.

## Game assets

Use `manifest.json` as the machine-readable contract. Each state PNG is 1024×2048, with eight 128×128 frames across and sixteen clockwise directions down, beginning north. Use `scale=0.5`, `line_length=8`, `frame_count=8`, `direction_count=16`, `shift={0,-0.28428}`. Suggested animation speed is `8/60` for idle and `12/60` for other states. State animation changes the screen only; a deliberate fixed chassis keeps the sprite stable while the game controls movement. Add mechanical animation when the runtime has distinct movement/tool actions to drive it.

The shared `sprites/shadow.png` is 128×2048: 128×128 cells, `line_length=1`, `frame_count=1`, `direction_count=16`, `scale=0.5`, `shift={0.25,0.16385}`, `draw_as_shadow=true`. It is projected from evaluated model geometry with a fixed light direction, softened and given 34% alpha. The shadow camera is recentered to preserve transparent margins. Shadows belong on the ground; do not apply the drone's hover height to them.

`sprites/icon.png` is 64×64. The screen is physically hidden behind the head in rear directions. It is visible in directions 4–12 and clearest in 5–11. Screen colors communicate status without relying on color alone: uneven googly eyes and a crooked grin, a magnified inspecting eye, confused eyes above a progressive design diagram, clenched working teeth with falling coolant, an animated speaking mouth, a delighted grin, and orange crossed-out error eyes.

## Reproduce

Requirements: Blender 5.2+ and `uv`. From this repository:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python assets/toby-drone/build_model.py
uv run --script assets/toby-drone/finish.py
/Applications/Blender.app/Contents/MacOS/Blender --background assets/toby-drone/toby.blend --python assets/toby-drone/render_hero.py
```

`screen-source.png` is already tracked and gets packed into the model. When changing expression artwork, run `finish.py` before `build_model.py` so the new texture is packed, then run `finish.py` again for final atlases. Source scripts use deterministic authored geometry and fixed render settings.

The exaggerated head is 62% wider and 35% taller than the original, seated low on the same medium chassis so every heading fits the existing cell and runtime shifts. `build_model.py -- --preview-only` saves the editable model and renders a large preview before generating the direction sheets.

Final sprites use Cycles physical orthographic rendering at 64 pixels/tile, 32 samples, AgX, transparent backgrounds and no pixel palette reduction. Their screen planes are projected from the authored 3D corners, then composited without changing the body rendering. `spriteforge.json` records the separate required Spriteforge preview check, which uses its oblique/palette renderer. That preview is a pipeline check; it is not the shipped Factorio projection.

## Verification and previews

`native-preview.png` shows all sixteen headings and every front-facing expression frame at native cell resolution. `expressions-native.png` shows one 128px frame per state in a compact grid; `expressions-4x.png` enlarges that grid with nearest-neighbor sampling. `native-south.png` is one native frame; `preview-4x.png` is nearest-neighbor enlargement; `states.gif` cycles through the seven clips. `model-preview.png` renders the actual editable Blender source at 768×768.

The native contact sheet, enlarged model and front-state frames were visually reviewed. Export validation checks 896 state cells, 16 shadow cells, expected dimensions, alpha margins, expression variation and artifact hashes. The Spriteforge preview also passed its crop/palette validation. This verifies generated assets, not live Factorio integration or user visual acceptance. No live server or save was modified by the asset build.
