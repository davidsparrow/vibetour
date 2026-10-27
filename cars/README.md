# Cars

The cockpit layer for video journeys: one folder per car, drawn over a pack's footage plates. Packs ship plates only. Cars come from here, work with every pack, and the user picks one. See [The cockpit layer](../docs/journey-video-standard.md#the-cockpit-layer) in the Journey Video Standard.

VibeTour can't play video packs yet, so nothing in the app reads this folder. Today the footage tools use it: [tools/footage/composite.sh](../tools/footage/README.md) composites any plate with a car.

| Car | Look |
| --- | --- |
| [`grand-tourer`](grand-tourer/car.json) | Cognac and ivory nappa leather with contrast stitching, polished walnut burl, knurled metal, a wood-and-leather wheel, a hooded twin-dial cluster and a tall screen in the centre of the dash for the radio. A slim rear-view mirror hangs from the top edge of the frame, so the view is mostly view. The default car. Since 27 October the driver wears dark leather driving gloves and charcoal sleeves, so no skin shows. |
| [`grand-tourer-no-hands`](grand-tourer-no-hands/car.json) | The same car with nobody at the wheel: the hands and forearms are edited out, the rim is whole. Pick it with `CAR=cars/grand-tourer-no-hands`. |
| [`touring-sedan`](touring-sedan/car.json) | Tan saddle leather, open-pore walnut, brushed aluminium and a backlit three-dial cluster. The first car, from the October 2026 bake-off; its mirror console covers a large part of the view. |

## What a car folder holds

| File | What it is | Made by |
| --- | --- | --- |
| `cockpit.png` | The generated still, 1200×896 (4:3). Every pane of glass is flat `#00FF00`. | An image model, from the cockpit prompt |
| `cabin.png` | The same still with the wheel, hands and arms removed | An image-model edit of `cockpit.png` |
| `wheel.png` | The wheel-and-hands cutout, with alpha, that rotates about the hub | `car-build.sh` |
| `glass-mask.png` | The windshield, white on black, for the bloom | `car-build.sh` |
| `mirror-mask.png` | The mirror glass, white on black, filled with the road behind | `car-build.sh` |
| `side-window-mask.png` | The driver's side window, white on black: the keyed glass that is neither the windshield nor a mirror | `car-build.sh` |
| `glass-dirt.png` | Dust, smudges and wiper arcs on the windshield, lit by bright light behind the glass | `car-build.sh` |
| `car.json` | Id, name, size, hub, wheel region, mirror boxes, key settings, and the model and prompts that made the stills | By hand |

In `car.json`:

- `hub` is the wheel's centre in cockpit pixels. The plate's vanishing point sits over it.
- `wheel.radius` is the wheel's radius about the hub. `wheel.offset` moves the wheel and hands down (or up, if negative) by that many pixels in the composite: the touring sedan's rim touched the windshield's bottom seal in the still, so its wheel sits 16 px lower and shows whole below the dash line. The cutout takes what differs between the two stills and connects to the wheel, so the hands and forearms come out whole.
- `cluster` is the instrument cluster's box, `[x, y, w, h]`. It keeps its glow when the cabin darkens for night. `lit` lists more boxes that stay backlit (small gauges, a switch row): a dashboard that goes dark at night looks wrong at once.
- `wipers` are the two wiper pivots below the glass, in cockpit pixels, the arms' `reach`, the `park` angle above horizontal and the `sweep`, both in degrees. The glass dirt and the rain layer use them.
- `mirrors` are the glass boxes as `[x, y, w, h]`. The masks come from the boxes (the keyed glass inside them), so a mirror may touch the frame's edge: the door mirror does, and the grand tourer's rear-view mirror hangs from the top edge with half of it in frame.
- `dials` (optional) gives the speedometer and rev counter: each dial's `centre`, the angle of `zero` clockwise from 12 o'clock, the `sweep` in degrees and the full-scale `max`, plus the `needle` length in pixels. Inpaint the painted needles out of `cabin.png` first (both at zero: a 7 px line from the centre along the zero angle, `cv2.inpaint`), and the composite draws live ones that follow the clips. Leave gauges that read a fixed value painted, or draw them on a screen (the grand tourer's water temperature is on the cluster's centre display).
- `screens` (optional) are the glass of the `console` screen, where the radio's face goes, and the `cluster`'s centre display, as `[x, y, w, h]`. The app draws into them; the footage tools draw a stand-in (`tools/footage/headunit.py`). Put the console screen inside the 16:9 crop (the top 675 rows) and clear of the right hand: the grand tourer's head unit sat below the crop, so an image edit of the cabin replaced the burl panel and three small gauges with a screen (the prompt is `source.screenEdit`).
- `key` is the chroma key: colour, similarity and blend.
- `source` records the model, the date and both prompts.

## Adding a car

1. Generate `cockpit.png` with the cockpit prompt in the standard, at 4:3. Gemini 3.1 Flash Image returns 1200×896, the size the tools expect. Name the materials and the light. Keep the camera square to the car with the wheel hub at the horizontal centre.
2. If the mirror came out down the glass on a console, hang it from the top edge: `tools/footage/mirror.py cockpit.png cockpit.png 0.5` (it needs a dark bezel round its glass to be found). Generating at 2K and downscaling to 1200×896 gives a crisper car for the same workflow; keep the 2K stills outside the repo for the 1080p release.
3. Generate `cabin.png` as an edit of it. The prompt is in [`grand-tourer/car.json`](grand-tourer/car.json). The edit may re-render the glass with faint ghost lines; copy the cockpit's keyed glass pixels into the cabin.
4. Write `car.json`: find the hub, the wheel's radius, the cluster, the wiper pivots, the mirror boxes and the screens in the still. If the car has no screen inside the frame for the radio, edit one into the cabin first. `wheel.py` prints the rim's fitted centre, which is the hub.
5. Run `tools/footage/car-build.sh cars/<id>` (it needs OpenCV; see the tools README). Read its warnings: missing hand pixels, or a rim fill, mean the matte needs a look.
6. Composite a few plates with `CAR=cars/<id>`, straight and at ±12.5° of steering, and look at them before you commit the car. Look at the wheel cutout on a plain background too: a bite out of the rim only shows when the wheel turns.

Cars stay unbranded. A real maker's badge or logo is trademark use.
