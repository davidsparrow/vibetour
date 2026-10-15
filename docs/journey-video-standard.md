# Journey Video Standard

**Status: draft 0.1, proposed.** Today every built-in pack is procedural (see [journey-packs.md](journey-packs.md)). VibeTour can't play video packs yet. This standard says what a video Journey Pack must contain, so the packs we and creators make now will play once the video renderer lands. [Engine work this assumes](#engine-work-this-standard-assumes) lists what has to be built first.

It applies to every video pack: VibeTour Originals, community packs and packs sold in the marketplace (PRD §50).

## The idea

**A journey is not a movie.** A ticket says "about 90 minutes", but that time is *productive coding time*, set by the Journey Engine (`approxMinutes` in the manifest). The footage doesn't have to last 90 minutes.

A video pack is a **vocabulary of short clips** that start and end on shared frames. VibeTour chains them for as long as the session lasts:

- cruise clips shuffle endlessly while you work
- a stop sequence plays when the car has to stop
- a tunnel plays while tests run
- the approach and arrival play when you finish

So you never film or generate "a 90-minute journey". You make somewhere between 3 and 40 minutes of joinable footage, depending on the tier. How much you make sets how *varied* the trip feels, not how *long* it is.

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

**Timing.** The dashboard reacts within 250 ms. Footage changes at the next clip boundary. If that boundary is more than 6 s away, VibeTour dissolves early. Keep cruise clips 6 to 16 s long so the scenery never lags far behind.

## Building blocks

| Term | Meaning |
| --- | --- |
| **Shot** | One generation from a video model, usually 5 to 12 s |
| **Clip** | A finished file in the pack, made from one or more shots. The unit VibeTour plays. |
| **Anchor** | A still frame that clips start and end on. Two clips can play back to back when the first ends on the anchor the second starts on. |
| **Scene** | A node of the pack's scene graph (PRD §40): one stretch of road with its own look, such as *Carmel coast* or *Big Sur cliffs* |
| **Slot** | The job a clip does: `cruise`, `checkpoint-in`, `stop-hold`… |
| **Set** | The in → hold → out clips of one stop or checkpoint |

Each scene has one to three **road anchors**. Its cruise clips run between them, so the scene can play forever without repeating in a fixed order:

```
                            cruise-02
                ┌───────────────────────────────┐
                ▼                               │
           [carmel-1] ──── cruise-01 ────► [carmel-2] ── transition ──► [coast-1] …
     stop-in │   ▲ stop-out
             ▼   │
           [overlook]  stop-hold loops here
```

## Slots

| Slot | From → to | Length | Required | If missing |
| --- | --- | --- | --- | --- |
| `departure` | start frame → first road anchor | 8–30 s | **yes**, 1 | — |
| `cruise` | road anchor → road anchor (same scene) | 6–16 s | **yes**, at least 4 per scene | — |
| `transition` | last anchor of a scene → first anchor of the next | 8–20 s | **yes**, one per scene-graph edge | — |
| `stop-in` · `stop-hold` · `stop-out` | road anchor → stop anchor; stop → stop (loop); stop → road anchor | 6–12 s · 15–30 s · 6–12 s | **yes**, 1 set | — |
| `approach` | last scene's road anchor → arrival anchor | 15–40 s | **yes**, 1 | — |
| `arrival-hold` | arrival anchor → arrival anchor (loop) | 15–30 s | **yes**, 1 | — |
| `checkpoint-in` · `checkpoint-hold` · `checkpoint-out` | road → tunnel; tunnel → tunnel (loop); tunnel → road | 6–12 s · 8–16 s · 6–12 s | recommended, 1 set | Cruise clips; the dashboard still shows *Verifying* |
| `landmark` | road anchor → road anchor | 10–30 s | optional | Cruise clips |
| `shoulder-in` · `shoulder-hold` · `shoulder-out` | like the stop set, on the road shoulder | as stop | optional | The stop set |
| `park-hold` | any → park anchor (loop) | 15–30 s | optional | `stop-hold` |
| more `stop-*` sets | one per scenic stop (overlook, café, beach…) | as stop | optional | The first stop set |

**Rest stops and incident scenes: the whole list.** A pack needs exactly **one stop set** (three clips), and it serves every stop reason:

- an agent waiting for you
- your turn
- idle
- blocked
- parked

One **checkpoint set** is recommended for tests. Everything beyond that is optional. Each optional slot only adds variety, and every one has a fallback.

The checkpoint set is the most satisfying optional one. The hold loops for as long as the tests run (tunnel interiors loop well), and the exit into daylight lands when the run ends: *tests pass, the road opens up*.

