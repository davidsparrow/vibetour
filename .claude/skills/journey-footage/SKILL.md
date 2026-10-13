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
- Budget. Stills cost about $0.10 at 2K; clips cost $0.015–0.09 per second (the standard's model table). An OpenRouter key refuses image and video requests once less than $1.00 is left under its own limit, whatever the account holds, so check `GET https://openrouter.ai/api/v1/key` before a batch and ask the user to raise the limit if needed.
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
- Quote every legible word on a sign exactly, and keep it short. Put signs well down the road: one beside the camera ends up behind the A-pillar.
- Anything moving our way in our lane is something the video must overtake. Put walkers and cyclists on the far side, facing us, or stopped.
- For a stop still (gas station, overlook), say where the car is parked and what fills the bottom of the frame ("gravel right up to the fence; no road in front of us"). Otherwise the model may park you across the road.
- For a variant, attach the place's still, but say the light and weather come from the prompt. To join two variant stills (rain on the road, then rain in town), make the second from the first.

## 3. Check every still before animating it

```bash
python tools/footage/vp.py anchors/<name>.png plates/<name>.png 1920x1080          # crop 16:9, horizon at 45%
CENTRE=1 python tools/footage/vp.py anchors/<stop>.png plates/<stop>.png 1920x1080  # stop stills
python tools/footage/deorb.py in.png out.png <x,y,r> …                              # paint out flare orbs
CABIN=1 tools/footage/still.sh plates/<name>.png review/<name>.png                  # through the cockpit
```

Use the variant's cabin light: 1 at midday, 0.75 before sunset, 0.45 at sunset, 0.6 in rain, 0.25 at night. Look at each still **through the cockpit**, at full size, and retake it if it has:

- an empty, clean or symmetrical world, or a postcard look
- the wrong lane, or a car close ahead in our lane by day
- garbled text, a real brand, or a sign hidden behind a pillar or the mirror
- flare orbs (paint them out instead, if the sky around them is clear)
- the sun blown out to a huge disc, or hidden behind the rear-view mirror when it's meant to be seen
- people posing or running, or anyone in the road

Show the user labelled contact sheets of the stills, bare and in the cockpit, before any clip is made.

## 4. Clips

Pick the model per slot family from the standard (`cruise` on HeyGen or Veo 3.1 Lite, stops and holds on Seedance 2.0 Fast). Start each clip from its 16:9 crop.

Write clip prompts from the clip block in [prompts.md](prompts.md). Every clip prompt needs these:

- **What keeps coming**, not just what's in the start frame. The life in the anchor passes in two seconds, and the model fills the road beyond with emptiness unless told otherwise.
- **Traffic as events**: "the oncoming camper van in the opposite lane on our LEFT keeps to its lane and passes us on the left".
- **Things that must not happen**: parked things stay parked, nothing fades in or out, signs keep their text, nobody runs, no lens flare or orbs, nothing of our own car.

Submit and poll with `tools/footage/submit.py` and `poll.py` (edit `SHOTS`), or the same calls in a small script. Download as soon as each finishes.

## 5. Review clips through the cockpit

```bash
CABIN=<level> PYTHON=<venv python> tools/footage/session.sh review/<name>.mp4 out/<clip>.mp4 [more clips…]
ffmpeg -i out/<clip>.mp4 -vf "fps=1,scale=480:-1,tile=4x2" -frames:v 1 strip.png   # contact strip
```

`session.sh` dissolves the clips, derives the steering track and the mirror feed, and composites. Judge with contact strips, then watch the composite. Reject against the standard's [review checklist](../../../docs/journey-video-standard.md#review-checklist). Common faults are a car that morphs as it passes, orbs, garbled signs that linger, and a world that empties out.

## 6. Finish

Conform, encode and strip audio as in the standard's [Delivery format](../../../docs/journey-video-standard.md#delivery-format). Then write the manifest's `media` block: mark set pieces `"once": true`, and set `look.cabinLight` for the variant.

## Keep the process honest

- Record every prompt next to its output (`<name>.prompt.txt`) and every cost in a log.
- When a fix works (a prompt line, a tool setting), add it to the standard and to [prompts.md](prompts.md), so the next creator starts from it.
- Plates of real roads are *scenic* or *route*, never *documentary*. No real brands, people or licence plates.
