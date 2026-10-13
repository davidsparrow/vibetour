# Footage tools

Scripts from the October 2026 footage bake-off, kept as the reference for the Journey Video Standard's workflow and for the engine work it assumes. They are not part of the build. See [docs/journey-video-standard.md](../../docs/journey-video-standard.md) and [docs/site/footage-study.html](../../docs/site/footage-study.html).

Needs `ffmpeg`, Python 3.9+, and for `steer.py`, `masks.py` and `flare.py` a venv with `numpy` and `opencv-python-headless`. API keys come from `.env.local` (`OPENROUTER_API_KEY`, `HEYGEN_API_KEY`), exported as `OR` and `HG`.

| Script | Does |
| --- | --- |
| `gen_image.py <model> <prompt> <out> [ref.png…]` | One still from an OpenRouter image model, 16:9 by default (`AR=4:3` for cockpits). |
| `submit.py <workdir>` | Submits the shot list to Veo (OpenRouter), Seedance (OpenRouter) and HeyGen (direct); writes `jobs.json`. Edit `SHOTS` for a new scene. |
| `poll.py <workdir>` | Polls the jobs and downloads each clip to `out/` as it completes; writes `status.json`. |
| `steer.py <plate.mp4> <out> <max_deg>` | Steering track from optical-flow camera yaw: `<out>.cmd` for FFmpeg's `sendcmd`, `<out>.csv` to inspect. |
| `car-build.sh <car dir>` | Derives a car's `wheel.png`, `glass-mask.png` and `mirror-mask.png` from its `cockpit.png`, `cabin.png` and `car.json`. See [cars/](../../cars/README.md). |
| `masks.py <transparent.png> <glass.png> <mirrors.png>` | Splits a keyed cockpit's glass into the windshield and the mirrors. `car-build.sh` runs it. |
| `car.py <car dir>` | Prints `car.json` as shell variables for `car-build.sh` and `composite.sh`. |
| `flare.py <plate.mp4> <out.mp4> [strength]` | Lens-flare layer on black, for "into the sun" variants only. |
| `composite.sh <plate> <mirrorfeed> <steer.cmd> <out> [flare]` | The three-layer composite: plate, mirrors, cabin, wheel, bloom. `CAR` selects the car folder (default `cars/touring-sedan`), which gives the hub and mirror boxes; `BLEED`/`BLOOM` set the strengths. |
| `session.sh <out> <clip…>` | Dissolves clips into one plate, derives steering and the mirror feed, and composites. |

The cars are in [cars/](../../cars/README.md).
