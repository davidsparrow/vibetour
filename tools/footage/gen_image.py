import json, sys, base64, urllib.request, os, mimetypes
key = os.environ["OR"]
model, prompt, out = sys.argv[1], sys.argv[2], sys.argv[3]
refs = sys.argv[4:]
content = [{"type": "text", "text": prompt}]
for p in refs:
    mt = mimetypes.guess_type(p)[0] or "image/png"
    content.append({"type": "image_url", "image_url": {"url": f"data:{mt};base64," + base64.b64encode(open(p,"rb").read()).decode()}})
body = {"model": model, "messages": [{"role": "user", "content": content}],
        "modalities": ["image", "text"], "image_config": {"aspect_ratio": os.environ.get("AR","16:9")}}
req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions",
    data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=240) as r:
    d = json.load(r)
msg = d["choices"][0]["message"]
imgs = msg.get("images") or []
if not imgs:
    print("NO IMAGE; text:", (msg.get("content") or "")[:300]); sys.exit(1)
url = imgs[0]["image_url"]["url"]
head, data = url.split(",", 1)
ext = "png" if "png" in head else "jpg"
path = f"{out}.{ext}"
open(path, "wb").write(base64.b64decode(data))
print("saved", path, "cost", (d.get("usage") or {}).get("cost"))
