"""Print a car's car.json as shell variables, for car-build.sh and composite.sh to eval."""
import json, sys
c = json.load(open(f"{sys.argv[1]}/car.json"))
(CW, CH), (HX, HY), w, k = c["size"], c["hub"], c["wheel"], c["key"]
v = dict(CW=CW, CH=CH, HX=HX, HY=HY, WR=w["radius"],
         REAR=":".join(map(str, c["mirrors"]["rear"])), SIDE=":".join(map(str, c["mirrors"]["side"])),
         KEY=f'{k["color"]}:{k["similarity"]}:{k["blend"]}', CLUSTER=":".join(map(str, c.get("cluster", []))))
print(" ".join(f"{n}={x}" for n, x in v.items()))
