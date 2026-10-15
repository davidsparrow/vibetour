import json, os, sys, time, base64, urllib.request
S = sys.argv[1]; A = f"{S}/anchors"
def b64(n): return base64.b64encode(open(f"{A}/{n}.jpg","rb").read()).decode()
def uri(n): return "data:image/jpeg;base64," + b64(n)
LOOK = ("Keep the exact colour and light of the start frame throughout: brilliant clear early afternoon, sun high and to the right, deep saturated cerulean sky with "
 "bright white cumulus, cobalt and turquoise ocean with brilliant white surf, trees in several distinct greens, warm tan rock, crisp yellow and white road lines, "
 "punchy contrast, no haze, not beige, not muted. Camera locked at the driver's eye height, no shake. No car hood, no dashboard, no glass, no wipers. "
 "No vehicles, no people, no signs, no text. No audio, no music.")
RAIL = "A corrugated galvanised steel guardrail on weathered wooden posts runs along the right edge of the road and slides past steadily. "
WAVES = "Below the cliff on the right, big Pacific swells roll in and crash onto dark rocks: every few seconds a wave hits and white spray explodes upward and hangs in the air before falling back. "
SHOTS = {
 "cruise-a":   ("bigsur-v2",   "Smooth forward drive along the two-lane Big Sur coastal highway at a steady 60 km/h, centred in the right-hand lane, no lane changes, no turns. The road curves gently right. " + RAIL + WAVES + LOOK),
 "cruise-b":   ("bigsur-v2",   "Smooth forward drive along the two-lane Big Sur coastal highway at a steady 60 km/h, centred in the right-hand lane, no lane changes, no turns. The road curves gently right, then straightens along the cliff top. " + RAIL + WAVES + LOOK),
 "transition": ("bigsur-v2",   "Smooth forward drive along the two-lane coastal highway at a steady 60 km/h, centred in the right-hand lane, no lane changes, no turns. The road curves gently right past the guardrail, then grey granite outcrops and wind-shaped Monterey cypress appear on both sides as the road curves gently left, with a small white-sand cove and turquoise water coming into view on the right. " + RAIL + LOOK),
 "carmel":     ("carmel-v2",   "Smooth forward drive along the two-lane coastal highway at Carmel Highlands at a steady 60 km/h, centred in the right-hand lane, no lane changes, no turns. The road curves gently left between granite outcrops and Monterey cypress, with the cove and turquoise water on the right. " + RAIL + LOOK),
 "stop-in":    ("gas-approach-v2", "Forward drive at 50 km/h along the coastal highway that gradually slows, drifts to the right off the road onto the gravel forecourt of the small old-fashioned gas station ahead-right, and rolls to a smooth complete stop facing the two plain unbranded pumps under their flat canopy, with the weathered wooden station building and cypress trees beyond. The deceleration is smooth and the stop is gentle, with no lurch. " + LOOK),
 "hold":       ("gas-v2",      "Stationary camera at a stop on the gravel forecourt of a small old-fashioned gas station on the California coast, facing the two plain unbranded pumps under their flat canopy and the weathered wooden station building. Nothing moves except a slow drift of the cumulus clouds, the Monterey cypress swaying gently in a light breeze, and waves breaking white on the rocks far behind. Seamless loop. " + LOOK),
}
def post(url, body, headers):
    for k in range(4):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type":"application/json", **headers})
            with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.load(r)
        except urllib.error.HTTPError as e: return e.code, e.read().decode()[:300]
        except Exception as e: print("  retry", k+1, type(e).__name__); time.sleep(3*(k+1))
    return 0, "gave up"
jobs = []
def orjob(name, model, res, shot, dur, seed=None):
    first, prompt = SHOTS[shot]
    body = {"model": model, "prompt": prompt, "duration": dur, "resolution": res, "aspect_ratio": "16:9", "generate_audio": False,
            "frame_images": [{"type":"image_url","image_url":{"url":uri(first)},"frame_type":"first_frame"}]}
    if seed is not None: body["seed"] = seed
    st, d = post("https://openrouter.ai/api/v1/videos", body, {"Authorization": f"Bearer {os.environ['OR']}"})
    print("OR", name, st, json.dumps(d)[:90])
    if st in (200,202) and isinstance(d, dict) and d.get("id"): jobs.append({"provider":"openrouter","model":model,"id":d["id"],"poll":d["polling_url"],"name":name})
orjob("veo-cruise-a", "google/veo-3.1-lite", "720p", "cruise-a", 8, 21)
orjob("veo-cruise-b", "google/veo-3.1-lite", "720p", "cruise-b", 8, 22)
orjob("veo-transition", "google/veo-3.1-lite", "720p", "transition", 8, 23)
orjob("veo-carmel", "google/veo-3.1-lite", "720p", "carmel", 8, 24)
orjob("seedance-stop-in", "bytedance/seedance-2.0-fast", "720p", "stop-in", 10)
orjob("seedance-hold", "bytedance/seedance-2.0-fast", "720p", "hold", 12)
for shot, dur in [("cruise-a", 12), ("hold", 12)]:
    first, prompt = SHOTS[shot]
    body = {"model":"heygen-video-1","mode":"image_to_video","prompt":prompt,"duration":dur,"resolution":"768p","seed":7,
            "prompt_enhancement":"disabled","image":{"type":"base64","media_type":"image/jpeg","data":b64(first)}}
    st, d = post("https://api.heygen.com/v3/models/videos", body, {"x-api-key": os.environ["HG"]})
    print("HEYGEN", shot, st, json.dumps(d)[:90])
    if st in (200,202) and isinstance(d, dict) and d.get("data",{}).get("video_id"):
        vid = d["data"]["video_id"]; jobs.append({"provider":"heygen","model":"heygen-video-1","id":vid,"poll":f"https://api.heygen.com/v3/models/videos/{vid}","name":f"heygen-{shot}"})
json.dump(jobs, open(f"{S}/r5/jobs.json.tmp","w"), indent=1); os.replace(f"{S}/r5/jobs.json.tmp", f"{S}/r5/jobs.json"); print("jobs", len(jobs))
