"""seedance.py <dir> <name> <prompt.txt|prompt text> <first.png|jpg> [last.png|jpg|-] [seconds]: submit one clip to
Seedance 2.0 Fast on OpenRouter (720p, 16:9, no audio), from a first frame and optionally a last frame (give the same
still twice for a hold that loops). Appends the job to <dir>/jobs.json and writes <dir>/<name>.prompt.txt, so
tools/footage/poll.py <dir> fetches it into <dir>/out/<name>.mp4. SEED=<n> sets the seed. Needs OR (the OpenRouter key).
About 0.91 for 10 s."""
import base64, io, json, os, sys, time, urllib.request
from PIL import Image

d, name, prompt, first = sys.argv[1:5]
last = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] != "-" else None
dur = int(sys.argv[6]) if len(sys.argv) > 6 else 10
if os.path.exists(prompt):
    prompt = open(prompt).read().strip()


def uri(p):
    buf = io.BytesIO()
    Image.open(p).convert("RGB").save(buf, "JPEG", quality=95)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


frames = [{"type": "image_url", "image_url": {"url": uri(first)}, "frame_type": "first_frame"}]
if last:
    frames.append({"type": "image_url", "image_url": {"url": uri(last)}, "frame_type": "last_frame"})
body = {"model": "bytedance/seedance-2.0-fast", "prompt": prompt, "duration": dur, "resolution": "720p", "aspect_ratio": "16:9",
        "generate_audio": False, "frame_images": frames}
if os.environ.get("SEED"):
    body["seed"] = int(os.environ["SEED"])
req = urllib.request.Request("https://openrouter.ai/api/v1/videos", data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.environ['OR']}"})
resp = None
for attempt in range(3):
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            resp = json.load(r)
        break
    except urllib.error.HTTPError as e:
        sys.exit(f"{name}: {e.code} {e.read().decode()[:300]}")
    except (urllib.error.URLError, OSError) as e:
        print(name, "network error, retrying:", e)
        time.sleep(5)
if resp is None or not resp.get("id"):
    sys.exit(f"{name}: no job id in {resp}")
os.makedirs(os.path.join(d, "out"), exist_ok=True)
jobs_path = os.path.join(d, "jobs.json")
jobs = json.load(open(jobs_path)) if os.path.exists(jobs_path) else []
jobs.append({"provider": "openrouter", "model": body["model"], "id": resp["id"],
             "poll": resp.get("polling_url") or f"https://openrouter.ai/api/v1/videos/{resp['id']}", "name": name})
json.dump(jobs, open(jobs_path, "w"), indent=1)
open(os.path.join(d, name + ".prompt.txt"), "w").write(prompt)
print(name, resp["id"], f"({dur} s, {'first and last frame' if last else 'first frame'})")
