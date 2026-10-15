"""gen_image.py <model> <prompt> <out> [ref.png…]: one still from an OpenRouter image model, saved as <out>.png (or .jpg).

AR sets the aspect ratio (16:9 by default; 4:3 for anchors and cockpits). SIZE sets the size: 1K (the default), 2K or 4K.
References larger than REFMAX px (1536) are sent as JPEGs of that size (via ffmpeg): a reference sets the look, not
the detail, and two full 2K PNGs per request made parallel uploads fail. For an edit, where the reference is the
image itself, set REFMAX=2400. Network errors, 429 and 5xx responses are retried."""
import json, sys, base64, urllib.request, os, mimetypes, subprocess, tempfile, time
key = os.environ["OR"]
model, prompt, out = sys.argv[1], sys.argv[2], sys.argv[3]
refs = sys.argv[4:]

REFMAX = int(os.environ.get("REFMAX", 1536))

def ref_uri(p):
    """The reference as a data URI, downscaled to a REFMAX px JPEG if it is bigger than that."""
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0", p], capture_output=True, text=True).stdout.strip()
    w, h = (int(v) for v in probe.split(",")[:2]) if probe else (0, 0)
    if max(w, h) <= REFMAX:
        mt = mimetypes.guess_type(p)[0] or "image/png"
        return f"data:{mt};base64," + base64.b64encode(open(p, "rb").read()).decode()
    with tempfile.TemporaryDirectory() as t:
        j = os.path.join(t, "ref.jpg")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", p, "-vf", f"scale='min({REFMAX},iw)':-2:flags=lanczos", "-q:v", "2", j], check=True)
        return "data:image/jpeg;base64," + base64.b64encode(open(j, "rb").read()).decode()

content = [{"type": "text", "text": prompt}] + [{"type": "image_url", "image_url": {"url": ref_uri(p)}} for p in refs]
body = {"model": model, "messages": [{"role": "user", "content": content}],
        "modalities": ["image", "text"], "image_config": {"aspect_ratio": os.environ.get("AR", "16:9")}}
if os.environ.get("SIZE"): body["image_config"]["image_size"] = os.environ["SIZE"]   # 1K (default), 2K or 4K
data = json.dumps(body).encode()
for attempt in range(3):
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=data,
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            d = json.load(r)
        break
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:300]
        if e.code < 500 and e.code != 429 or attempt == 2: sys.exit(f"HTTP {e.code}: {msg}")   # a refusal won't change
        print(f"HTTP {e.code}, retrying", file=sys.stderr); time.sleep(5 * (attempt + 1))
    except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
        if attempt == 2: sys.exit(f"network error, gave up: {e}")
        print(f"network error ({e}), retrying", file=sys.stderr); time.sleep(5 * (attempt + 1))
msg = d["choices"][0]["message"]
imgs = msg.get("images") or []
if not imgs:
    print("NO IMAGE; text:", (msg.get("content") or "")[:300]); sys.exit(1)
url = imgs[0]["image_url"]["url"]
head, b64 = url.split(",", 1)
ext = "png" if "png" in head else "jpg"
path = f"{out}.{ext}"
open(path, "wb").write(base64.b64decode(b64))
print("saved", path, "cost", (d.get("usage") or {}).get("cost"))
