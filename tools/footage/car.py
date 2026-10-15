"""Print a car's car.json as shell variables, for car-build.sh and composite.sh to eval."""
import json, sys
c = json.load(open(f"{sys.argv[1]}/car.json"))
(CW, CH), (HX, HY), w, k = c["size"], c["hub"], c["wheel"], c["key"]
v = dict(CW=CW, CH=CH, HX=HX, HY=HY, WR=w["radius"], WY=w.get("offset", 0),
         REAR=":".join(map(str, c["mirrors"]["rear"])), SIDE=":".join(map(str, c["mirrors"]["side"])),
         KEY=f'{k["color"]}:{k["similarity"]}:{k["blend"]}', CLUSTER=":".join(map(str, c.get("cluster", []))))
v["LIT"] = ",".join(":".join(map(str, b)) for b in c.get("lit", []))   # more boxes that keep their backlight at night
d = c.get("dials")      # live speedometer and rev counter: centre, angle of zero (clockwise from 12), sweep, full-scale value
if d:
    for n, key in (("SPD", "speed"), ("RPM", "rpm")):
        g = d[key]; v[n] = f'{g["centre"][0]}:{g["centre"][1]}:{g["zero"]}:{g["sweep"]}:{g["max"]}'
    v["NEEDLE"] = d.get("needle", 36)
s = c.get("screens")    # the console screen (the radio's face) and the cluster's centre display, each x:y:w:h
if s:
    v["SCON"], v["SCLU"] = (":".join(map(str, s[k])) for k in ("console", "cluster"))
print(" ".join(f"{n}={x}" for n, x in v.items()))
