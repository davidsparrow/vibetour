import json, os, sys, time, urllib.request
S = sys.argv[1]
while not os.path.exists(f"{S}/jobs.json"): time.sleep(5)
jobs = json.load(open(f"{S}/jobs.json")); done = {}
def get(url, headers):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
t0 = time.time()
while len(done) < len(jobs) and time.time() - t0 < 2400:
    for j in jobs:
        if j["id"] in done: continue
        hdr = {"Authorization": f"Bearer {os.environ['OR']}"} if j["provider"]=="openrouter" else {"x-api-key": os.environ["HG"]}
        st, raw = get(j["poll"], hdr)
        try: d = json.loads(raw)
        except Exception: d = {"raw": raw[:200].decode(errors="ignore")}
        info = d.get("data", d)
        status = info.get("status")
        if status in ("completed","failed","cancelled","error"):
            rec = {"status": status, "name": j["name"], "model": j["model"]}
            if status == "completed":
                url = (d.get("unsigned_urls") or [None])[0] if j["provider"]=="openrouter" else info.get("video_url")
                if url:
                    s2, blob = get(url, hdr if j["provider"]=="openrouter" else {})
                    out = f"{S}/out/{j['name']}.mp4"; open(out,"wb").write(blob); rec["file"] = out; rec["bytes"] = len(blob)
                rec["cost"] = (d.get("usage") or {}).get("cost")
            else:
                rec["error"] = json.dumps(info)[:400]
            done[j["id"]] = rec
            json.dump(list(done.values()), open(f"{S}/status.json","w"), indent=1)
            print(time.strftime("%H:%M:%S"), json.dumps(rec))
    time.sleep(20)
print("POLL DONE", len(done), "/", len(jobs))