## How much to make

| | Economy | Standard | Cinematic |
| --- | --- | --- | --- |
| Good for | Coffee Run (15–30 min) | Day Trip (45–90 min) | Scenic Drive and longer |
| Scenes | 1 | 3–5 | 6–10 |
| Variants (time of day / weather) | 1 | 1 | 2–3 |
| Road anchors per scene | 2 | 2–3 | 3 |
| Cruise clips | 8 | 6–8 per scene | 8–12 per scene |
| Stop sets / checkpoint sets | 1 / 1 | 2 / 1 | 3–4 / 1–2 |
| Landmarks | 0 | 1–2 | 3–6 |
| Clips in total | ~17 | ~45 | ~150 |
| Unique footage | ~3.5 min | ~10 min | 25–40 min |
| Generated seconds, with retakes | ~6 min | ~20 min | 60–80 min |
| Pack size at 1080p (the 720p rendition adds about half) | ~90 MB | ~260 MB | 0.7–1 GB |

"With retakes" assumes 40–50% of shots get rejected. [Choosing a video model](#choosing-a-video-model) prices these tiers.

Economy feels like a looping screensaver, but a pretty one. Most of the extra cost of Standard goes into cruise variety, which is what people notice. More stops matter less.

**How often a clip comes round.** Yes, clips repeat. They play like a playlist on shuffle, never in a fixed order:

| Tier | Cruise footage per scene | Time in each scene |
| --- | --- | --- |
| Economy | about 90 s | the whole trip |
| Standard, on a 90-minute trip | about 75 s | about 20 minutes |
| Cinematic | about 2 min | about 10 minutes |

So within a scene, any one cruise clip comes back every one to two minutes. Stops and tunnels break the run up, and the scenery changes as you move from scene to scene.

To repeat less, add cruise clips. Each extra minute of cruise footage takes about 120 generated seconds, retakes included:

- about $4 with Veo 3.1 Lite
- about $10 with Veo 3.1 Fast or Kling 3.0
- about $24 with Veo 3.1

## Camera and look

These rules are what make clips joinable. Every clip in a pack follows the same ones.

- **Point of view:** forward-facing, from the driver's eye line in the middle of the lane, about 1.3 m up. Level horizon, no roll, no pitch.
- **No car:** no hood, dashboard, wipers, mirrors, hands, glass or reflections. VibeTour draws its own cockpit over the footage.
- **Lens:** about 24–28 mm full-frame equivalent (65–75° horizontal), the same for the whole pack.
- **Framing:** put the road's vanishing point at the horizontal centre, 40–45% from the top. In Dashboard Mode the cockpit covers the bottom 30% and the rear-view mirror covers the top-centre 15%, so keep landmarks and the horizon in the band between.
- **Motion:** smooth and stabilised, a steady 50–70 km/h look. Use the same apparent speed in every moving clip. Slow down and speed up only in `stop-in`, `stop-out`, `departure` and the end of `approach`.
- **Road:**
  - drive on the side the manifest's `drivingSide` says
  - stay in lane, with no lane changes, overtakes or turns
  - anchors sit on straight or gently curving road
- **Traffic:** nothing directly ahead in your lane, because models morph cars. Sparse oncoming traffic is fine. Keep pedestrians away from the camera.
- **Text:** no legible signs, brands, logos or licence plates. Models garble text, and real brands aren't ours to use.
- **Light:** within a variant, every clip shares one time of day, weather and sun direction. Only `approach` and `arrival-hold` may move towards the variant's `arrivalTimeOfDay` (golden hour → sunset).
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
| Joins | Don't bake crossfades or fades into files. The player blends joins and loop seams. |
| Stills | One `.webp` per anchor, at the pack's resolution. They are the posters while clips load, and the *Static scenery* and *Reduced motion* modes show them instead of video. |

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

# First and last frame, to check a join against its anchors
ffmpeg -i out.mp4 -frames:v 1 first.png
ffmpeg -sseof -0.05 -i out.mp4 -frames:v 1 -update 1 last.png
```

## Joins and loops

The hard part of video packs is getting clips to meet. Use these techniques, best first:

1. **First and last frame.** Generate the anchors as stills first. Then make each clip with a model that takes both a start frame and an end frame: the clip starts on its `from` anchor and ends on its `to` anchor. Loops (`cruise` A→A, every `*-hold`) use the same anchor at both ends.
2. **Chain from the last frame.** For a longer clip, generate a shot, take its last frame and use it as the next shot's start frame. Close the chain with a first-and-last-frame shot that lands on the anchor. Two cautions:
   - Models tend to ease the camera to a halt in a shot's final second. Take the seed frame from before the last 10–15% and trim there, or every join stutters.
   - Errors build up after three or four chained shots. Go back to an anchor before then.

   Where a model can *extend* a shot (Veo 3.1, Luma, LTX), extending carries motion across the join better than chaining.
3. **Hide the cut.** Tunnels, bridges, overpasses, tight bends, tree cover, fog banks and crests all hide a join, so put `transition` clips through one.
4. **Dissolve.** When frames still don't quite match, the player blends the join over a few frames. Because every clip follows the same camera rules, near-misses dissolve cleanly. The validator flags joins that will show (*proposed*: first or last frame below 0.85 SSIM against its anchor).

Loops that will play for a long time (`stop-hold`, `checkpoint-hold`, `arrival-hold`) should move only gently: waves, clouds, leaves, tunnel lights. Make them 15–30 s so the repeat isn't obvious. A second hold clip helps on long stops: agents can wait 30 minutes, and a parked trip can wait for days.

## Filmed footage

Dashcam footage you shoot yourself has the cleanest rights. Set `provenance.generation` to `"captured"`.

- **Camera:** the same rules apply. Mount it at eye height in the middle of the windshield, with the hood out of frame. Stabilise it, and lock exposure for each scene.
- **Stops:** park and film for 30 s, and you have a hold.
- **Joins:** harder than with AI footage, because you can't choose end frames. Cut on straight road at a matching lane position, and let the player dissolve.

Stock sites such as Pexels and Pixabay allow commercial use. But their terms forbid passing clips on as standalone content, and forbid compiling them into a similar or competing service. A pack made mostly of stock driving clips is high-risk without written permission.

## Production workflow

The PRD's Creator Studio steps (§52), with the tools to use today:

| # | Step | Output | Tools |
| --- | --- | --- | --- |
| 1 | **Journey Bible**: route research, scenes, scenic stops, look, prompts | `bible.md`, `shotlist.json` | Claude, or any LLM (via OpenRouter too) |
| 2 | **Anchors**: a style master frame first, then each anchor edited from it so the look holds | `anchors/*.png` | An image model with reference or edit input: gpt-image, Gemini image, FLUX Kontext |
| 3 | **Clips**: image-to-video from anchor to anchor | raw shots | A video model with first-and-last-frame input ([choosing one](#choosing-a-video-model)) |
| 4 | **Review and retake** against the [checklist](#review-checklist) | approved shots | Your eyes; any video player |
| 5 | **Finish**: chain, trim, conform, encode, strip audio, make the 720p rendition | `clips/*.mp4` | FFmpeg; optionally DaVinci Resolve (free) to inspect; optionally Topaz Video AI, Real-ESRGAN or RIFE to upscale or interpolate a low-res or 16 fps model |
| 6 | **Assemble** the manifest: scene graph, anchors, clips, stops | `manifest.json` | A text editor; `validatePack()` |
| 7 | **Test drive** every behaviour, fast-forwarded | — | `npm run demo` with `?speed=20` and the Demo controls |
| 8 | **Cover, ticket, provenance**; publish | `.vibetour` package | An image model for the cover |

Only steps 2, 3 and 5 need tools from outside VibeTour. In step 3, generation is the cost. In step 4, rejection is the time.

### Prompt templates

Anchor still (step 2):

```
Photorealistic still from a forward-facing dashcam, driver's eye height,
centred in the {right|left}-hand lane of {road description} in {scene}, {region}.
{time of day}, {weather}, sun {direction}. Level horizon; the road's vanishing point
at the horizontal centre, 42% from the top. 26 mm lens. No car hood, dashboard,
glass or reflections. No vehicles ahead. No legible signs or text. Match the
colour, light and style of the reference image.
```

Clip (step 3, with start and end frames attached):

```
Smooth forward drive along {road description} at a steady 60 km/h,
camera locked at driver's eye height, centred in the {right|left}-hand lane, no shake,
no lane changes. {What happens: gentle left curve past cypress trees}.
Keep the light, weather and style of the start frame. No vehicles ahead, no text,
no people near the road. Ends exactly on the end frame. No audio.
```

Add, depending on the slot:

- **`stop-in`:** "slows down and pulls into {overlook}, coming to a stop facing the view"
- **`stop-out`:** "pulls back onto the road and accelerates to cruising speed"
- **`*-hold`:** "stationary camera, only {waves / clouds / leaves} move, seamless loop"

## Choosing a video model

Prices and catalogues are as of 10 October 2026. Both change often, so check them before a big run.

A model works for VibeTour if it has:

- **image-to-video with both a first and a last frame.** This is required, because it's how joins and loops work.
- clips of at least 5 s
- 720p or better
- audio off. Audio usually costs extra, and the pack ships without it anyway.
- terms that allow commercial use of its output, if you'll sell the pack

**Make a whole pack with one model** so the look matches. To pick it, generate the same three test clips (a cruise, a `stop-in`, a hold) on two or three candidates. That costs a few dollars.

### OpenRouter: one key for the whole pipeline

OpenRouter added video generation in April 2026. One API key reaches:

- about 30 video models
- image models for anchors and covers (Gemini image, GPT Image)
- the language models for the Journey Bible

First and last frames are the same field for every model that supports them ([docs](https://openrouter.ai/docs/cookbook/video-generation/image-to-video)):

```jsonc
// POST https://openrouter.ai/api/v1/videos  →  202 with an id; poll GET /api/v1/videos/{id}, then download its content
{
  "model": "<a video model id>",
  "prompt": "Smooth forward drive along …",
  "frame_images": [
    { "type": "image_url", "image_url": { "url": "…/anchors/carmel-1.png" }, "frame_type": "first_frame" },
    { "type": "image_url", "image_url": { "url": "…/anchors/carmel-2.png" }, "frame_type": "last_frame" }
  ]
}
```

`GET /api/v1/videos/models` lists each model's frame support, durations and prices. OpenRouter doesn't keep generated videos permanently, so download them straight away. The endpoint isn't covered by Zero Data Retention, which is fine for scenery.

### Models that fit

On OpenRouter unless noted, with audio off:

| Model | Shot length | Resolution | Price per second |
| --- | --- | --- | --- |
| Veo 3.1 Lite | 4–8 s | 720p | $0.03 |
| Hailuo 3 Max | 5–15 s | 480–768p | $0.05–0.08 |
| Veo 3.1 Fast | 4–8 s | 720p | $0.08 |
| Kling 3.0 Standard | 3–15 s | 720p | $0.084 |
| Wan 2.7 | 2–10 s | up to 1080p | $0.10 |
| Veo 3.1 | 4–8 s | 720p–4K | $0.20 ($0.40 with audio) |
| Wan 2.2 with Fun-Inp, open weights (Apache-2.0), self-hosted | ~5 s | 480–720p at 16 fps | roughly $0.015–0.02 on a rented H100 (our estimate, unbenchmarked) |

All of these accept a first and a last frame.

Not usable as of this date:

- Wan 3.0 and Runway Gen-4.5 take a first frame only on OpenRouter.
- OpenAI shut Sora 2 down on 24 September 2026.

Outside OpenRouter, Luma Ray 3.2 (keyframes, about $0.06/s at 720p) and LTX-2.3 (open weights, with an extend mode) also fit.

### What a pack costs

The generated seconds from [How much to make](#how-much-to-make), times the price:

| Price | Economy (~360 s) | Standard (~1,200 s) | Cinematic (3,600–4,800 s) |
| --- | --- | --- | --- |
| $0.03 (Veo 3.1 Lite) | ~$11 | ~$36 | $110–145 |
| ~$0.08 (Veo 3.1 Fast, Kling 3.0 Standard) | ~$30 | ~$100 | $290–400 |
| $0.20 (Veo 3.1) | ~$72 | ~$240 | $720–960 |

Stills, language models and encoding cost little next to the video.

Retakes are the biggest cost. Every rejected shot is paid for. A tight camera spec and good anchors save more than a cheaper model does.

Self-hosting Wan 2.2 only pays off at Cinematic scale or for many packs. It needs a GPU setup, and 16 fps output has to be interpolated to 24 (RIFE).

## Review checklist

Reject and retake a shot that has any of these:

- [ ] Road layout drifts or morphs: lanes appear or vanish, the road bends impossibly
- [ ] Wrong driving side, a lane change, or a turn
- [ ] Shake, roll, a zoom, or a jump in apparent speed
- [ ] Any part of a car, glass or reflection
- [ ] A vehicle ahead in the lane, or cars that melt or merge
- [ ] Legible or garbled text, logos, licence plates
- [ ] Light or weather that doesn't match the scene's anchors
- [ ] A last frame that doesn't land on its anchor (check `last.png`)
- [ ] Flicker, smearing, or detail boiling in foliage and water
- [ ] Anything unsafe or alarming: no crashes, near misses or emergencies, ever (PRD §41)

## Manifest additions (proposed)

A video pack keeps everything a procedural pack has: ticket, route, variants, scene graph, scenic stops, facts, audio and provenance. Set `provenance.generation` to `"ai-video"` (or `"captured"` for filmed footage). It also adds a `media` block. Clip `scene` ids are scene-graph node ids (these are California Coast's), and `"*"` means any scene. In this short example the approach leaves straight from Carmel; a real pack's approach starts in its last scene:

```jsonc
"media": {
  "kind": "video",
  "format": { "width": 1920, "height": 1080, "fps": 24, "codec": "h264" },
  "renditions": { "720p": "720/" },
  "anchors": {
    "start":    { "still": "anchors/start.webp" },
    "carmel-1": { "still": "anchors/carmel-1.webp" },
    "carmel-2": { "still": "anchors/carmel-2.webp" },
    "overlook": { "still": "anchors/overlook.webp", "stop": "Bixby Creek Overlook" },
    "big-sur":  { "still": "anchors/big-sur.webp" }
  },
  "clips": [
    { "id": "depart",       "slot": "departure",    "scene": "departure", "from": "start",    "to": "carmel-1", "file": "clips/depart.mp4" },
    { "id": "carmel-01",    "slot": "cruise",       "scene": "carmel",    "from": "carmel-1", "to": "carmel-2", "file": "clips/carmel-01.mp4" },
    { "id": "carmel-02",    "slot": "cruise",       "scene": "carmel",    "from": "carmel-2", "to": "carmel-1", "file": "clips/carmel-02.mp4" },
    { "id": "overlook-in",  "slot": "stop-in",      "scene": "*",         "from": "carmel-1", "to": "overlook", "file": "clips/overlook-in.mp4" },
    { "id": "overlook",     "slot": "stop-hold",    "scene": "*",         "from": "overlook", "to": "overlook", "file": "clips/overlook-hold.mp4" },
    { "id": "overlook-out", "slot": "stop-out",     "scene": "*",         "from": "overlook", "to": "carmel-1", "file": "clips/overlook-out.mp4" },
    { "id": "approach",     "slot": "approach",     "scene": "arrival",   "from": "carmel-2", "to": "big-sur",  "file": "clips/approach.mp4" },
    { "id": "arrived",      "slot": "arrival-hold", "scene": "arrival",   "from": "big-sur",  "to": "big-sur",  "file": "clips/arrival.mp4" }
  ]
}
```

Durations come from the files. The validator would check:

- every file exists, matches `format` and has no audio
- every required slot is filled
- each scene's cruise clips connect all its road anchors, so the scene can play forever
- every scene-graph edge has a transition
- each clip's first and last frames match its anchors (warning only)
- the pack fits its tier's size limit

## Rights, provenance and honesty

From PRD §53, §54 and §79:

- **Your model's terms must allow commercial use and resale of what it generates.** Check this before you generate a pack you plan to sell. Terms differ between models and plans, and they change. For example, Google says it claims no ownership of Veo output, but gives no express commercial grant, and Veo marks output with an invisible SynthID watermark.
- `provenance` names the models used for stills and video, any reference footage or photos and their licences, and the audio sources.
- No copyrighted worlds or characters, real brands or branded vehicles, real people, or music without rights.
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
4. A cover, a ticket image and a 20–30 s preview, cut from the pack's own clips.
5. A test drive through every behaviour with no checklist failures.
6. One `.vibetour` file (a zip of the pack folder, PRD §81) under the tier's size limit.

## Engine work this standard assumes

For maintainers. None of this exists yet:

1. **Video renderer.** A *Video Director* that turns the existing `motion` and `journey` snapshot into a playlist:
   - shuffled cruise clips
   - stop, checkpoint and approach sets
   - transitions when progress crosses into the next scene
   - playback rate from speed
   - early dissolves when a join is far away

   It plays through two `<video>` elements, so joins and loop seams can be blended. It's chosen when `media.kind === "video"`, and the procedural renderer stays for everything else.
2. **Packs from disk.** Today packs are bundled at build time (`src/packs/index.ts`). Video packs need a user pack folder, `localResourceRoots` for the webview, and a static route on the companion server.
3. **Schema and validator.** Add the `media` block to `JourneyPack`, plus the checks above in `validatePack()` and a `vibetour pack validate <dir>` command for creators.
4. **Codec check.** Confirm H.264 `.mp4` plays in VS Code webviews on Windows and Linux. Fall back to VP9 `.webm` if it doesn't.
5. **Static scenery with stills.** Use anchor stills for *Static scenery*, *Reduced motion* and *No camera motion*.
6. **Later: Journey Studio.** A `vibetour studio` command that runs the workflow above with the creator's own API keys (BYOK, PRD §43). One adapter per provider, all behind one call: `generateClip({ firstFrame, lastFrame, prompt, seconds })`. Start with OpenRouter, since one key reaches most of the models above.
