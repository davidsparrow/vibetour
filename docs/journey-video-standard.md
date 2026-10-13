# Journey Video Standard

**Status: draft 0.2, proposed.** Today every built-in pack is procedural (see [journey-packs.md](journey-packs.md)). VibeTour can't play video packs yet. This standard says what a video Journey Pack must contain, so the packs we and creators make now will play once the video renderer lands. [Engine work this assumes](#engine-work-this-standard-assumes) lists what has to be built first.

It applies to every video pack: VibeTour Originals, community packs and packs sold in the marketplace (PRD §50).

Draft 0.2 is based on a bake-off run on 12 October 2026: 40 generated clips across five models, two cockpit designs and three composited test sessions. The evidence is in [the Footage Study](site/footage-study.html).

## What changed in 0.2

| 0.1 said | 0.2 says | Why |
| --- | --- | --- |
| Clips join on shared anchor frames; every model needs first-and-last-frame input | Clips join with a one-second dissolve. Anchors are look references. | Judged on composited sessions, dissolves read better than anchored loops, and they open the field to every model. |
| One model per pack | One model per slot family | No model won every slot. Veo 3.1 Lite drives; Seedance 2.0 Fast stops and holds; HeyGen Video is cheapest for cruise but can't hold a camera still. |
| Footage is the whole picture | Three layers: plate, cockpit, instruments | The cockpit (dash, wheel, hands, mirrors) is a generated still per car, composited over the plate. It steers with the road and never drifts. |
| "Natural muted colour, golden hour" | Vivid midday is the default look; golden hour and night are variants | The muted prompts made every pack beige. The reference footage is saturated: cerulean sky, cobalt water, several greens. |
| Vanishing point 42% from the top, 24–28 mm | Vanishing point 35% from the top, 22–26 mm | The cockpit covers the lower 45% of the frame. |
| Stop anchor is the stop itself | Stop anchor is the road anchor with the stop already in view | Asking a model to arrive somewhere new in 8 s produces morphs. From an approach anchor, the pull-in is clean. |

## The idea

**A journey is not a movie.** A ticket says "about 90 minutes", but that time is *productive coding time*, set by the Journey Engine (`approxMinutes` in the manifest). The footage doesn't have to last 90 minutes.

A video pack is a **vocabulary of short clips** that share one look. VibeTour chains them with dissolves for as long as the session lasts:

- cruise clips shuffle endlessly while you work
- a stop sequence plays when the car has to stop
- a tunnel plays while tests run
- the approach and arrival play when you finish

So you never film or generate "a 90-minute journey". You make somewhere between 3 and 40 minutes of footage, depending on the tier. How much you make sets how *varied* the trip feels, not how *long* it is.

## Three layers

What the user sees is three layers composited by the renderer:

| Layer | What | Made by |
| --- | --- | --- |
| **Plate** | The footage through the glass: road, landscape, weather. No car. | The pack, from a video model |
| **Cockpit** | Dash, A-pillars, roof lining, mirror housings, and a separate wheel-and-hands cutout that rotates with the road. Mirrors show the road behind. | VibeTour's car library, one generated still per car |
| **Instruments** | Gauges, crew agents in the mirrors, rain on the glass, the your-turn light | VibeTour's existing renderer |

