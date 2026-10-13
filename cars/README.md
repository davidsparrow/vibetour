# Cars

The cockpit layer for video journeys: one folder per car, drawn over a pack's footage plates. Packs ship plates only. Cars come from here, work with every pack, and the user picks one. See [The cockpit layer](../docs/journey-video-standard.md#the-cockpit-layer) in the Journey Video Standard.

VibeTour can't play video packs yet, so nothing in the app reads this folder. Today the footage tools use it: [tools/footage/composite.sh](../tools/footage/README.md) composites any plate with a car.

| Car | Look |
| --- | --- |
| [`touring-sedan`](touring-sedan/car.json) | Tan saddle leather, open-pore walnut, brushed aluminium and a backlit three-dial cluster. The first car, from the October 2026 bake-off. |

## What a car folder holds

| File | What it is | Made by |
| --- | --- | --- |
| `cockpit.png` | The generated still, 1200×896 (4:3). Every pane of glass is flat `#00FF00`. | An image model, from the cockpit prompt |
| `cabin.png` | The same still with the wheel, hands and arms removed | An image-model edit of `cockpit.png` |
| `wheel.png` | The wheel-and-hands cutout, with alpha, that rotates about the hub | `car-build.sh` |
| `glass-mask.png` | The windshield, white on black, for the bloom | `car-build.sh` |
| `mirror-mask.png` | The mirror glass, white on black, filled with the road behind | `car-build.sh` |
| `glass-dirt.png` | Dust, smudges and wiper arcs on the windshield, lit by bright light behind the glass | `car-build.sh` |
| `car.json` | Id, name, size, hub, wheel region, mirror boxes, key settings, and the model and prompts that made the stills | By hand |

In `car.json`:

- `hub` is the wheel's centre in cockpit pixels. The plate's vanishing point sits over it.
- `wheel.radius` is the wheel's radius about the hub. The cutout takes what differs between the two stills and connects to the wheel, so the hands and forearms come out whole.
- `cluster` is the instrument cluster's box, `[x, y, w, h]`. It keeps its glow when the cabin darkens for night.
- `wipers` are the two wiper pivots below the glass, in cockpit pixels, the arms' `reach`, the `park` angle above horizontal and the `sweep`, both in degrees. The glass dirt and the rain layer use them.
- `mirrors` are the glass boxes as `[x, y, w, h]`. The door mirror (`side`) touches the frame edge, so its mask comes from its box.
- `key` is the chroma key: colour, similarity and blend.
- `source` records the model, the date and both prompts.

## Adding a car

1. Generate `cockpit.png` with the cockpit prompt in the standard, at 4:3. Gemini 3.1 Flash Image returns 1200×896, the size the tools expect. Name the materials and the light. Keep the camera square to the car with the wheel hub at the horizontal centre.
2. Generate `cabin.png` as an edit of it. The prompt is in [`touring-sedan/car.json`](touring-sedan/car.json).
3. Write `car.json`: find the hub, the wheel's radius, the cluster, the wiper pivots and the mirror boxes in the still.
4. Run `tools/footage/car-build.sh cars/<id>` (it needs OpenCV; see the tools README).
5. Composite a few plates with `CAR=cars/<id>` and look at them before you commit the car.

Cars stay unbranded. A real maker's badge or logo is trademark use.
