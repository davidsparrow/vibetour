"""Print a car's car.json as shell variables, for car-build.sh and composite.sh to eval."""
import json, sys
c = json.load(open(f"{sys.argv[1]}/car.json"))
(CW, CH), (HX, HY), w, k = c["size"], c["hub"], c["wheel"], c["key"]
(L1, R1), (L2, R2) = w["forearms"]
v = dict(CW=CW, CH=CH, HX=HX, HY=HY, WR=w["radius"], FB=w["forearmsBelow"], L1=L1, R1=R1, L2=L2, R2=R2,
         REAR=":".join(map(str, c["mirrors"]["rear"])), SIDE=":".join(map(str, c["mirrors"]["side"])),
         KEY=f'{k["color"]}:{k["similarity"]}:{k["blend"]}')
print(" ".join(f"{n}={x}" for n, x in v.items()))