A pack ships **plates only**. Cars are chosen by the user, work with every pack, and are described in [The cockpit layer](#the-cockpit-layer). Keeping the car out of the footage is what lets the dashboard react to the IDE, keeps every clip consistent, and makes "pick your car" a product axis.

## What the footage reacts to

Hundreds of IDE and agent signals boil down to 14 moments. Those become 10 car behaviours, and footage only has to cover these (from `src/core/motion.ts`):

| Car behaviour | When | What plays | Speed |
| --- | --- | --- | --- |
| `cruise` | You're coding, or an agent is at work | Cruise clips, shuffled | 100% |
| `review` | You opened a diff | Cruise clips | 80% |
| `gentle` | Thinking | Cruise clips | 65% |
| `slow` | Idle, before the scenic stop | Cruise clips | 35% |
| `checkpoint` | Tests, a build or lint running | Checkpoint: tunnel in → tunnel hold (loops until the run ends) → out into open road | 85% |
| `scenic-stop` | An agent needs you, your turn (opt-in), 3 min idle | Stop: pull in → hold (loops) → pull out | stopped |
| `pull-over` | Blocked: an agent hit a problem, or a failing build was left alone | Shoulder stop, or the scenic stop if the pack has none | stopped |
| `approach` | You pressed *Arrive*: the last 90 s of driving | Cruise, then the approach clip, timed to end at 100% | 60% |
| `arrived` | 100% | Arrival hold (loops) | stopped |
| `parked` | Park, or closing VS Code | Stop hold, or the pack's park clip | stopped |

Footage never reacts to anything else. These stay **dashboard only**:

- warnings and errors
- check engine
- a test passing or failing
- commits and branch switches
- crew agents in the side mirrors
- the radio
- the blue your-turn light

That is the rule from the PRD discussion, *"most IDE events change the dashboard, not the scenery"*. It's also what keeps the number of extra scenes small.

**Speed** is playback rate. VibeTour plays clips at `0.5 + 0.5 × speed`, so a 35% crawl plays at 0.68× and never falls into slow motion. Below that, the car stops instead (*proposed*).

**Timing.** The dashboard reacts within 250 ms. Footage changes at the next clip boundary. If that boundary is more than 6 s away, VibeTour dissolves early. Keep cruise clips 12 to 15 s long: long enough that a session has few dissolves, short enough that the scenery never lags far behind.

## Building blocks

| Term | Meaning |
| --- | --- |
| **Shot** | One generation from a video model, usually 8 to 15 s |
| **Clip** | A finished file in the pack, made from one or more shots. The unit VibeTour plays. |
| **Anchor** | A still that sets the look of a scene: light, palette, lens, road. Every clip in the scene starts from it or from a still made from it. The anchor still is also the poster. |
| **Scene** | A node of the pack's scene graph (PRD §40): one stretch of road with its own look, such as *Carmel coast* or *Big Sur cliffs* |
| **Slot** | The job a clip does: `cruise`, `checkpoint-in`, `stop-hold`… |
| **Set** | The in → hold → out clips of one stop or checkpoint |

Each scene has one **master anchor**. Make it first, then make the scene's other stills (stop approaches, the stop itself, the next scene's anchor) *from* it with the image model's reference input, so the light and palette hold across the pack.

## Slots

| Slot | Starts from | Length | Required | If missing |
| --- | --- | --- | --- | --- |
| `departure` | start still | 8–30 s | **yes**, 1 | — |
| `cruise` | the scene's anchor | 12–15 s | **yes**, at least 4 per scene | — |
| `transition` | the scene's anchor; ends in the next scene's look | 12–20 s | **yes**, one per scene-graph edge | — |
| `stop-in` · `stop-hold` · `stop-out` | approach still (stop in view) · stop still · stop still | 10–12 s · 12–30 s · 8–12 s | **yes**, 1 set | — |
| `approach` | last scene's anchor | 15–40 s | **yes**, 1 | — |
| `arrival-hold` | arrival still | 15–30 s | **yes**, 1 | — |
| `checkpoint-in` · `checkpoint-hold` · `checkpoint-out` | road → tunnel; tunnel; tunnel → road | 8–12 s · 8–16 s · 8–12 s | recommended, 1 set | Cruise clips; the dashboard still shows *Verifying* |
| `landmark` | the scene's anchor | 10–30 s | optional | Cruise clips |
| `shoulder-in` · `shoulder-hold` · `shoulder-out` | like the stop set, on the road shoulder | as stop | optional | The stop set |
| `park-hold` | park still | 15–30 s | optional | `stop-hold` |
| more `stop-*` sets | one per scenic stop (overlook, café, beach…) | as stop | optional | The first stop set |

**Rest stops and incident scenes: the whole list.** A pack needs exactly **one stop set** (three clips), and it serves every stop reason:

- an agent waiting for you
- your turn
- idle
- blocked
- parked

One **checkpoint set** is recommended for tests. Everything beyond that is optional. Each optional slot only adds variety, and every one has a fallback.

**The stop set needs two stills, not one.** The `stop-in` starts from an *approach* still: the road anchor, edited so the stop is already in view ahead-right (the forecourt, the overlook, the café). The hold starts from the *stop* still, facing the view. A model asked to drive from open road into a place it can't see will morph the scenery; from the approach still it slows and pulls in.

## How much to make

| | Economy | Standard | Cinematic |
| --- | --- | --- | --- |
| Good for | Coffee Run (15–30 min) | Day Trip (45–90 min) | Scenic Drive and longer |
| Scenes | 1 | 3–5 | 6–10 |
| Variants (time of day / weather) | 1 | 1 | 2–3 |
| Cruise clips | 6 | 5–6 per scene | 8–10 per scene |
| Stop sets / checkpoint sets | 1 / 1 | 2 / 1 | 3–4 / 1–2 |
| Landmarks | 0 | 1–2 | 3–6 |
| Clips in total | ~14 | ~40 | ~140 |
| Unique footage | ~3.5 min | ~10 min | 25–40 min |
| Generated seconds, with retakes | ~6 min | ~20 min | 60–80 min |
| Pack size at 1080p (the 720p rendition adds about half) | ~90 MB | ~260 MB | 0.7–1 GB |

