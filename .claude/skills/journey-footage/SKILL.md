---
name: journey-footage
description: Make realistic driving footage for a VibeTour video Journey Pack (a "tour" or "journey"), from route research to anchor stills, video clips and cockpit review. Use when someone wants to create, extend or retake a video journey, generate anchor stills or plates, add variants (sunset, night, rain), or make tour footage look more real-world.
---

# Journey footage

The standard operating procedure for making the footage of a video Journey Pack that looks like a real drive. It follows [the Journey Video Standard](../../../docs/journey-video-standard.md), which holds the rules and the reasons. This skill holds the order of work, the commands and the prompt kit ([prompts.md](prompts.md)).

What the user sees is three layers: the **plate** (footage through the glass, from a video model), the **cockpit** (a car from `cars/`, composited on top) and the instruments. A pack ships plates only. Nothing of our own car is ever in a plate.

## Before you start

- Tools: `ffmpeg`, Python 3.9+ with Pillow, and a venv with `numpy` and `opencv-python-headless`. Pass its python to the shell scripts as `PYTHON=…`.
- Keys in `.env.local` (gitignored): `OPENROUTER_API_KEY` for stills and most video models, `HEYGEN_API_KEY` for HeyGen's cheaper direct price. Export them as `OR` and `HG`.
- Budget. Stills cost about 10 US cents each at 2K; clips cost 1.5 to 9 cents a second (the standard's model table). An OpenRouter key refuses image and video requests once less than one dollar is left under its own limit, and the account's credit is a second limit, so check both (`GET https://openrouter.ai/api/v1/key` and `/api/v1/credits`) before a batch. Ask the user to raise the limit or top up if needed.
- Prices in this file are written without a dollar sign, because Claude Code reads a dollar sign before a digit as an argument placeholder.
- Ask the user before spending on a batch, and report what each step cost.

## 1. Plan the journey

Write a short bible: the route, 3–5 scenes, and for each scene its stretches.

- Tag each stretch **town**, **edge of town**, **country** or **wild road**. Each has its own world detail (the standard's [World detail](../../../docs/journey-video-standard.md#world-detail) table).
- Pick **one scenic overlook** for the tour: a busy pullout facing the view, not a rest stop. It is the pack's main stop set.
- Pick at most **one set piece**, such as a breakdown on the shoulder, as a cruise clip the player shows once.
- Decide the **variants** (midday, before sunset, sunset, night in town, night road, rain). Each needs its own anchors.
- Write the **region kit**: the vehicles, activities, animals, plants and sign system of the place. On the California coast, for example: surf vans and racks, a few motorcycles, Caltrans green signs, the Route 1 shield.
- Collect **sign references** for the region, to read and to quote from. They are for you, not for attaching to prompts.
- Plan rates across the cruise clips. 1–4 in 10 have an oncoming vehicle pass by day. Most night clips have oncoming headlights. A house or farm comes every few clips in the country. None of these apply in empty places: a desert, Iceland's interior, the Moon.

## 2. Anchors

One master still per scene, then every other still made *from* it with reference input, so the light holds.

```bash
. prompts.sh   # your copy of the blocks in prompts.md, filled in for the region
AR=4:3 SIZE=2K python3 -I tools/footage/gen_image.py google/gemini-3.1-flash-image "$PROMPT" anchors/<name> [ref.png…]
```

- Generate at **4:3 and 2K**, with the horizon at the centre. Models put it there whatever you ask.
- Build each prompt from the kit: place, look, lane, world detail for the stretch, signs, people, realism, frame. **Change the world detail and the wear in every still.** A shared sentence repeats the same detail in the same place in every frame.
- Quote every legible word on a sign exactly, keep it short, and name its colours. Put signs about 150 m down the road and small in the frame: a sign close on the right ends up behind the rear-view mirror, and one close on the left behind the A-pillar.
- A distance sign faces the way we drive: the places ahead, nearest first, with true distances from where it stands (look them up; a northbound sign on a southbound drive is the first thing a local notices). It must start far enough off to be read for about five seconds. The model can't keep text that small, so remove its sign with an edit, paste ours (`tools/footage/sign.py paste`), and after the clip is made redraw the face (`sign.py fix`).
- Other signs work the same way (`KIND` in `sign.py`: guide, park, services, regulatory, shop, gas, lawyer, tourism). Put a name on a sign only where a real one would carry it: distance, vista point and landmark signs, a town's limit, the odd shop named for its town; and keep every name in step with the pack (waypoints, stops, the Nav map, the stop pill). Billboards stand only where real ones do (freeways near towns; never on a scenic highway like Big Sur's): ask the still for a blank, far, small billboard ("only about one twelfth of the frame's width, its top edge only a little above the treetops"), put our artwork on its face (`sign.py quad`) and paint out the model's operator plate. Paste signs farther than looks right: the model drives up faster than the posts suggest, and a sign pasted 30 m off passes in under 3 s.
- A sign the model drew itself and garbled can be repainted without a retake: `sign.py fix` with the sign's box in any frame it shows (and `first`, where it appears). A stop clip that is not remade takes its sign with `sign.py place`: start it in the clip where the scene is clearest (the pump hold), chain it clip to clip from the position each run prints, and run a clip reversed to carry it back to its start. Watch every sign's exit at four frames a second: a face that slips off its board or stays behind is worse than the model's own for a moment.
- Anything moving our way in our lane is something the video must overtake. Put walkers and cyclists on the far side, facing us, or stopped.
- Put the SEAT block in **every** still, not only stops: asked for "the driver's eye height" alone, the model sits about 1.8 m up and the car looks down on the roofs of parked cars. The 14 October remake of the California Coast stills (`gen_low.sh` in the pack) took each old still as the reference with "only the camera height changes".
- For a stop still (gas station, overlook), say where the car is parked and what fills the bottom of the frame ("gravel right up to the fence; no road in front of us"). Otherwise the model may park you across the road. Say the camera height too, with the SEAT block in [prompts.md](prompts.md): without it the camera sits about 2.5 m up, looking down on the parked cars, and the car looks as if it hovers. Put the stop's centre (the pumps and the shop, the bridge) in the middle of the frame, or it ends up behind the A-pillar through the cockpit.
- For a landmark, curve the road away from it so its side shows. A road that runs straight onto a bridge shows only the deck.
- A low sun meant to be seen goes just right of where the road disappears, not far right, where the rear-view mirror hides it.
- For a variant, attach the place's still, but say the light and weather come from the prompt. To join two variant stills (rain on the road, then rain in town), make the second from the first.

## 3. Check every still before animating it

```bash
python tools/footage/vp.py anchors/<name>.png plates/<name>.png 1920x1080          # crop 16:9, horizon at 45%
CENTRE=1 python tools/footage/vp.py anchors/<stop>.png plates/<stop>.png 1920x1080  # stop stills
python tools/footage/deorb.py in.png out.png <x,y,r> …                              # paint out flare orbs
CABIN=1 tools/footage/still.sh plates/<name>.png review/<name>.png                  # through the cockpit (CAR=cars/<id> picks the car; default grand-tourer)
```

Use the variant's cabin light: 1 at midday, 0.75 before sunset, 0.45 at sunset, 0.6 in rain, 0.35 at night (the cluster and the car's `lit` boxes keep their backlight). Look at each still **through the cockpit**, at full size, and retake it if it has:

