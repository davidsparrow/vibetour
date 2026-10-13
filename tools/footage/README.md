# Footage tools

Scripts from the October 2026 footage bake-off, kept as the reference for the Journey Video Standard's workflow and for the engine work it assumes. They are not part of the build. See [docs/journey-video-standard.md](../../docs/journey-video-standard.md) and [docs/site/footage-study.html](../../docs/site/footage-study.html).

Needs `ffmpeg`, Python 3.9+ with Pillow, and for `steer.py`, `masks.py`, `wheel.py`, `dirt.py`, `deorb.py`, `vp.py` and `flare.py` a venv with `numpy` and `opencv-python-headless` (pass it to the shell scripts as `PYTHON`). API keys come from `.env.local` (`OPENROUTER_API_KEY`, `HEYGEN_API_KEY`), exported as `OR` and `HG`.

| Script | Does |
| --- | --- |
| `gen_image.py <model> <prompt> <out> [ref.png…]` | One still from an OpenRouter image model, 16:9 by default (`AR=4:3` for anchors and cockpits). `SIZE=2K` for 2400×1792 at 4:3. |
| `submit.py <workdir>` | Submits the shot list to Veo (OpenRouter), Seedance (OpenRouter) and HeyGen (direct); writes `jobs.json`. Edit `SHOTS` for a new scene. |
| `poll.py <workdir>` | Polls the jobs and downloads each clip to `out/` as it completes; writes `status.json`. |
| `steer.py <plate.mp4> <out> <max_deg>` | Steering track from optical-flow camera yaw: `<out>.cmd` for FFmpeg's `sendcmd`, `<out>.csv` to inspect. A fixed gain: full lock at `LOCK` (0.25) px per frame of yaw. |
| `car-build.sh <car dir>` | Derives a car's `wheel.png`, `glass-mask.png`, `mirror-mask.png` and `glass-dirt.png` from its `cockpit.png`, `cabin.png` and `car.json`. See [cars/](../../cars/README.md). |
| `masks.py <transparent.png> <glass.png> <mirrors.png>` | Splits a keyed cockpit's glass into the windshield and the mirrors. `car-build.sh` runs it. |
| `wheel.py <cockpit> <cabin> <hx> <hy> <r> <out>` | The wheel-and-hands matte: where the two stills differ, connected to the wheel. `car-build.sh` runs it. |
| `dirt.py <glass-mask> <out> [seed]` | Dust, smudges and wiper arcs on the windshield, lit in the composite by bright light behind the glass. `car-build.sh` runs it. |
| `vp.py <still> [<out> [WxH [at]]]` | Finds a still's vanishing point from its lane lines, and optionally crops a 16:9 band that puts it at the centre, 45% of the way down (or `at`). For anchors generated at 4:3. `CENTRE=1` for stop stills, whose forecourt lines would mislead it. |
| `deorb.py <in> <out> <x,y,r>…` | Paints lens-flare orbs out of a still's clear sky with a fitted gradient and matched grain. |
| `car.py <car dir>` | Prints `car.json` as shell variables for `car-build.sh` and `composite.sh`. |
| `flare.py <plate.mp4> <out.mp4> [strength]` | Lens-flare layer on black, for "into the sun" variants only. |
| `composite.sh <plate> <mirrorfeed> <steer.cmd> <out> [flare]` | The three-layer composite: plate, mirrors, cabin, wheel, bloom, then glass and grain. `CAR` selects the car folder (default `cars/touring-sedan`). Strengths: `BLEED`, `BLOOM`, `REFLECT` (dash in the windshield), `GLARE` (lit glass dirt), `GRAIN`; `CABIN` is the cabin's light level (1 midday, 0.25 night). |
| `still.sh <plate.png> <out.png> [deg]` | One still through the cockpit, to judge an anchor before paying to animate it. Takes the same variables as `composite.sh`. |
| `session.sh <out> <clip…>` | Dissolves clips into one plate, derives steering and the mirror feed, and composites. |

The cars are in [cars/](../../cars/README.md). The [`journey-footage`](../../.claude/skills/journey-footage/SKILL.md) skill strings these tools together for Claude Code.
