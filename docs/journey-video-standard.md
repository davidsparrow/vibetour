# Journey Video Standard

**Status: draft 0.2, proposed.** Today every built-in pack is procedural (see [journey-packs.md](journey-packs.md)). VibeTour can't play video packs yet. This standard says what a video Journey Pack must contain, so the packs we and creators make now will play once the video renderer lands. [Engine work this assumes](#engine-work-this-standard-assumes) lists what has to be built first.

It applies to every video pack: VibeTour Originals, community packs and packs sold in the marketplace (PRD §50).

Draft 0.2 is based on a bake-off run on 12 October 2026: 40 generated clips across five models, two cockpit designs and three composited test sessions. The evidence is in [the Footage Study](site/footage-study.html). A realism pass on 13 October added [World detail](#world-detail), the glass, light and rain in the cockpit, and the 45% horizon: 25 stills (30 takes) and 6 clips of a lived-in California coast, judged through the cockpit.

## What changed in 0.2

| 0.1 said | 0.2 says | Why |
| --- | --- | --- |
| Clips join on shared anchor frames; every model needs first-and-last-frame input | Clips join with a one-second dissolve. Anchors are look references. | Judged on composited sessions, dissolves read better than anchored loops, and they open the field to every model. |
| One model per pack | One model per slot family | No model won every slot. Veo 3.1 Lite drives; Seedance 2.0 Fast stops and holds; HeyGen Video is cheapest for cruise but can't hold a camera still. |
| Footage is the whole picture | Three layers: plate, cockpit, instruments | The cockpit (dash, wheel, hands, mirrors) is a generated still per car, composited over the plate. It steers with the road and never drifts. |
| "Natural muted colour, golden hour" | Vivid midday is the default look; golden hour and night are variants | The muted prompts made every pack beige. The reference footage is saturated: cerulean sky, cobalt water, several greens. |
| Vanishing point 42% from the top, 24–28 mm | Vanishing point 45% from the top (43–47%), 22–26 mm | Judged through the cockpit. At 54% the horizon sat 81% of the way down the windshield, and the driver seemed to sit far back. At 45% it sits 61% down, with road ahead and in the side window. At 35% the windshield was nearly all road. Models put the horizon at the centre of a still, so generate at 4:3 and crop. |
| Stop anchor is the stop itself | Stop anchor is the road anchor with the stop already in view | Asking a model to arrive somewhere new in 8 s produces morphs. From an approach anchor, the pull-in is clean. |
| "No vehicles, no people, no signs, no text" | A lived-in world: oncoming traffic, people, animals, houses, road furniture, signs and wear, at set rates | Empty, clean, symmetrical roads read as computer-made. Naming the clutter fixed that in one take. See [World detail](#world-detail). |
| The cockpit is a still with bloom | The cockpit also has glass and light: the dash reflected in the windshield, dust and wiper arcs lit by the sun or headlights, grain, and a cabin light level per variant | Without them the windshield reads as a hole in the dash, and at night the cabin stayed lit like midday. |
| Stills at about 1 megapixel | Stills at 2K (2400×1792 at 4:3) | $0.10 a still instead of $0.07, and the 16:9 crop is 2400×1350, more than 1080p |

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
- the radio, including music
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

**The stop set needs two stills, not one.** The `stop-in` starts from an *approach* still: the road anchor, edited so the stop is already in view ahead-right (the forecourt, the overlook, the café). The hold starts from the *stop* still, facing the view. A model asked to drive from open road into a place it can't see will morph the scenery; from the approach still it slows and pulls in. Give the `stop-in` the stop still as its **last frame** too (Seedance 2.0 takes both), so it lands exactly where the hold starts. On 13 October, without it, the overlook pull-in ended facing the sea with the parked cars gone, and the gas-station pull-in stopped nose-up to a pickup; with it, both landed on their holds first time. For the `stop-out`, name what is parked in front of the car and say the car drives round it, or the model drives that car out ahead of you.

**Say how high the camera is, in every still.** Asked only for "the driver's eye height", the image model put every road still about 1.8 m up and the first stop stills about 2.5 m up: through the cockpit the car looked down on the roofs of the parked cars, like a bus. Where a still has cars in it, the camera height shows at once; say it in every prompt. For the stop stills: the horizon ran above the heads of standing people and the parked cars showed their roofs, and through the cockpit the car looked as if it hovered. The pull-in made from such a still slid sideways and backwards to reach it. Say it in measurements and comparisons: "the camera is at the seated eye height of a driver in a low car, about 1.1 m above the ground, well below the roofs of the parked cars, so we see their sides, doors and windows and never their roofs; the horizon runs through the chests of the standing people and through the side windows of the parked cars; not a high viewpoint, not looking down". The horizon of the result should cut standing adults around the shoulders. Check the stop still through the cockpit before animating it, as for any other still. The gas-station still also centres the station, so the pull-in lands with the pumps, the shop and the people in view, not behind the A-pillar.

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

- **Point of view:** forward-facing, from the driver's eye line in the middle of the lane, about 1.3 m up. Level horizon, no roll, no pitch. In a stop still, say the height in metres and against the parked cars and the people (see [How much to make](#how-much-to-make)); the image models park the camera high by default.
- **Nothing of our own car:** no hood, dashboard, wipers, mirrors, hands, glass or reflections. The cockpit layer provides all of it. Other people's cars are welcome; see [World detail](#world-detail).
- **Lens:** about 22–26 mm full-frame equivalent, the same for the whole pack. Wider than 0.1 asked for, because the cockpit hides the bottom of the frame.
- **Framing:** put the road's vanishing point at the horizontal centre, **45% from the top (43–47%)**. Image models put the horizon at the centre whatever the prompt says, so ask for it at the centre of a 4:3 still and crop a 16:9 band with the point 45% down (`tools/footage/vp.py` does both). Behind the cockpit the windshield shows the plate from about 15% to 63% from the top, so the horizon lands about 60% of the way down the glass. The rear-view mirror covers part of the top right and the A-pillars the sides, so keep landmarks and signs in the middle of the band. A sign right beside the camera in the still ends up behind the pillar.
- **Motion:** smooth and stabilised, a steady 50–70 km/h look. Use the same apparent speed in every moving clip. Slow down and speed up only in `stop-in`, `stop-out`, `departure` and the end of `approach`.
- **Road:**
  - drive on the side the manifest's `drivingSide` says
  - stay in lane, with no lane changes, overtakes or turns
  - anchors sit on straight or gently curving road
- **Traffic:** oncoming traffic stays in its own lane and passes on the driver's side. By day, nothing close ahead in our lane: a car we catch up with is a car the model has to morph. At night, taillights at a steady distance ahead are fine and look right. Walkers and cyclists going our way on our side are people we'd overtake, so put them on the far side, facing us, or stopped. [World detail](#world-detail) sets how often.
- **Text:** signs are welcome, but quote every legible word exactly and keep it short ("SPEED LIMIT 25", "BIG SUR 26"); every other sign is too far away to read. No real brands, logos or readable licence plates. Shop names are short and made up ("BAKERY", "BOOKS"). Video models garble text as a sign comes close, which is fine for a moment.
- **Light and colour:** within a variant, every clip shares one time of day, weather and sun direction. The default variant is **vivid midday**: high sun, saturated sky and water, several distinct greens, punchy contrast, and natural haze on the farthest ridges. Name the colours in every prompt, and name what you don't want ("not beige, not muted, not golden-hour"). The other variants have their own anchors:

  | Variant | What to ask for | Cabin light |
  | --- | --- | --- |
  | Before sunset | Sun low, a small clean disc well above the horizon, a sun path on the water, golden raking light and long shadows, the first faint white-pink on the clouds | 0.75 |
  | Sunset | A thin sliver of sun on the sea horizon, clouds lit pink, coral and crimson from below, the sky deepening to violet; headlights coming on | 0.45 |
  | Night in town | Lit shop windows, lamps, string lights, parked cars, people on the sidewalks, oncoming headlights, a car's taillights well ahead; a navy sky, not black | 0.25 |
  | Night road | Our low beams on the road, reflector posts and markers glinting, taillights ahead, oncoming headlights passing; stars and a moon | 0.25 |
  | Rain | A low even grey sky, mist on the hills, soaked asphalt with reflections, puddles, spray from passing cars, lit windows, rich wet greens. The drops on the glass and the wipers come from the cockpit layer. | 0.6 |
  | Fog | A bright afternoon with a thick bank of white sea fog pouring over the cliff edge and across the road ahead; the road runs into it and out again into sun on the next headland. Bright white fog, not grey and gloomy. In the clip, say "we drive into the fog … then come out into bright sunshine again". | 0.9 |

  The rain stills looked the most real of the 13 October set; sunny ones look too clean next to them, so ask for haze in the distance. Only `approach` and `arrival-hold` may move towards the variant's `arrivalTimeOfDay`.
- **Details that sell a place:** name them, and describe the moving ones as events. "A corrugated steel guardrail on wooden posts slides past on the right" and "every few seconds a wave hits the rocks and white spray explodes upward" both animate; "a scenic coast" doesn't.
- **Never mirror footage horizontally.** It flips the driving side.
- **Weather on the glass:** VibeTour draws windshield rain and the wipers (step 7 of [The cockpit layer](#the-cockpit-layer)). Bake rain, fog or snow into the landscape only, and ask for no drops on the lens.

## World detail

Real roads are untidy and busy. Image models default to empty, clean and symmetrical, and that is what makes a frame look computer-made. Draft 0.2's first anchors asked for "no vehicles, no people, no signs" and got exactly that. Naming the clutter, the wear and the life of the place fixed it in one take.

**What each stretch has.** Name some of each row in the anchor prompt. Not all of it, and not the same items every time.

| Stretch | Nearly always | Often | Now and then |
| --- | --- | --- | --- |
| Town | Parked ordinary cars, some dusty; people walking, with dogs and children; shopfronts with short made-up names; a street-name sign; utility poles and wires; bins at the kerb | A bicycle against a post; a sandwich board; boxes by a door; a little litter in the gutter; pigeons on a roof; oncoming cars | A delivery van unloading; a bus stop; a cyclist waiting at a corner |
| Edge of town | Utility poles carrying wires on down the road until well out of town; mailboxes; driveways | The route shield and a distance sign; a for-sale sign; a bus stop with a bench; a parked pickup | A lemonade stand; a lost-dog flyer on a pole |
| Country | Fences; reflector posts; a mile marker | A farm or ranch every few miles: farmhouse, barn, pickup, tractor, animals. Lived in, not always farmed | A small cluster of well-spaced homes tucked into a hillside among trees; rarely one on the sea side |
| Wild road | A guardrail; warning signs; reflector posts | Birds on posts, wires and signs; a pullout with a parked car | A vista-point sign; an Adopt-a-Highway sign |
| Stops | Other customers, their cars and dogs; posted signs | Motorcycles; an ice chest; a propane cage; a trash can | Someone walking out with a coffee |

**How often.** These are pack-level rates, set in the shot list, not per clip:

| Detail | Rate |
| --- | --- |
| An oncoming vehicle passes, by day | 1 to 4 cruise clips in every 10. None in empty places: deserts, Iceland's interior, the Moon. |
| Oncoming headlights, at night | Most night clips. Headlights are what night driving looks like. |
| A vehicle ahead in our lane | Night only, at a steady distance |
| A house, farm or cluster of homes, outside towns | Every few clips |
| Signs | One or two per clip in the country, many in town |
| Birds perched on wires, poles, posts and signs | Now and then |
| The scenic overlook | One per tour. Make it the pack's main stop set: a busy pullout facing the view, with parked cars, people looking out, an interpretive sign, birds on the fence. Not a rest stop. |
| A breakdown on the shoulder, with or without a tow truck | Once per tour at most. A cruise clip marked `"once": true`, so the player never repeats it. We pass by. |

Count these across the scene's stills before making clips: image models put an oncoming car in most stills that ask for a lived-in road (11 of 14 on 13 October). **Edit the extras out** rather than regenerating: "Remove the dark car driving toward the camera far down the road in the left-hand lane … Keep everything else exactly as it is, pixel for pixel", with the still itself as the only reference at full size. Four edits removed the car cleanly and changed nothing else. Then tell the clip that the opposite lane stays empty, or the video model adds traffic of its own.

**Region kits.** Name what belongs to the place. On the California coast: camper vans and cars with surf racks among the rental cars, a few motorcycles (fewer in rain or snow), Caltrans green guide signs, the Route 1 shield, mile markers, Adopt-a-Highway signs, cypress and ice plant, pelicans and gulls. Elsewhere, pick the vehicles and activities of the region: ski racks and snow chains in the Alps, scooters and delivery bikes in Tokyo, Vespas and tractors in Tuscany.

**People and animals** are still, or move slowly: looking at the view, reading a sign, chatting, walking a dog. Nobody runs, nobody poses for the camera, and nobody stands in the road.

**Signs** use the region's real sign system, as in the reference sheets a creator collects. Quote the words, and name the colours ("white letters on a GREEN background"): without them, one Caltrans distance sign came out black. Put signs far down the road, about 150 m ahead and small in the frame. A sign close to the camera on the right sits behind the rear-view mirror in the cockpit, and one close on the left sits behind the A-pillar.

**A distance sign has to make sense and be read in time.** It faces the way we drive and lists the places ahead of us, nearest first, with true distances from where the sign stands; the gaps between its lines are then right too. On 14 October the cliff stretch south of Carmel showed "Big Sur 6, Monterey 37, San Francisco 153", a northbound sign on a southbound drive; about 7 miles south of the Carmel River bridge the southbound one reads "Big Sur 19, San Simeon 85" (mileages from the [Big Sur location table](https://jrabold.net/bigsur/loctable.htm)). And it starts far off: the old one opened the clip already close and passed before anyone could read it. Video models garble text that grows as it comes closer, and a sign far enough away to give time to read starts too small for the model to keep its letters. So put our own sign on the still (`tools/footage/sign.py paste`, after an edit that removes the model's), let the model drive up to it, and redraw its face on the clip (`sign.py fix` finds the green face in every frame and repaints it, following its corners). Give it about five seconds of growing before it passes.

**Other signs, billboards and names (17 October).** A name goes on a sign only where a real one would carry it: distance signs, vista points, landmarks and parks, a town's limit, and now and then a shop named for its town ("HIGHLANDS GAS · MARKET"); every such name agrees with the pack, the Nav map and the stop pill. Billboards stand only where real ones do: on the freeway at a town's edge, never on a scenic highway such as Big Sur's coast, and only fictional advertisers with 555 numbers. Their faces are our artwork: ask the still for a blank face far off and small, and put the art on it. The same paste-and-repaint method covers every kind (`sign.py`), and `sign.py fix` also repaints a sign the model drew and garbled, from its box in any frame. A clip that is not remade (a hold, a gas stop's moves) takes a sign with `sign.py place`, carried by the scene round its foot and kept behind nearer vehicles; chain it from clip to clip so it never jumps. Check each sign's exit frame by frame: a repainted face that slips off its board, or stays when the board has gone, is worse than a moment of the model's own.

**Framing a stop or a landmark.** For a stop still, say where the car is parked and what fills the bottom of the frame ("gravel right up to the fence; there is no road in front of us"), or the model may park you facing across the road. For a landmark seen from the road, curve the road away from it so its side is in view: a road that runs straight onto a bridge shows only the deck. A low sun meant to be seen goes just right of where the road disappears, not far right, where the rear-view mirror hides it.

**Wear.** Tar-sealed cracks, uneven resurfacing, worn paint, raised markers, sand and leaves at the edges, a crushed cup in the gutter. Vary it from shot to shot: one shared sentence about "patched squares" put the same two patches in the same place in every still, and that repetition is a tell of its own. When a repeat slips through, edit it out the same way as extra traffic.

**Keep it alive in the clip.** A clip prompt must describe the detail that keeps coming, not only what's in the start frame. In the town test the people in the anchor walked out of frame within two seconds, and the street the model invented after them was empty. Write "more people stroll on the sidewalks further down the street, and more cars come up the hill toward us".

## Delivery format

| | Requirement |
| --- | --- |
| Resolution | 16:9. 1920×1080 recommended, 1280×720 minimum. Upscaling 720p model output to 1080p is fine. A 1080p pack also ships a 720p rendition for small screens and slow disks. |
| Frame rate | 24 fps constant (30 allowed), the same for every clip in the pack |
| Video | H.264 High profile, `yuv420p`, in `.mp4` with `faststart`. About 4 Mbps at 1080p and 2 Mbps at 720p. |
| Keyframes | Every 2 s, with no scene-cut keyframes, so loops and seeks are clean |
| Audio | **None.** Strip any audio the model makes. VibeTour's own soundscape follows the car. The engine's pitch rises with speed and idles when stopped, road noise fades out at a stop, and wind drops to a breeze. Pick ambience such as ocean or city with `audio.ambience` in the manifest. |
| Joins | Don't bake crossfades or fades into files. The player dissolves joins and loop seams. |
| Stills | One `.webp` per anchor and stop still, at the pack's resolution. They are the posters while clips load, and the *Static scenery* and *Reduced motion* modes show them instead of video. Generate them at 2K (see below). |
| Steering track | Optional `.json` per clip with the camera yaw per frame, for the cockpit's wheel. The validator derives it from the footage if the pack doesn't ship it. |

VS Code's bundled Chromium includes an H.264 decoder, and VP9 is built into Chromium, so `.mp4` (H.264) or `.webm` (VP9) should both play. Confirming that on Windows and Linux is on the engine list.

**Resolution, from still to screen.** The still is what the video model starts from, so it sets the detail in the first seconds of every clip:

| Stage | The bake-off | Recommended |
| --- | --- | --- |
| Anchor still | 1200×896 (Gemini's default, $0.07) | 2400×1792 (`image_size: "2K"`, $0.10), cropped to 16:9 at 2400×1350 |
| Video model input | the still, cropped and downscaled to 1280×720 | the 2K crop, scaled to the model's output size |
| Plate | 768p (HeyGen), 720p (Veo 3.1 Lite) | 1080p for a pack you sell: Veo 3.1 Lite at 1080p ($0.05/s), or 720p upscaled |
| Cockpit | 1200×896 | 2K, generated once per car, for a 1080p composite |

Draft at 768p or 720p while you choose shots; a retake at a higher resolution is a new generation, not an upscale of the one you approved, so decide the release resolution before the final takes.

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

**Make a transition by driving, not by fading.** A transition is longer than one Veo shot, so chain two: the second starts on the first's last frame, which makes that join exact. Don't give the second shot the next scene's still as its last frame. On 13 October Veo 3.1 Lite cross-faded into the landing still every time it was given a different-looking one: the Big Sur cliffs faded in over the Highlands road, a meadow appeared under the car on the way into the Little Sur valley, and a see-through second copy of a sign drifted in on the way into the tree tunnel. Instead, describe the change in the prompt and let the player's dissolve join the transition to the next scene. Even without a landing frame, Veo cross-fades when asked for a large change (out of a forest into open grassland) within 8 s, so give a big change a 12 s shot (HeyGen) or trim the clip before the fade. When a clip must land exactly on a still (a pull-in, a tunnel entry), use Seedance 2.0, which drove into its landing still cleanly in 4 of 4 shots.

Loops that will play for a long time (`stop-hold`, `checkpoint-hold`, `arrival-hold`) should move only gently: waves, clouds, leaves, tunnel lights. A hold made with the same still as its first and last frame loops cleanly (seam SSIM 0.98 on both California Coast holds), and about 5% of its pixels change over the loop: surf, cloud and people shifting. That is about right for a stop. Make them 15–30 s so the repeat isn't obvious. A second hold clip helps on long stops: agents can wait 30 minutes, and a parked trip can wait for days.

## The cockpit layer

For maintainers and car designers. Packs don't ship cockpits; VibeTour does, one per car, and the user picks one.

**Generate the cockpit square to the car.** The camera is at the driver's eye, looking straight ahead: wheel hub at the horizontal centre, windshield symmetric, an A-pillar at each edge, the rear-view mirror housing top centre-right, a sliver of the door mirror at the far left. Asking for an off-centre framing in the prompt *turns the cabin*, which points the car at the shoulder; if an off-centre crop is ever wanted, crop a wider straight-ahead still. Generate at 4:3 and crop 16:9 from the top, so the forearms run out of the bottom of the frame and the rotated wheel cutout never shows its edge.

**Keep the whole wheel in view.** From the driver's eye the top of the rim should sit clearly below the windshield's bottom edge, or clearly in front of it. A rim that just touches the glass line merges with the windshield seal and looks cut off. Ask for it in the prompt ("the top of the steering wheel rim sits a little below the bottom edge of the windshield"), or move the wheel layer with `wheel.offset` in `car.json`. Both cars so far needed the offset (16 and 42 px).

**Hang the rear-view mirror from the top edge.** Image models draw the mirror a third of the way down the glass, often on an overhead console with sensors and map lights, and the assembly covers a large part of the view people pay to see; it also hid road signs close on the right until they were too near to read. Ask for a small, slim mirror with a thin dark bezel and no console, and then move it: `tools/footage/mirror.py` cuts the mirror off the flat green glass, paints its place and stalk green, and pastes it hanging from the top edge with half of it in frame. Run it before the cabin edit so both stills match. The mirror's glass must keep a dark bezel, or it merges with the windshield's green and cannot be masked. Its box in `car.json` then touches the top of the frame, which is why `car-build.sh` takes the mirror masks from the boxes rather than from closed regions.

**Give the car a screen for the radio, inside the frame.** The radio, the CB band of agents and the rest of the console are dashboard, not footage: the app draws them. In the photo car they need a place on the dash: a blank, switched-off screen right of the cluster, high enough to sit well inside the 16:9 crop (the top 675 of the 896 rows) and clear of the right hand. The grand tourer came out with its head unit low on the centre stack, below the crop, so the tours of 14 October showed no radio at all and three small dials sat where people expect it. An image edit of the cabin replaced the burl panel and the small dials with one tall screen, about 165×155 px of glass. The screen shows the radio's face (band, LIVE, equalizer lights, station, song, transport, presets); tapping it, or pressing R, slides the full radio up over the lower dashboard while the road stays in view. A gauge that loses its place moves to the cluster's centre display: the grand tourer's water temperature is a bar there, under the station.

**Name the materials and light.** Charcoal everywhere reads as clay. Say what the dash is made of (leather with stitching, open-pore wood, brushed aluminium, gloss black, a perforated leather wheel with a metal spoke), ask for a backlit cluster with legible numerals and glowing needles, and say that daylight through the windshield lights the dash top. Every pane of glass, including the mirrors, is flat chroma green (#00FF00) so the renderer can key it.

**Derived assets**, all made by script from the one still:

| Asset | How |
| --- | --- |
| Cabin without the wheel | An image-model edit: "remove the steering wheel and the driver's hands and arms; show the column, cluster and lap behind them; keep everything else pixel for pixel" |
| Wheel-and-hands cutout | Where the two stills differ (colour distance): inside the wheel's disc any difference, outside it only skin-coloured ones; kept where it connects to the wheel, with the hub's centre filled; then keyed and despilled like the cabin. An earlier cutout clipped this to a disc and two forearm bands, which cut off the backs of the hands and let the cabin's vents show through them. Without the skin test, a patch of door panel that the cabin edit repainted turned with the wheel. Two repairs on top: inside the instrument cluster's box, bright pixels (bezels, numerals) count only on a clear difference, since the cabin edit re-draws the dials slightly and a bezel that came along would turn with the wheel; and where the rim's inner edge jumps outward and comes back, or runs into a hand, within 40°, the rim is filled in from the edge it jumped from. The touring sedan's black rim over its dark binnacle lost a bite at 2 o'clock that only showed on a right turn, as the dash through the rim. |
| Glass mask | The keyed still's transparent regions outside the mirror boxes. The largest is the windshield. The key is applied with a 1 px pad round the still: FFmpeg's `chromakey` reads each pixel's neighbours, and on the border row they are uninitialised, which keyed out the top row of the cockpit and let the plate show as a bright line along the top of every frame. |
| Mirror masks | The transparent pixels inside each mirror's box in `car.json`; a box may touch the frame's edge |
| Glass dirt | A procedural texture over the windshield: dust specks, a few smudges, faint streaks along two wiper sweeps and the ragged line where each wiper stops, more haze low on the glass |
| Hub position | The centre of the wheel |
| Cluster box | The instrument cluster, which keeps its glow when the cabin darkens |
| Lit boxes | Other backlit areas (the switch row) that keep their glow at night; without them the dashboard went dark at a cabin level of 0.25, which no real car does. Night now composites at 0.35 |
| Dials | The speedometer's and rev counter's centres, the angle of zero (clockwise from 12 o'clock), the sweep and the full-scale value, plus the needle length. The painted needles are inpainted out of the cabin still, and the composite draws live ones: the speedometer follows the clip (cruise speed, a crawl into and out of a stop, zero in a hold) and the rev counter idles and climbs with it. A gauge that should read a fixed value can stay painted; the grand tourer's water temperature is drawn on the cluster's centre display instead (Screens). |
| Screens | The console screen's glass and the cluster's centre display, as boxes. The app draws the radio's face on the first and the station and water temperature on the second; the footage tools draw a stand-in (`tools/footage/headunit.py`), blended onto the dark glass under the wheel and hands, so the glass keeps its sheen. The water temperature warms from cold to half over the first 45 s. |
| Wipers | Two pivots below the glass, the reach of the arms, the parked angle and the sweep, measured in the still. The glass dirt's streaks and the rain layer's blades use the same ones. |

**At play time** the renderer:

1. Draws the plate, **centred so its vanishing point sits over the wheel hub**. This is what keeps the car pointing down the road.
2. Fills each mirror with **the road already driven**, darkened 20% (`tools/footage/mirrorfeed.py`). The plates only look forward, so a mirror shows the footage from about 60 m of road back run in reverse (what a mirror shows is the road receding), at the pace the car is driving now: a crawl barely moves it, a stop freezes it 150 m back, on the road the car came in on, and after the stop it carries on from there. Count the distance in metres, not seconds: ten seconds of a crawl and a stop is a few metres, and the gas station the car had stopped at showed up behind it. It never shows the clip the car is in. The first mirrors did, each clip run backwards, and the user caught it at once: at the start of a clip the mirror showed its end, the forecourt of a gas station the car had not reached yet with a van parked on it, and the four cars that passed us showed up in the mirrors five seconds later, fronts first, driving backwards. So every moving vehicle in the background footage is painted out (each from the same place in a nearby frame where it isn't, which reads as road and hillside; a smear did not; a vehicle that no nearby frame shows clear of isn't moving, so it stays, as a parked car would in a mirror), and each vehicle that passes us is drawn back in **from behind, at the moment it passes**: big at the outer edge of the door mirror, then shrinking away down the opposite lane through the rear-view mirror towards the vanishing point, at its speed plus ours. `tools/footage/traffic.py` finds the passes (YOLOX-S from OpenCV's model zoo, tracked, a box that grows and leaves the frame past our left side); the vehicles from behind are stills in `tools/footage/traffic/`, picked by kind and tinted to the colour of the one that passed. Use the centre of the frame for the rear-view, the left edge for the door mirror. The side window is a window; the plate shows through it. At night, at dusk and in rain the mirrors **turn the lights round** on whatever lamps the painting-out leaves (the drawn-in vehicles don't light their taillights yet: a night variant needs that): a lamp in the opposite lane becomes a red taillight going away, a lamp in our lane becomes the headlights of a car following us, and at night the rest of the road behind goes dark and faintly red, lit only by our own taillights (`tools/footage/mirrorlights.py`). Lamps are found as small, very bright, roundish spots, so lane lines, reflector posts and glare don't count. 
3. Draws the cabin at the variant's **light level** (1 at midday, down to 0.35 at night; see the variants table), with the cluster's numerals and needles kept lit, and a faint, neutral light bleed (the blurred plate at 15%, luminance only) so the dash takes the scene's light, and the sweep of passing headlights, without taking its colour. Then it lights the **screens**: the radio's face on the console screen, and the station and water temperature on the cluster's centre display, dimmed to 70% at night as a real screen is.
4. Draws the wheel-and-hands cutout, at the same light level, rotated about the hub by the clip's **steering track**: the plate's camera yaw per frame, from dense optical flow near the vanishing point (the middle 30% of the width, 30–56% down) on textured pixels only, with a running median over 0.4 s to remove passing cars, then smoothed over half a second, at a fixed gain (full lock, ±12.5°, at 0.25 px per frame of yaw at 320 px wide). A straight road keeps the wheel within a degree of centre, a gentle curve turns it a few degrees, and a hairpin turns it to full lock. Scaling each clip to its own peak instead swung the wheel to full lock on straight roads. The wheel holds through curves and comes back to centre only when the road straightens. At stops the wheel centres and a "hands resting" still crossfades in. The player holds the wheel through each dissolve. A median over the whole horizon band was pulled by whichever side was nearer: on the cliffs, the hillside on the left streamed past while the sea stood still, and a left-hand curve read as a hard right.
5. Adds a windshield bloom from the plate's near-white highlights, on the glass only, desaturated.
6. Adds the **glass**: the top of the dash reflected faintly in the bottom of the windshield (18%, strongest at the bottom edge, at the cabin's light level), and the glass dirt lit by the plate's blurred highlights. Dirt only shows where bright light is behind it: a low sun, a white sky, oncoming headlights. This is what "the sun flares off the windshield" looks like, and it moves with the light.
7. For "into the sun" variants only, adds a **lens flare**: the sun found as one round clipping blob in the sky, a bloom, an anamorphic streak and tinted ghosts on the line through the frame centre, confined to the glass with faint ghosts allowed on the dash. Off by default: on a midday plate it fires on clouds. Lens-flare orbs *in the plate* are always a fault: paint them out of the still (`tools/footage/deorb.py`) and ask the clip prompt for "no lens flare, no orbs".
8. In rain, or on a wet road, wets **the other glass** too, after the cockpit (`tools/footage/glass.py`): drops on the side window that the wind pushes back and up out of view, a band of beads along its front and top edges where water blown off the windshield streams round the A-pillar, fine drops on the door mirror that collect along its bottom rim, and soft out-of-focus drops in the rear-view mirror, which shows the wet rear window. Wet glass softens the view through it a little.
   At night, a lamp seen through the side window is drawn as a small red taillight and its glare is darkened: the side window shows the far left of the forward plate, which is still ahead of the car, so a car level with the door mirror still showed its headlights there.
   In rain, draws **rain on the windshield**, under the cockpit: drops land on the glass at a steady rate (about 900 a second in steady rain), each a small lens that shows the scene behind it blurred and upside down, with a dark rim and a highlight; big drops run down the glass and leave trails; a faint wet film builds up between wipes. The **wipers** sweep from their pivots every 1.6 s and clear every drop in their path, drawn as dark blades that smear into a translucent band while they move, as a camera shutter sees them. Steering comes from the dry plate, since the blades would read as camera yaw. `tools/footage/rain.py` is the reference.
9. Where waves throw spray up beside the road, carries it onto the car (`tools/footage/spray.py`): a mist you feel more than see. Fine droplets build up on the windshield into a faint veil, brightest where the light behind is bright, until the wipers make one sweep, and one more after the spray has gone; beads collect on the front of the door mirror's silver housing, where nothing wipes them, and dry off slowly; the door mirror's glass speckles a little. Fog is different: it drips from the trees and wets everything evenly.
10. Adds fine grain over the whole frame, so plate and cabin read as one camera.
11. Adds ±1–2° of sway and a small bob keyed to speed. Nothing else.

Finger re-grips and a finger tapping the wheel are future experiments. Hands are what models get wrong most, so the cutout keeps them on the wheel.

## Production workflow

The PRD's Creator Studio steps (§52), with the tools to use today:

| # | Step | Output | Tools |
| --- | --- | --- | --- |
| 1 | **Journey Bible**: route research, scenes, scenic stops, look, prompts | `bible.md`, `shotlist.json` | Claude, or any LLM (via OpenRouter too) |
| 2 | **Anchors**: one master still per scene, then every other still edited from it so the look holds. 4:3 at 2K, cropped to 16:9 with the horizon at 45%, and judged through a cockpit before any clip is made. | `anchors/*.png` | An image model with reference input: Gemini image, gpt-image, FLUX Kontext; `vp.py`, `deorb.py`, `still.sh` |
| 3 | **Clips**: image-to-video from each still | raw shots | A video model per slot family ([choosing one](#choosing-a-video-model)) |
| 4 | **Review and retake** against the [checklist](#review-checklist) | approved shots | Your eyes, contact strips, and a composite with a cockpit, since that's what users see |
| 5 | **Finish**: trim, conform, encode, strip audio, make the 720p rendition | `clips/*.mp4` | FFmpeg; optionally Topaz Video AI or Real-ESRGAN to upscale |
| 6 | **Assemble** the manifest: scene graph, anchors, clips, stops | `manifest.json` | A text editor; `validatePack()` |
| 7 | **Test drive** every behaviour, fast-forwarded | — | `npm run demo` with `?speed=20` and the Demo controls |
| 8 | **Cover, ticket, preview, provenance**; publish | `.vibetour` package | An image model for the cover; HeyGen Video for the preview |

Only steps 2, 3 and 5 need tools from outside VibeTour. In step 3, generation is the cost. In step 4, rejection is the time. The scripts used for the bake-off (submit and poll, steering track, masks, flare, composite) are in [`tools/footage/`](../tools/footage/README.md). For Claude Code there is a project skill, [`journey-footage`](../.claude/skills/journey-footage/SKILL.md), that walks through the whole workflow with these tools.

### Prompt templates

Master anchor (step 2), at 4:3 and 2K:

```
Photograph from a forward-facing dashcam at the driver's eye height, centred in the
{right|left}-hand lane of {road description} in {scene}, {region}, on a brilliant
clear early afternoon. Sun high and to the {left|right}. Colour is vivid and true:
a deep saturated cerulean sky grading to pale blue at the horizon with a few bright
white cumulus; {water: rich cobalt turning turquoise near the shore with brilliant
white surf}; trees in several distinct greens, from dark {cypress} to bright
yellow-green scrub; {rock colour}; charcoal asphalt. Punchy contrast, deep but
detailed shadows, and natural haze on the farthest ridges. {Driving side: Americans
drive on the right: the camera is in the right-hand lane, so the double yellow
centre line runs on the camera's LEFT and the white edge line on its right.}
{Place details: a corrugated steel guardrail on weathered wooden posts; swells
crashing onto dark rocks with spray exploding upward.} {World detail, from the
tables above: a brown-shingled house up a gravel driveway with a dusty pickup in
front, a wooden mailbox, a green wheeled bin; a utility pole with sagging wires and
two crows on the wire; a small white sign reading SPEED LIMIT 25; far down the road,
one oncoming car in the opposite lane on the camera's left.} Any text on signs is
short, correct and plainly printed, exactly as quoted; every other sign is too far
away to read. No real brand names or logos, no readable licence plates. People look
natural and candid, at rest or walking slowly, never posing, nobody running. It must
look like a real, unretouched photograph of an ordinary day, not a render, not CGI,
not a postcard: the road is used, with {wear: tar-sealed cracks, worn paint, raised
reflective markers, sand and leaves at the edges}. Fine natural grain, no
over-sharpening, no HDR halos. Level camera at the driver's eye height: the road's
vanishing point at the horizontal and vertical centre of the frame. 24 mm lens.
Nothing of our own car: no hood, dashboard, glass or wipers. No lens flare, no sun
spots, no orbs. Not beige, not muted, not golden-hour, not faded.
```

Spell out the driving side by naming where the centre line runs. "The right-hand lane" alone put the camera in the wrong lane in one anchor of three. Ask for no lens flare: without it, Gemini added faint flare orbs to the sky in a third of the stills, and the video models animate them. Even with it, one still in fifteen had orbs; paint them out with `deorb.py`.

Say "photograph", not "photorealistic". Change the world detail and the wear in every still, so no two look stamped from one template.

Any other still in the scene: the same prompt with the change you want ("the road curves left between granite outcrops"; "a small gas station on a gravel forecourt sits ahead-right"), with the master attached, plus "Match the colour, light, palette and photographic style of the reference image exactly, but not its emptiness." When the master predates a realism pass, attach a lived-in still as a second reference: "The first reference image sets the place, colour and light; the second sets how real and lived-in the world looks." For a variant (sunset, night, rain), attach the place's still but say "Use the reference images for the kind of place and the photographic style only; the light, sky and weather are as described here." To join two variant stills, make the second from the first: the two rain stills on 13 October match because the second was made from the first.

Clip (step 3, start still attached):

```
Smooth forward drive along {road description} at a steady 60 km/h, centred in the
{right|left}-hand lane, no lane changes, no turns. {What happens: the road curves
gently right past the guardrail.} {Events: every few seconds a wave hits the rocks
below and white spray explodes upward and hangs in the air before falling back.}
{Traffic: the oncoming camper van in the opposite lane on our LEFT keeps to its own
lane and passes us on the left.} {Life that keeps coming: more people stroll on the
sidewalks further down the street; birds stay perched on the wires.} Everything that
is parked stays parked; every building, pole, sign and tree is solid and stays
rooted, passing only as we move; nothing fades in or out. Signs keep their exact
text. People move slowly and naturally; nobody runs. Keep the exact colour and light
of the start frame throughout: {the palette, in the anchor's words}. The camera is
fixed to the car and always faces straight along the road ahead: the road's
vanishing point stays at the centre of the frame from the first frame to the last,
and the camera never pans or turns towards the sea or the view. Camera locked at
the driver's eye height, no shake; the horizon stays where it is in the start
frame. Nothing of our own car: no hood, dashboard, glass or wipers. No lens flare,
no orbs. No audio, no music.
```

Add, depending on the slot:

- **A stop beside the road is driven as a lane change.** The user drew the gas stop: slow down on the approach, ease right by one car width off the lane onto the forecourt's edge about five car lengths before the pumps, straighten so the car faces along the road exactly as before, and stop two car lengths short, with the road right beside the left wheels and the pumps and the shop ahead to the right. Leave the same way: ease left back into the lane and straighten. A video model can do that, because the camera never turns: Seedance 2.0 drove it first time from the approach still to the parked still (last frame), with "the camera keeps facing straight along the road the whole time, turning no more than a few degrees while the car eases over, exactly as in a gentle lane change". Make the parked still as an **edit of the approach still** that moves the camera forward and over and keeps it pointing the same way; two fresh generations came out angled 15° towards the station. Its road lines are all on the left, so find its vanishing point from them and crop round it (`vp.py` assumed the centre). For a refuel, the car at the pump leaves and we creep into its bay; an edit could not move the camera up to the pump (it drew a pump beside us and left the shop the same size), so the creep ends where the model takes it, and the pump hold and the pull-out start from its last frame. Give the pull-in a smooth slowdown for the dials: the measured one dips and rises, because the lane change and the oncoming cars move the ground too.
- **Stops are cut, not driven.** No video model tested (Seedance 2.0, Veo 3.1 Lite, HeyGen) can turn a car off the road into a stop: asked to, it swings the camera round on the spot and the car seems to float sideways. So the car never turns on camera at a stop. `tools/footage/ramp.py` re-times a plate: `stop` plays the approach at speed and slows it evenly to a crawl over the last few seconds; a 1 s dissolve lands the car parked and facing the view (the hold); after the hold a dissolve picks the next cruise plate up from a crawl (`start`). Only straight moves are generated: a creep forward to the pump, a hold. The needles follow: each re-timed clip carries its speed per frame, and the cockpit's dials read it. A generated straight move needs one too, measured from the clip (`tools/footage/speed.py`): without it the creep to the pump read 55 km/h between two stops.
- **`stop-in`** (if you still generate one, from the approach still): "gradually slows, turns gently right off the road onto {the forecourt}, straightens up to face {the pumps and the shop}, and rolls to a smooth complete stop {fifteen metres short of the pumps}, exactly as in the last frame. The camera is fixed to the car and turns only as the car turns, through about forty degrees to the right; the car never slides sideways, never drifts backwards, never rises or floats. The deceleration is smooth and the stop is gentle, with no lurch." Add the seated-height line to every stop clip: "Camera level at the seated driver's eye height, about 1.1 m above the ground, lower than the roofs of the parked cars."
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
top. A tall built-in screen in the centre of the dash, right of the cluster and level
with it, switched off: plain black glass. No logos, badges, brand marks or screens with
content. The entire windshield,
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
| `cruise`, `transition`, `landmark`, `approach` | **Veo 3.1 Lite** | Full-speed, steady drives at $0.03/s. Animates named events (waves, a rail sliding past). One ghost-object morph in nine shots. Cross-fades instead of driving when given a different scene's still as its last frame, or a big change in 8 s; see [Joins and loops](#joins-and-loops). |
| `stop-in`, `*-hold`, `stop-out` | **Seedance 2.0 Fast** | The only model that drove into the stop; holds are still with gentle motion. About $0.09/s ($0.91 for 10 s, $1.37 for 15 s). Two full stop sets with three retakes cost $9.10. |
| cruise plates on a budget; trailers and previews | **HeyGen Video** | $0.015/s at launch, $0.03 list, at 768p; matches the look; animates events. Can't hold a camera still, and drifts to invented lane markings in one shot of three. Longest clips (15 s). With lived-in stills and the clip block in the prompt kit, the 17 California Coast cruise plates kept traffic on the correct side, parked things parked and people walking. But 7 of them, every coast road with the sea on the right, turned the camera towards the sea after 6–8 s, until the road left the frame. All 7 retakes passed with one added sentence ("the camera is fixed to the car and always faces straight along the road ahead … never pans or turns towards the sea") and a new seed. |

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

OpenRouter doesn't keep generated videos permanently, so download them straight away. A key carries its own spending cap, separate from the account balance, and refuses image and video requests once less than $1.00 is left under that cap, whatever the account holds.

HeyGen direct ([docs](https://developers.heygen.com/docs/models/heygen-video)): `POST https://api.heygen.com/v3/models/videos` with `x-api-key`, `{"model":"heygen-video-1","mode":"image_to_video","prompt":…,"duration":12,"resolution":"768p","seed":7,"prompt_enhancement":"disabled","image":{"type":"base64","media_type":"image/jpeg","data":…}}`; poll `GET /v3/models/videos/{id}`. 1080p and 2K bill at three times the 768p rate. Turn off the wallet's auto-reload while experimenting.

### What a pack costs

The generated seconds from [How much to make](#how-much-to-make), with cruise and transitions on one model and stops and holds (about 12% of the seconds) on Seedance 2.0 Fast:

| Cruise model | Economy (~360 s) | Standard (~1,200 s) | Cinematic (3,600–4,800 s) |
| --- | --- | --- | --- |
| HeyGen Video at $0.015 | ~$10 | ~$29 | $85–115 |
| Veo 3.1 Lite at $0.03 | ~$14 | ~$45 | $130–175 |
| Seedance 2.0 Fast throughout | ~$32 | ~$110 | $320–430 |

Stills cost about $0.10 each at 2K with Gemini image ($0.07 at its default size); a Standard pack needs 10–15, plus retakes and variants. Language models and encoding cost little next to the video.

Retakes are the biggest cost. Every rejected shot is paid for. A tight camera spec and good anchors save more than a cheaper model does.

## Review checklist

Judge shots **through a cockpit**, not bare: the renderer's demo can composite any clip. Reject and retake a shot that has any of these:

- [ ] Road layout drifts or morphs: lanes appear or vanish, the road bends impossibly, a new lane marking appears
- [ ] Wrong driving side, a lane change, a turn, or a pull-in to the wrong side
- [ ] The camera turns away from the road towards the view: the road's vanishing point strays more than 20% of the frame's width from the centre (`tools/footage/drift.py` measures it every half second). Through a cockpit it looks like the car leaving the road.
- [ ] Shake, roll, a zoom, or a jump in apparent speed; a crawl at half speed
- [ ] A hold whose camera drifts or reverses
- [ ] A stop still or clip whose camera is too high: the horizon above standing people's heads, parked cars seen from above, a pull-in that slides sideways to reach it
- [ ] A ghost: a translucent object crossing the frame, or scenery that fades in over the road
- [ ] Any part of a car, glass or reflection
- [ ] By day, a vehicle close ahead in our lane; oncoming traffic in our lane; cars that melt, merge or move while parked
- [ ] Garbled text that stays on screen, real logos, readable licence plates
- [ ] Lens-flare orbs in the part of the sky the windshield shows. HeyGen added faint orbs near the top of the frame in about half of the 17 California Coast plates; the cockpit's headliner and rear-view mirror hide the top 17% of the plate, so only orbs below that are faults.
- [ ] People running, posing for the camera, or standing in the road
- [ ] An empty world: the life in the start frame passes and nothing replaces it
- [ ] The same detail in the same place in shot after shot
- [ ] Light or palette that doesn't match the scene's anchor: a beige cast, a different sun
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
  "look": { "variant": "vivid-midday", "sunInFrame": false, "cabinLight": 1 },
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
    { "id": "gas-out",    "slot": "stop-out",   "scene": "*",         "from": "gas",          "to": "bigsur", "file": "clips/gas-out.mp4" },
    { "id": "breakdown",  "slot": "cruise",     "scene": "bigsur",    "from": "bigsur",       "once": true,   "file": "clips/breakdown.mp4" }
  ]
}
```

Durations come from the files. `once` marks a set-piece clip (a breakdown on the shoulder) that the player shows at most once per trip. `look.cabinLight` is the cabin's light level for the variant, from the variants table in [Camera and look](#camera-and-look). The validator would check:

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
   - shuffled cruise clips, with `once` clips shown at most once a trip
   - windshield rain and wipers in rain variants, from the car's wipers, and wet side glass and mirrors
   - mirror lights turned round at night, at dusk and in rain
   - stop, checkpoint and approach sets
   - transitions when progress crosses into the next scene
   - playback rate from speed
   - one-second dissolves at every join and loop seam, early when the next boundary is far away

   It plays through two `<video>` elements so joins can be blended. It's chosen when `media.kind === "video"`, and the procedural renderer stays for everything else.
2. **Cockpit layer.** A car library and a compositor that draws plate, mirrors, cabin, wheel, bloom, glass and grain as in [The cockpit layer](#the-cockpit-layer), with the wheel driven by each clip's steering track and held through dissolves, and the cabin lit at the variant's `cabinLight`. The library has started: [cars/](../cars/README.md) holds the first car (the still, the no-wheel edit, the wheel cutout, the masks, the glass dirt and a `car.json` with the hub and cluster), and `tools/footage/car-build.sh` derives the assets. Still to build: the compositor in the renderer, a car picker, and a `vibetour car build` command.
3. **Steering tracks.** Derive camera yaw per frame from each clip at pack-build time (`tools/footage/steer.py` is the reference), ship it as `*.steer.json`, and fall back to deriving it on first play.
4. **Packs from disk.** Today packs are bundled at build time (`src/packs/index.ts`). Video packs need a user pack folder, `localResourceRoots` for the webview, and a static route on the companion server.
5. **Schema and validator.** Add the `media` block to `JourneyPack`, plus the checks above in `validatePack()` and a `vibetour pack validate <dir>` command for creators.
6. **Codec check.** Confirm H.264 `.mp4` plays in VS Code webviews on Windows and Linux. Fall back to VP9 `.webm` if it doesn't.
7. **Static scenery with stills.** Use anchor stills for *Static scenery*, *Reduced motion* and *No camera motion*.
8. **Later: Journey Studio.** A `vibetour studio` command that runs the workflow above with the creator's own API keys (BYOK, PRD §43). One adapter per provider, all behind one call: `generateClip({ firstFrame, prompt, seconds, model })`. Start with OpenRouter and HeyGen, since between them they reach every model above.