- an empty, clean or symmetrical world, or a postcard look
- the wrong lane, or a car close ahead in our lane by day
- garbled text, a real brand, or a sign hidden behind a pillar or the mirror
- flare orbs (paint them out instead, if the sky around them is clear)
- the sun blown out to a huge disc, or hidden behind the rear-view mirror when it's meant to be seen
- people posing or running, or anyone in the road

Then count the oncoming vehicles across each scene's cruise stills. Image models put one in most lived-in stills; by day the rate is 1–4 in 10 outside towns. Edit the extras out instead of regenerating (`REFMAX=2400`, the still as its only reference): "Remove the dark car driving toward the camera … Keep everything else exactly as it is, pixel for pixel." Remove any detail that repeats from still to still the same way.

Show the user labelled contact sheets of the stills, bare and in the cockpit, before any clip is made.

## 4. Clips

Pick the model per slot family from the standard (`cruise` on HeyGen or Veo 3.1 Lite, stops and holds on Seedance 2.0 Fast). Start each clip from its 16:9 crop. For a `stop-in`, also give Seedance the stop still as the last frame, so the pull-in lands where the hold starts; give a hold the stop still as both frames, so it loops. **Do not generate a pull-in or a pull-out.** Video models swing the camera round on the spot instead of driving an arc, and the car floats. Cut the stop instead: `tools/footage/ramp.py <approach clip> <out> stop 4` slows the approach to a crawl, the dissolve lands on the hold, and `ramp.py <next cruise clip> <out> start 4` picks the road up from a crawl. Each ramped clip carries a `.speed.csv` that drives the dials. Generate only straight moves at a stop (a creep forward to the pump) and holds. A stop right beside the road (a gas station's forecourt) can be driven as a lane change instead: ease one car width off the lane, straighten, stop parallel to the road (the standard's recipe; `stops-side` in the California Coast pack). Make its parked still as an edit of the approach still that moves the camera forward and over, never a fresh generation, which angles the car towards the stop. Give a straight move its speed track with `tools/footage/speed.py <clip> <metres>`, or the dials read cruise speed through it. If you must try a pull-in anyway: in a `stop-in`, say how far the car turns ("through about forty degrees to the right"), that it never slides sideways or backwards, and add the SEAT line; the first gas-station pull-in floated sideways to reach a stop still taken from too high. In a `stop-out`, name what is parked in front of us and say we drive round it. For a variant with the sun in frame, composite with `FLARE=0.8`. For a transition, chain two Veo shots (the second starting on the first's last frame) and give neither the next scene's still: describe the change and let the dissolve join it. Look for cross-fades at four frames a second, since a 1 fps strip can miss them, and trim before one rather than keep it.

Write clip prompts from the clip block in [prompts.md](prompts.md). Every clip prompt needs these:

- **What keeps coming**, not just what's in the start frame. The life in the anchor passes in two seconds, and the model fills the road beyond with emptiness unless told otherwise.
- **Traffic as events**: "the oncoming camper van in the opposite lane on our LEFT keeps to its lane and passes us on the left".
- **Things that must not happen**: parked things stay parked, nothing fades in or out, signs keep their text, nobody runs, no lens flare or orbs, nothing of our own car.
- **An empty opposite lane**, said outright, in every clip whose still has no oncoming traffic, so the model doesn't add some.

Submit and poll with `tools/footage/submit.py` and `poll.py` (edit `SHOTS`), or the same calls in a small script. Download as soon as each finishes.

## 5. Review clips through the cockpit

```bash
CABIN=<level> PYTHON=<venv python> tools/footage/session.sh review/<name>.mp4 out/<clip>.mp4 [more clips…]
ffmpeg -i out/<clip>.mp4 -vf "fps=1,scale=480:-1,tile=4x2" -frames:v 1 strip.png   # contact strip
```

First run `python tools/footage/drift.py out/*.mp4`: it fails any clip whose camera turns away from the road (video models like to turn towards the view, and through a cockpit that looks like the car leaving the road). Retake a failing clip with the clip block's "the camera is fixed to the car and always faces straight along the road" sentence and a new seed, or trim it to the passing stretch it prints. Then `session.sh` dissolves the clips, derives the steering track and the mirror feed, and composites. For rain, add `RAIN=900`: drops run down the windshield and the wipers clear them (`rain.py`), and the side window and both mirrors get wet (`glass.py`; `WET=1` alone for a wet road after the rain). Never ask the video model for drops on the glass. The mirrors take care of themselves: `traffic.py` finds the vehicles in each clip (it needs the YOLOX-S model in `docs/sample-videos/models/`; see the tools README) and `mirrorfeed.py` shows the road already driven with every passing vehicle drawn from behind as it goes by. Where waves throw spray up beside the road, add `MIST=<clip names>`: a fine mist on the windshield that the wipers clear now and then, and beads on the door mirror's housing (`spray.py`). At night add `MIRRORLIGHTS=0.35`, and at dusk or in rain `MIRRORLIGHTS=1`, so the mirrors show taillights on cars that have passed us and headlights on a car behind us. Judge with contact strips, then watch the composite. Reject against the standard's [review checklist](../../../docs/journey-video-standard.md#review-checklist). Common faults are a car that morphs as it passes, orbs, garbled signs that linger, and a world that empties out.

## 6. Finish

Conform, encode and strip audio as in the standard's [Delivery format](../../../docs/journey-video-standard.md#delivery-format). Then write the manifest's `media` block: mark set pieces `"once": true`, and set `look.cabinLight` for the variant.

## Keep the process honest

- Record every prompt next to its output (`<name>.prompt.txt`) and every cost in a log.
- When a fix works (a prompt line, a tool setting), add it to the standard and to [prompts.md](prompts.md), so the next creator starts from it.
- Plates of real roads are *scenic* or *route*, never *documentary*. No real brands, people or licence plates.
