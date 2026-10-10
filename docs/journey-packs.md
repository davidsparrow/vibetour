# Journey Packs

A Journey Pack is the destination content (PRD §35). Built-in packs live in `packs/<id>/manifest.json`, following the PRD §39 layout. Today's packs are *Inspired Tours*: a procedural environment described by parameters rather than footage. The manifest already carries everything a footage-based or generated pack would need:

- ticket
- route
- variants
- scene graph
- stops
- facts
- audio
- provenance

`validatePack()` in `src/core/packs.ts` checks every manifest. `test/packs.test.ts` runs it over all built-in packs and walks their scene graphs from departure to arrival for many seeds.

## Manifest overview

```jsonc
{
  "id": "california-coast",                // kebab-case
  "title": "California Coast",
  "subtitle": "Monterey → Big Sur",
  "region": "California", "country": "United States", "countryCode": "US", "continent": "North America",
  "type": "route",                         // scenic | route | landmark | fantasy   (PRD §37)
  "authenticity": "scenic",                // dream | scenic | route | documentary (PRD §54)
  "travelMode": "drive", "drivingSide": "right",
  "moods": ["ocean", "warm"],              // used by "Take me somewhere"
  "cruiseSpeed": 20,                       // m/s at full cruise
  "route": { "name": "Highway 1", "from": "Monterey", "to": "Big Sur", "waypoints": [{ "name": "Carmel", "at": 0.12, "x": 0.33, "y": 0.19 }] },
  "ticket": { "priceLabel": "Included", "original": true, "badges": ["VibeTour Original"], "approxMinutes": 90 },
  "variants": [{ "id": "golden", "label": "Golden Hour → Sunset", "timeOfDay": "golden", "arrivalTimeOfDay": "sunset", "weather": "clear", "default": true }],
  "palette": { "ground": "#8e9a5c", "road": "#4b4b53", "water": "#1f6f96", "accents": ["#ff8a4c"] },
  "environment": { "left": { "terrain": "hills", "height": 70 }, "right": { "terrain": "cliffs" }, "props": { "windswept": 1.4 }, "checkpoint": "gallery" },
  "sceneGraph": { "start": "departure", "nodes": { "departure": { "kind": "departure", "label": "Leaving Monterey", "weight": 1, "next": ["carmel"] } } },
  "scenicStops": [{ "name": "Bixby Creek Overlook", "kind": "overlook" }],
  "arrival": { "name": "Big Sur", "scene": "Pfeiffer Beach at sunset" },
  "facts": ["…"],
  "audio": { "ambience": ["ocean", "birds", "wind"] },
  "provenance": { "creator": "VibeTour Originals", "generation": "procedural", "license": "Included with VibeTour", "sources": ["…"] }
}
```

`palette` above is trimmed. A real palette needs every colour: `ground`, `groundFar`, `rock`, `snow`, `sand`, `road`, `roadLine`, `foliage`, `foliageDark`, `water`, `building` and `accents`. It can also set `skyTint`.

## Scene graph (PRD §40)

Each node has:

- **`kind`:** `departure`, `cruise`, `landmark`, `transition`, `scenic` or `arrival`
- **`label`**
- **`weight`:** its share of the journey
- **`env`** (optional): overrides of the base environment
- **`next`:** the node ids that can follow

Only arrival nodes may be terminal, and every reachable node must be able to reach an arrival.

The Journey Engine picks a seeded path through the graph for each trip:

- Non-arrival scenes share 0–92% progress by weight.
- The arrival scene is the final approach.
- While the journey is held at the final approach, or on a Free Drive, the engine cycles through cruise scenes so the scenery keeps changing.

## Environment parameters

| Key | Meaning |
| --- | --- |
| `left` / `right` | `{ terrain, height }` where terrain is `ocean`, `cliffs`, `hills`, `mountains`, `flat`, `city`, `lake` or `dunes` |
| `props` | Instances per 100 m per side, by kind (see below) |
| `landmark`, `landmarkSide` | `arch-bridge`, `suspension-bridge`, `lighthouse`, `lattice-tower`, `hill-town`, `bell-tower`, `waterfall`, `castle`, `dome-city`, `chapel` or `pagoda` |
| `bridge` | With a bridge landmark: the road crosses a canyon or water on the structure |
| `tunnel` | The scene includes a tunnel |
| `curvature`, `hilliness` | 0 = straight / flat, 1 = typical, up to ~1.6 |
| `guardrail` | Rails on the water/drop side |
| `checkpoint` | How test runs are staged: `tunnel`, `gallery` (open rock shed) or `straight` (the road straightens out) |
| `sunAzimuth` | Sun bearing relative to the direction of travel, in degrees |
| `palette` | Per-scene colour overrides |

Prop kinds:

| Group | Kinds |
| --- | --- |
| Trees and plants | `pine`, `cypress`, `windswept`, `broadleaf`, `palm`, `bush`, `vineyard` |
| Rocks | `rock` |
| Buildings | `building` (lit windows at night), `farmhouse`, `chalet`, `dome` |
| Street furniture | `neon` (attached to buildings), `streetlight`, `pole`, `snowpole`, `lantern` |
| Rural | `stonewall`, `sheep` |

## Honesty and licensing (PRD §53, §79)

- Every pack declares its type, authenticity and provenance.
- Fantasy journeys carry the **Fantasy Journey** badge.
- Facts should be accurate, and fictional places should be labelled as fictional.
- Don't ship copyrighted worlds, branded vehicles or music without rights.
