# Footage tools

Scripts from the October 2026 footage bake-off, kept as the reference for the Journey Video Standard's workflow and for the engine work it assumes. They are not part of the build. See [docs/journey-video-standard.md](../../docs/journey-video-standard.md) and [docs/site/footage-study.html](../../docs/site/footage-study.html).

Needs `ffmpeg`, Python 3.9+ with Pillow, and for `steer.py`, `masks.py`, `wheel.py`, `dirt.py`, `deorb.py`, `vp.py` and `flare.py` a venv with `numpy` and `opencv-python-headless` (pass it to the shell scripts as `PYTHON`). API keys come from `.env.local` (`OPENROUTER_API_KEY`, `HEYGEN_API_KEY`), exported as `OR` and `HG`.

| Script | Does |
| --- | --- |
| `gen_image.py <model> <prompt> <out> [ref.png…]` | One still from an OpenRouter image model, 16:9 by default (`AR=4:3` for anchors and cockpits). `SIZE=2K` for 2400×1792 at 4:3. References over `REFMAX` px (1536; 2400 for an edit of the still itself) are sent as JPEGs of that size; network errors, 429 and 5xx are retried. |
| `submit.py <workdir>` | Submits the shot list to Veo (OpenRouter), Seedance (OpenRouter) and HeyGen (direct); writes `jobs.json`. Edit `SHOTS` for a new scene. |
| `poll.py <workdir>` | Polls the jobs and downloads each clip to `out/` as it completes; writes `status.json`. |
| `steer.py <plate.mp4> <out> <max_deg>` | Steering track from optical-flow camera yaw: `<out>.cmd` for FFmpeg's `sendcmd`, `<out>.csv` to inspect. Yaw is measured near the vanishing point on textured pixels, with passing cars filtered out; a fixed gain gives full lock at `LOCK` (0.25) px per frame. |
| `car-build.sh <car dir>` | Derives a car's `wheel.png`, `glass-mask.png`, `mirror-mask.png`, `side-window-mask.png` and `glass-dirt.png` from its `cockpit.png`, `cabin.png` and `car.json`. See [cars/](../../cars/README.md). |
| `masks.py <transparent.png> <glass.png> <mirrors.png>` | Splits a keyed cockpit's glass into the windshield and the mirrors. `car-build.sh` runs it. |
| `wheel.py <cockpit> <cabin> <hx> <hy> <r> <out>` | The wheel-and-hands matte: where the two stills differ, connected to the wheel. `car-build.sh` runs it. |
| `dirt.py <glass-mask> <out> [seed]` | Dust, smudges and wiper arcs on the windshield, lit in the composite by bright light behind the glass. `car-build.sh` runs it. |
| `vp.py <still> [<out> [WxH [at]]]` | Finds a still's vanishing point from its painted lane lines (white and yellow pixels only, so cracks and shadows don't count), and optionally crops a 16:9 band that puts it at the centre, 45% of the way down (or `at`). For anchors generated at 4:3. `CENTRE=1` for stop stills, whose forecourt lines would mislead it. |
| `drift.py <clip.mp4>…` | Checks that each clip's camera keeps pointing down the road: the vanishing point from the lane lines every half second, flagged at 12% of the width off centre and failed at 20%, with the longest passing stretch for trimming. Exits 2 if any clip fails. |
| `deorb.py <in> <out> <x,y,r>…` | Paints lens-flare orbs out of a still's clear sky with a fitted gradient and matched grain. |
| `car.py <car dir>` | Prints `car.json` as shell variables for `car-build.sh` and `composite.sh`. |
| `flare.py <plate.mp4> <out.mp4> [strength]` | Lens-flare layer on black, for "into the sun" variants only. |
| `composite.sh <plate> <mirrorfeed> <steer.cmd> <out> [flare]` | The three-layer composite: plate, mirrors, cabin, wheel, bloom, then glass and grain. `CAR` selects the car folder (default `cars/touring-sedan`). Strengths: `BLEED`, `BLOOM`, `REFLECT` (dash in the windshield), `GLARE` (lit glass dirt), `GRAIN`; `CABIN` is the cabin's light level (1 midday, 0.25 night). |
| `rain.py <plate.mp4> <out.mp4> [car dir]` | Rain on the windshield and the wipers clearing it, drawn into a plate before compositing. `RAIN` drops a second (900), `WIPE` seconds per wipe (1.6). `session.sh` runs it when `RAIN` is set. |
| `mirrorlights.py <mirror.mp4> <out.mp4> [dark]` | Turns a mirror feed's car lights round: red taillights on cars driving away, white headlights on a car following us. `dark` (about 0.35 at night, 1 at dusk or in rain) also darkens the road behind and tints it red. `session.sh` runs it when `MIRRORLIGHTS` is set. |
| `glass.py <composite.mp4> <out.mp4> [car dir]` | After the composite: `WET=1` puts water on the side window (blown back, beading along the A-pillar and top edges), the door mirror and the rear-view mirror; `NIGHT=1` shows lamps in the side window as small red taillights. `session.sh` runs it in rain, with `WET=1`, and at night. |
| `still.sh <plate.png> <out.png> [deg]` | One still through the cockpit, to judge an anchor before paying to animate it. Takes the same variables as `composite.sh`. |
| `session.sh <out> <clip…>` | Dissolves clips into one plate, derives steering and the mirror feed, and composites. `RAIN=900` adds windshield rain and wipers and wets the side glass (or `WET=1` alone for a wet road); `MIRRORLIGHTS=0.35` (night) or `1` (dusk, rain) turns the mirrors' lights round; `FLARE=0.8` adds lens flare when the sun is in frame. |

The cars are in [cars/](../../cars/README.md). The [`journey-footage`](../../.claude/skills/journey-footage/SKILL.md) skill strings these tools together for Claude Code.