"With retakes" assumes 40–50% of shots get rejected. In the bake-off, one shot in seven failed outright and two more needed a second look, so a careful creator will do better. [Choosing a video model](#choosing-a-video-model) prices these tiers.

Economy feels like a looping screensaver, but a pretty one. Most of the extra cost of Standard goes into cruise variety, which is what people notice. More stops matter less.

**How often a clip comes round.** Yes, clips repeat. They play like a playlist on shuffle, never in a fixed order:

| Tier | Cruise footage per scene | Time in each scene |
| --- | --- | --- |
| Economy | about 90 s | the whole trip |
| Standard, on a 90-minute trip | about 75 s | about 20 minutes |
| Cinematic | about 2 min | about 10 minutes |

So within a scene, any one cruise clip comes back every one to two minutes. Stops and tunnels break the run up, and the scenery changes as you move from scene to scene.

To repeat less, add cruise clips. Each extra minute of cruise footage takes about 120 generated seconds, retakes included:

- about $2 with HeyGen Video at its launch price, $4 at list
- about $4 with Veo 3.1 Lite
- about $11 with Seedance 2.0 Fast

## Camera and look

These rules are what make clips join and what makes the cockpit sit on them. Every clip in a pack follows the same ones.

- **Point of view:** forward-facing, from the driver's eye line in the middle of the lane, about 1.3 m up. Level horizon, no roll, no pitch.
- **No car:** no hood, dashboard, wipers, mirrors, hands, glass or reflections. The cockpit layer provides all of it.
- **Lens:** about 22–26 mm full-frame equivalent, the same for the whole pack. Wider than 0.1 asked for, because the cockpit hides the bottom of the frame.
- **Framing:** put the road's vanishing point at the horizontal centre, **35% from the top**. The cockpit covers the bottom 45% and the rear-view mirror covers a band at the top right, so keep the horizon and landmarks between 15% and 50% from the top.
- **Motion:** smooth and stabilised, a steady 50–70 km/h look. Use the same apparent speed in every moving clip. Slow down and speed up only in `stop-in`, `stop-out`, `departure` and the end of `approach`.
- **Road:**
  - drive on the side the manifest's `drivingSide` says
  - stay in lane, with no lane changes, overtakes or turns
  - anchors sit on straight or gently curving road
- **Traffic:** nothing directly ahead in your lane, because models morph cars. Sparse oncoming traffic is fine. Keep pedestrians away from the camera.
- **Text:** no legible signs, brands, logos or licence plates. Models garble text, and real brands aren't ours to use. Blank signs are fine.
- **Light and colour:** within a variant, every clip shares one time of day, weather and sun direction. The default variant is **vivid midday**: high sun, clear polarised air, saturated sky and water, several distinct greens, punchy contrast. Name the colours in every prompt, and name what you don't want ("not beige, not muted, not golden-hour"). Golden hour, "into the sun" and night are variants with their own anchors. Only `approach` and `arrival-hold` may move towards the variant's `arrivalTimeOfDay`.
- **Details that sell a place:** name them, and describe the moving ones as events. "A corrugated steel guardrail on wooden posts slides past on the right" and "every few seconds a wave hits the rocks and white spray explodes upward" both animate; "a scenic coast" doesn't.
- **Never mirror footage horizontally.** It flips the driving side.
- **Weather on the glass:** VibeTour draws windshield rain. Bake rain, fog or snow into the landscape only.

## Delivery format

| | Requirement |
| --- | --- |
| Resolution | 16:9. 1920×1080 recommended, 1280×720 minimum. Upscaling 720p model output to 1080p is fine. A 1080p pack also ships a 720p rendition for small screens and slow disks. |
| Frame rate | 24 fps constant (30 allowed), the same for every clip in the pack |
| Video | H.264 High profile, `yuv420p`, in `.mp4` with `faststart`. About 4 Mbps at 1080p and 2 Mbps at 720p. |
| Keyframes | Every 2 s, with no scene-cut keyframes, so loops and seeks are clean |
| Audio | **None.** Strip any audio the model makes. VibeTour's own soundscape follows the car. The engine's pitch rises with speed and idles when stopped, road noise fades out at a stop, and wind drops to a breeze. Pick ambience such as ocean or city with `audio.ambience` in the manifest. |
| Joins | Don't bake crossfades or fades into files. The player dissolves joins and loop seams. |
| Stills | One `.webp` per anchor and stop still, at the pack's resolution. They are the posters while clips load, and the *Static scenery* and *Reduced motion* modes show them instead of video. |
| Steering track | Optional `.json` per clip with the camera yaw per frame, for the cockpit's wheel. The validator derives it from the footage if the pack doesn't ship it. |

VS Code's bundled Chromium includes an H.264 decoder, and VP9 is built into Chromium, so `.mp4` (H.264) or `.webm` (VP9) should both play. Confirming that on Windows and Linux is on the engine list.

With FFmpeg (free):

```bash
# Conform a shot or a chained clip: 1080p, 24 fps, no audio, H.264
ffmpeg -i in.mp4 -an -vf "scale=1920:1080:flags=lanczos,fps=24,format=yuv420p" \
  -c:v libx264 -profile:v high -preset slow -crf 21 -maxrate 4M -bufsize 8M \
  -g 48 -keyint_min 48 -sc_threshold 0 -movflags +faststart out.mp4

# 720p rendition
ffmpeg -i out.mp4 -vf scale=1280:720:flags=lanczos -c:v libx264 -crf 23 -maxrate 2M -bufsize 4M \
  -g 48 -keyint_min 48 -sc_threshold 0 -movflags +faststart out-720.mp4
```

## Joins and loops

The player joins any two clips of the same scene with a **one-second dissolve**, and loops a hold by dissolving its tail into its head. Because every clip follows the same camera rules and starts from the same anchor, the dissolve reads as the road drifting, not as a cut. With the cockpit in front, which never changes, it's gentler still.

That is the default, `"joins": "dissolve"` in the manifest. It means:

- any model with a first-frame input works, and the cheapest ones are the cheapest
- holds don't have to end where they started
- the player holds the wheel steady through each dissolve, because the steering estimate is unreliable while two images overlap

A pack may instead declare `"joins": "anchored"`: every clip starts and ends on a shared frame, made with a model that takes a first and a last frame (Seedance 2.0, Veo 3.1, Kling 3.0, Wan 2.7). Joins are then invisible and holds loop exactly. It costs more retakes, and in the bake-off it looked no better through the glass. The marketplace could badge it.

Either way, **hide hard changes**: tunnels, bridges, overpasses, tight bends, tree cover, fog banks and crests all cover a transition between scenes.

Loops that will play for a long time (`stop-hold`, `checkpoint-hold`, `arrival-hold`) should move only gently: waves, clouds, leaves, tunnel lights. Make them 15–30 s so the repeat isn't obvious. A second hold clip helps on long stops: agents can wait 30 minutes, and a parked trip can wait for days.

## The cockpit layer

For maintainers and car designers. Packs don't ship cockpits; VibeTour does, one per car, and the user picks one.

**Generate the cockpit square to the car.** The camera is at the driver's eye, looking straight ahead: wheel hub at the horizontal centre, windshield symmetric, an A-pillar at each edge, the rear-view mirror housing top centre-right, a sliver of the door mirror at the far left. Asking for an off-centre framing in the prompt *turns the cabin*, which points the car at the shoulder; if an off-centre crop is ever wanted, crop a wider straight-ahead still. Generate at 4:3 and crop 16:9 from the top, so the forearms run out of the bottom of the frame and the rotated wheel cutout never shows its edge.

**Name the materials and light.** Charcoal everywhere reads as clay. Say what the dash is made of (leather with stitching, open-pore wood, brushed aluminium, gloss black, a perforated leather wheel with a metal spoke), ask for a backlit cluster with legible numerals and glowing needles, and say that daylight through the windshield lights the dash top. Every pane of glass, including the mirrors, is flat chroma green (#00FF00) so the renderer can key it.

**Derived assets**, all made by script from the one still:

| Asset | How |
| --- | --- |
| Cabin without the wheel | An image-model edit: "remove the steering wheel and the driver's hands and arms; show the column, cluster and lap behind them; keep everything else pixel for pixel" |
| Wheel-and-hands cutout | The difference between the two stills, clipped to a disc around the hub and two bands for the forearms, then keyed and despilled like the cabin |
| Glass mask | The keyed still's transparent regions. The largest is the windshield. |
| Mirror masks | The other transparent regions above 800 px², one per mirror |
| Hub position | The centre of the wheel-cutout's disc |

**At play time** the renderer:

1. Draws the plate, **centred so its vanishing point sits over the wheel hub**. This is what keeps the car pointing down the road.
2. Fills each mirror with the current clip run backwards (what a mirror shows is the road receding), darkened 20%. Reverse each clip on its own, never the joined session, which would put a later scene behind the car. At stops and holds, which face the stop, hold the last moving clip's road instead. Use the centre of the frame for the rear-view, the left edge for the door mirror. The side window is a window; the plate shows through it.
3. Draws the cabin with a faint, neutral light bleed (the blurred plate at 15%, luminance only) so the dash takes the scene's light without taking its colour.
4. Draws the wheel-and-hands cutout rotated about the hub by the clip's **steering track**: the plate's camera yaw per frame, from dense optical flow on the band around the horizon, smoothed over half a second, scaled so the 97th percentile is ±12.5°. The wheel holds through curves and comes back to centre only when the road straightens. At stops the wheel centres and a "hands resting" still crossfades in. The player holds the wheel through each dissolve.
5. Adds a windshield bloom from the plate's near-white highlights, on the glass only, desaturated.
6. For "into the sun" variants only, adds a **lens flare**: the sun found as one round clipping blob in the sky, a bloom, an anamorphic streak and tinted ghosts on the line through the frame centre, confined to the glass with faint ghosts allowed on the dash. Off by default: on a midday plate it fires on clouds.
7. Adds ±1–2° of sway and a small bob keyed to speed. Nothing else.

Finger re-grips and a finger tapping the wheel are future experiments. Hands are what models get wrong most, so the cutout keeps them on the wheel.

## Production workflow

The PRD's Creator Studio steps (§52), with the tools to use today:

| # | Step | Output | Tools |
| --- | --- | --- | --- |
| 1 | **Journey Bible**: route research, scenes, scenic stops, look, prompts | `bible.md`, `shotlist.json` | Claude, or any LLM (via OpenRouter too) |
| 2 | **Anchors**: one master still per scene, then every other still edited from it so the look holds | `anchors/*.png` | An image model with reference input: Gemini image, gpt-image, FLUX Kontext |
| 3 | **Clips**: image-to-video from each still | raw shots | A video model per slot family ([choosing one](#choosing-a-video-model)) |
| 4 | **Review and retake** against the [checklist](#review-checklist) | approved shots | Your eyes, contact strips, and a composite with a cockpit, since that's what users see |
| 5 | **Finish**: trim, conform, encode, strip audio, make the 720p rendition | `clips/*.mp4` | FFmpeg; optionally Topaz Video AI or Real-ESRGAN to upscale |
| 6 | **Assemble** the manifest: scene graph, anchors, clips, stops | `manifest.json` | A text editor; `validatePack()` |
| 7 | **Test drive** every behaviour, fast-forwarded | — | `npm run demo` with `?speed=20` and the Demo controls |
| 8 | **Cover, ticket, preview, provenance**; publish | `.vibetour` package | An image model for the cover; HeyGen Video for the preview |

Only steps 2, 3 and 5 need tools from outside VibeTour. In step 3, generation is the cost. In step 4, rejection is the time. The scripts used for the bake-off (submit and poll, steering track, masks, flare, composite) are in [`tools/footage/`](../tools/footage/README.md).

### Prompt templates

Master anchor (step 2):

```
Photorealistic still from a forward-facing dashcam at the driver's eye height,
centred in the {right|left}-hand lane of {road description} in {scene}, {region},
on a brilliant clear early afternoon. Sun high and to the {left|right}, crisp
polarised air, no haze. Colour is vivid and true: a deep saturated cerulean sky
grading to pale blue at the horizon with a few bright white cumulus; {water: rich
cobalt turning turquoise near the shore with brilliant white surf}; trees in several
distinct greens, from dark {cypress} to bright yellow-green scrub; {rock colour};
charcoal asphalt with crisp {yellow centre and white edge} lines. Punchy contrast,
clean highlights, deep but detailed shadows. {Place details: a corrugated steel
guardrail on weathered wooden posts along the cliff edge; swells crashing onto dark
rocks with spray exploding upward.} Level horizon; the road's vanishing point at the
horizontal centre, 35% from the top. 24 mm lens. No car hood, dashboard, glass or
wipers. No vehicles, no people, no signs, no text. Not beige, not muted, not
golden-hour, not faded.
```

Any other still in the scene: the same prompt with the change you want ("the road curves left between granite outcrops"; "a small gas station on a gravel forecourt sits ahead-right"), plus "Match the colour, light, lens and style of the reference image exactly", with the master attached.

Clip (step 3, start still attached):

```
Smooth forward drive along {road description} at a steady 60 km/h, centred in the
{right|left}-hand lane, no lane changes, no turns. {What happens: the road curves
gently right past the guardrail.} {Events: every few seconds a wave hits the rocks
below and white spray explodes upward and hangs in the air before falling back.}
Keep the exact colour and light of the start frame throughout: {the palette, in the
anchor's words}. Camera locked at the driver's eye height, no shake. No car hood,
dashboard, glass or wipers. No vehicles, no people, no signs, no text. No audio,
no music.
```

Add, depending on the slot:

- **`stop-in`** (from the approach still): "gradually slows, drifts right off the road onto {the forecourt} and rolls to a smooth complete stop facing {the pumps}. The deceleration is smooth and the stop is gentle, with no lurch."
- **`stop-out`:** "pulls back onto the road and accelerates to cruising speed"
- **`*-hold`:** "Stationary camera. Nothing moves except {a slow drift of cloud, trees swaying gently in a light breeze, waves breaking white on the rocks far behind}."

Cockpit (for the car library, 4:3):

```
Photorealistic view from the driver's seat of a modern unbranded car, camera at the
driver's eye looking straight ahead, square to the car: the steering wheel hub at the
exact horizontal centre, the windshield head-on and symmetric, the left A-pillar at
the far left edge and the right A-pillar at the far right edge, the rear-view mirror
housing top centre-right, a sliver of the door mirror at the far left. Both hands on
the wheel at 9 and 3, wheel centred, forearms running down and out of the bottom of
the frame. {Materials: tan saddle leather with stitching, open-pore walnut, brushed
aluminium bezels, gloss black centre stack, a perforated black leather wheel with a
polished metal spoke.} A bright backlit cluster with crisp white numerals and glowing
needles. Daylight pours through the windshield from ahead-right and lights the dash
top. No logos, badges, brand marks or screens with content. The entire windshield,
the side windows and the glass of every mirror are a perfectly flat, uniform pure
chroma-key green (#00FF00) with no reflections. 26 mm lens, level horizon, no camera
rotation. Frame tall (4:3) with room below the wheel for the forearms.
```

## Choosing a video model

Prices and catalogues are as of 12 October 2026, from OpenRouter's `GET /api/v1/videos/models` and HeyGen's docs, audio off. Both change often, so check them before a big run.

A model works for a slot if it has:

- **image-to-video from a first frame**, so every clip starts in the scene's look
- clips of at least 8 s
- 720p or better
- audio off, or audio that can be stripped
- terms that allow commercial use of its output, if you'll sell the pack

**Pick a model per slot family**, and hold the look with the anchors. In the bake-off every model matched its start still closely (first frames scored 0.83–0.91 SSIM against the anchor), so the join between a Veo cruise and a Seedance pull-in is a palette match, not a model match.

| Slot family | Model | Why |
| --- | --- | --- |
| `cruise`, `transition`, `landmark`, `approach` | **Veo 3.1 Lite** | Full-speed, steady drives at $0.03/s. Animates named events (waves, a rail sliding past). One ghost-object morph in nine shots. |
| `stop-in`, `*-hold`, `stop-out` | **Seedance 2.0 Fast** | The only model that drove into the stop; holds are still with gentle motion. About $0.09/s. |
| cruise plates on a budget; trailers and previews | **HeyGen Video** | $0.015/s at launch, $0.03 list, at 768p; matches the look; animates events. Can't hold a camera still, and drifts to invented lane markings in one shot of three. Longest clips (15 s). |

On OpenRouter unless noted, first-frame input, audio off:

| Model | Shot length | Resolution | Price per second | Last frame too |
| --- | --- | --- | --- | --- |
| HeyGen Video (direct, through October 2026) | 5–15 s | 480p / 768p | $0.01 / ~$0.015 | no |
| HeyGen Video (OpenRouter, list) | 5–15 s | 768p / 2K | $0.03 / $0.09 | no |
| Veo 3.1 Lite | 4/6/8 s | 720p / 1080p | $0.03 / $0.05 | yes |
| Hailuo 3 Max | 5–15 s | 480p / 768p | $0.05 / $0.08 | one frame only, despite the listing |
| Seedance 2.0 Fast | 4–15 s | 720p | ~$0.09 (priced per token; measured) | yes |
| Kling 3.0 Standard | 3–15 s | 720p | $0.084 | yes; crawled at half speed in the test |
| Wan 2.7 | 2–10 s | 1080p | $0.10 | yes |
| Veo 3.1 Fast | 4/6/8 s | 720p–4K | $0.10 | yes |
| Veo 3.1 | 4/6/8 s | 720p–4K | $0.20 | yes |

Hailuo 3 Max on OpenRouter rejects a first and last frame together, whatever the catalogue says. OpenAI shut Sora 2 down on 24 September 2026. Luma Ray 3.2 (native loop flag) and Kling O3 (reference "elements" plus start and end frames) aren't on OpenRouter.

### OpenRouter: one key for most of the pipeline

OpenRouter reaches about 30 video models, the image models for anchors and covers (Gemini image, GPT Image), and the language models for the Journey Bible. HeyGen Video is on it at list price; the launch price needs HeyGen's own API key and prepaid wallet.

```jsonc
// POST https://openrouter.ai/api/v1/videos  →  202 with an id; poll GET /api/v1/videos/{id},
// then download GET /api/v1/videos/{id}/content
{
  "model": "google/veo-3.1-lite",
  "prompt": "Smooth forward drive along …",
  "duration": 8, "resolution": "720p", "aspect_ratio": "16:9", "generate_audio": false, "seed": 21,
  "frame_images": [
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,…" }, "frame_type": "first_frame" }
  ]
}
```

OpenRouter doesn't keep generated videos permanently, so download them straight away. A key carries its own spending cap, separate from the account balance.

HeyGen direct ([docs](https://developers.heygen.com/docs/models/heygen-video)): `POST https://api.heygen.com/v3/models/videos` with `x-api-key`, `{"model":"heygen-video-1","mode":"image_to_video","prompt":…,"duration":12,"resolution":"768p","seed":7,"prompt_enhancement":"disabled","image":{"type":"base64","media_type":"image/jpeg","data":…}}`; poll `GET /v3/models/videos/{id}`. 1080p and 2K bill at three times the 768p rate. Turn off the wallet's auto-reload while experimenting.

### What a pack costs

The generated seconds from [How much to make](#how-much-to-make), with cruise and transitions on one model and stops and holds (about 12% of the seconds) on Seedance 2.0 Fast:

| Cruise model | Economy (~360 s) | Standard (~1,200 s) | Cinematic (3,600–4,800 s) |
| --- | --- | --- | --- |
| HeyGen Video at $0.015 | ~$10 | ~$29 | $85–115 |
| Veo 3.1 Lite at $0.03 | ~$14 | ~$45 | $130–175 |
| Seedance 2.0 Fast throughout | ~$32 | ~$110 | $320–430 |

Stills cost about $0.07 each with Gemini image; a Standard pack needs 10–15. Language models and encoding cost little next to the video.

Retakes are the biggest cost. Every rejected shot is paid for. A tight camera spec and good anchors save more than a cheaper model does.

## Review checklist

Judge shots **through a cockpit**, not bare: the renderer's demo can composite any clip. Reject and retake a shot that has any of these:

- [ ] Road layout drifts or morphs: lanes appear or vanish, the road bends impossibly, a new lane marking appears
- [ ] Wrong driving side, a lane change, a turn, or a pull-in to the wrong side
- [ ] Shake, roll, a zoom, or a jump in apparent speed; a crawl at half speed
- [ ] A hold whose camera drifts or reverses
- [ ] A ghost: a translucent object crossing the frame, or scenery that fades in over the road
- [ ] Any part of a car, glass or reflection
- [ ] A vehicle ahead in the lane, or cars that melt or merge
- [ ] Legible or garbled text, logos, licence plates
- [ ] Light or palette that doesn't match the scene's anchor: haze, a beige cast, a different sun
- [ ] Named details (the rail, the surf) that vanish mid-clip
- [ ] Flicker, smearing, or detail boiling in foliage, water and asphalt
- [ ] Anything unsafe or alarming: no crashes, near misses or emergencies, ever (PRD §41)

## Manifest additions (proposed)

A video pack keeps everything a procedural pack has: ticket, route, variants, scene graph, scenic stops, facts, audio and provenance. Set `provenance.generation` to `"ai-video"` (or `"captured"` for filmed footage). It also adds a `media` block. Clip `scene` ids are scene-graph node ids (these are California Coast's), and `"*"` means any scene. `from` and `to` name the stills a clip starts and ends near; with dissolve joins they're a hint for the validator's palette check, and with anchored joins they're the frames it must land on.

```jsonc
"media": {
  "kind": "video",
  "joins": "dissolve",
  "format": { "width": 1920, "height": 1080, "fps": 24, "codec": "h264" },
  "renditions": { "720p": "720/" },
  "look": { "variant": "vivid-midday", "sunInFrame": false },
  "anchors": {
    "start":        { "still": "anchors/start.webp" },
    "bigsur":       { "still": "anchors/bigsur.webp" },
    "gas-approach": { "still": "anchors/gas-approach.webp" },
    "gas":          { "still": "anchors/gas.webp", "stop": "Carmel Highlands gas station" },
    "carmel":       { "still": "anchors/carmel.webp" }
  },
  "clips": [
    { "id": "depart",     "slot": "departure",  "scene": "departure", "from": "start",        "to": "bigsur", "file": "clips/depart.mp4" },
    { "id": "bigsur-01",  "slot": "cruise",     "scene": "bigsur",    "from": "bigsur",                       "file": "clips/bigsur-01.mp4", "steering": "clips/bigsur-01.steer.json" },
    { "id": "bigsur-02",  "slot": "cruise",     "scene": "bigsur",    "from": "bigsur",                       "file": "clips/bigsur-02.mp4" },
    { "id": "to-carmel",  "slot": "transition", "scene": "bigsur",    "from": "bigsur",       "to": "carmel", "file": "clips/to-carmel.mp4" },
    { "id": "gas-in",     "slot": "stop-in",    "scene": "*",         "from": "gas-approach", "to": "gas",    "file": "clips/gas-in.mp4" },
    { "id": "gas-hold",   "slot": "stop-hold",  "scene": "*",         "from": "gas",          "to": "gas",    "file": "clips/gas-hold.mp4" },
    { "id": "gas-out",    "slot": "stop-out",   "scene": "*",         "from": "gas",          "to": "bigsur", "file": "clips/gas-out.mp4" }
  ]
}
```

Durations come from the files. The validator would check:

- every file exists, matches `format` and has no audio
- every required slot is filled
- each scene has at least four cruise clips
- every scene-graph edge has a transition
- each clip's first frame is close in palette to its `from` still (warning only); with `"joins": "anchored"`, first and last frames must match their stills
- a steering track exists for every moving clip, deriving one from the footage if the pack doesn't ship it
- the pack fits its tier's size limit

## Rights, provenance and honesty

From PRD §53, §54 and §79:

- **Your model's terms must allow commercial use and resale of what it generates.** Check this before you generate a pack you plan to sell. Terms differ between models and plans, and they change. For example, Google says it claims no ownership of Veo output, but gives no express commercial grant, and Veo marks output with an invisible SynthID watermark.
- `provenance` names the models used for stills and video, any reference footage or photos and their licences, and the audio sources.
- No copyrighted worlds or characters, real brands or branded vehicles, real people, or music without rights. A real car's badge in the cockpit is trademark use; the car library stays unbranded unless a maker agrees.
- Label honestly:
  - set `type` and `authenticity` (dream, scenic, route or documentary)
  - fictional places carry the **Fantasy Journey** badge
  - AI footage of a real road is *scenic* or *route*, not *documentary*, unless it was filmed there
- Facts in `facts` must be accurate.

## Selling a pack

What the marketplace (the "IDE Travel Agency", PRD §50) would ask of a submission:

1. The validator passes. That earns the **VibeTour Verified** badge (PRD §53).
2. At least the Economy tier: every required slot, at 720p or better. A 1080p pack also ships its 720p rendition.
3. Provenance filled in, and the creator confirms their rights and their model's commercial terms.
4. A cover, a ticket image and a 20–30 s preview. The preview may show a cockpit: HeyGen's reference-to-video can keep one across a few shots, and cuts are fine there.
5. A test drive through every behaviour with no checklist failures.
6. One `.vibetour` file (a zip of the pack folder, PRD §81) under the tier's size limit.

## Engine work this standard assumes

For maintainers. None of this exists yet:

1. **Video renderer.** A *Video Director* that turns the existing `motion` and `journey` snapshot into a playlist:
   - shuffled cruise clips
   - stop, checkpoint and approach sets
   - transitions when progress crosses into the next scene
   - playback rate from speed
   - one-second dissolves at every join and loop seam, early when the next boundary is far away

   It plays through two `<video>` elements so joins can be blended. It's chosen when `media.kind === "video"`, and the procedural renderer stays for everything else.
2. **Cockpit layer.** A car library and a compositor that draws plate, mirrors, cabin, wheel and bloom as in [The cockpit layer](#the-cockpit-layer), with the wheel driven by each clip's steering track and held through dissolves. The library has started: [cars/](../cars/README.md) holds the first car (the still, the no-wheel edit, the wheel cutout, the masks and a `car.json` with the hub), and `tools/footage/car-build.sh` derives the assets. Still to build: the compositor in the renderer, a car picker, and a `vibetour car build` command.
3. **Steering tracks.** Derive camera yaw per frame from each clip at pack-build time (`tools/footage/steer.py` is the reference), ship it as `*.steer.json`, and fall back to deriving it on first play.
4. **Packs from disk.** Today packs are bundled at build time (`src/packs/index.ts`). Video packs need a user pack folder, `localResourceRoots` for the webview, and a static route on the companion server.
5. **Schema and validator.** Add the `media` block to `JourneyPack`, plus the checks above in `validatePack()` and a `vibetour pack validate <dir>` command for creators.
6. **Codec check.** Confirm H.264 `.mp4` plays in VS Code webviews on Windows and Linux. Fall back to VP9 `.webm` if it doesn't.
7. **Static scenery with stills.** Use anchor stills for *Static scenery*, *Reduced motion* and *No camera motion*.
8. **Later: Journey Studio.** A `vibetour studio` command that runs the workflow above with the creator's own API keys (BYOK, PRD §43). One adapter per provider, all behind one call: `generateClip({ firstFrame, prompt, seconds, model })`. Start with OpenRouter and HeyGen, since between them they reach every model above.
