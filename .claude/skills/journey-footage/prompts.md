# Prompt kit

Blocks that produced the 13 October 2026 California Coast stills and clips (Gemini 3.1 Flash Image at 2K for stills, HeyGen Video at 768p for clips). Copy them into your pack's `prompts.sh` and rewrite the place-specific parts for your region. Each block is one paragraph of the final prompt.

## Still blocks

**DASH** (opening words)
> Photograph from a forward-facing dashcam at the driver's eye height

Say "photograph", not "photorealistic". The second reads as a render.

**LOOK, vivid midday** (the default variant)
> on a brilliant clear early afternoon. Sun high and to the right. Colour is vivid and true: a deep saturated cerulean sky grading to pale blue at the horizon with a few bright white cumulus; rich cobalt water turning turquoise near the shore with brilliant white surf; trees in several distinct greens, from dark Monterey cypress to bright yellow-green coastal scrub; warm tan and grey granite; charcoal asphalt. Punchy contrast, clean highlights, deep but detailed shadows, and natural atmospheric perspective: the farthest ridges a little softer and bluer.

**LANE** (name where the centre line runs, or the lane comes out wrong)
> Americans drive on the right: the camera is in the right-hand (southbound) lane, so the double yellow centre line runs on the camera's LEFT and the white edge line on its right.

**REAL**
> It must look like a real, unretouched photograph of an ordinary day, taken with a good camera, not a render, not CGI, not a postcard, not an illustration. The road is real and used, with wear of its own: old cracks sealed with tar, uneven tone where it has been resurfaced, slightly worn paint, raised reflective markers along the centre line, sand, leaves and gravel at the edges, white reflector posts. No skid marks, no repeated patches. Fine natural grain, true detail, no over-sharpening, no HDR halos. Not beige, not muted, not faded.

Change the wear items from still to still.

**SIGNS**
> Any text on signs is short, correct and plainly printed, exactly as quoted; every other sign is too small or too far away to read. No real brand names or logos. No licence plates readable.

Name the sign system when it matters: "a standard Caltrans guide sign: white letters and a white border on a GREEN background, on two wooden posts". Without it, one distance sign came out black.

**PEOPLE**
> People look natural and candid, at rest or walking slowly, never posing for the camera, nobody running.

**FRAME** (road stills)
> Level camera at the driver's eye height: the road's vanishing point at the horizontal centre and the vertical centre of the frame. 24 mm lens. Nothing of our own car: no hood, dashboard, glass or wipers. No lens flare, no sun spots, no orbs or light leaks anywhere.

**MATCH** (one reference)
> Match the colour, light, palette and photographic style of the reference image exactly, but not its emptiness.

**MATCH2** (the scene's master plus a lived-in still)
> The first reference image sets the place, colour and light; the second sets how real and lived-in the world looks. Match both, but not the emptiness of the first.

**PLACE** (variants: the reference gives the place, the prompt gives the light)
> Use the reference images for the kind of place and the photographic style only; the light, sky and weather are as described here, not as in the references.

## World detail, by stretch

Pick some of each, never all, and vary them. These are the lines that worked.

**Town**
> The street is busy and lived in: ordinary cars parked along the right kerb, some dusty, one with a bike rack; people on the sidewalk: a couple holding coffee cups, a woman walking a golden retriever on a lead, a father with a small child on his shoulders, an older man sitting on a bench reading. A bicycle leans against a lamp post; a green trash can and a blue recycling bin stand at the kerb; flattened cardboard boxes are stacked by a shop door; a chalkboard sandwich board stands outside a café; small painted shop signs read BAKERY, GALLERY and BOOKS; a green street-name sign on the corner post reads OCEAN AV. A wooden utility pole with wires stands at the corner with pigeons on the roof ridge behind it. Two oncoming cars come up the hill in the opposite lane on the camera's left. Our lane is clear for a long way ahead.

**Edge of town**
> Along the right side, a line of weathered wooden utility poles carries sagging power and phone lines that stretch on ahead down the road and far into the distance; a few small birds sit on the wires and a hawk on one pole top. On the right shoulder, a green California route shield with a white number 1, and further on a green distance sign on two posts reading BIG SUR 26. On the left, the last houses of town: a white picket fence, a real-estate sign on a post at a driveway reading FOR SALE, a row of four mailboxes on a rail, a parked pickup truck, and a bus-stop pole with a small bench. A crushed paper cup lies in the gutter.

**Homes in the hills**
> Up the slope on the left, a small cluster of four or five homes is tucked into the hillside among pines and cypress, well spaced, with decks facing the sea and driveways climbing from the road; a car is parked on one; a row of mailboxes stands on a wooden rail at the bottom of a shared driveway, where a delivery van is pulled off the road and its driver carries a box up the drive. On the sea side, one low house of wood and glass sits below the road with only its roof showing.

**Farm or ranch**
> On the left, set back across a pasture behind a barbed-wire fence on weathered posts, a lived-in ranch: a white two-storey farmhouse with a red barn, an old red tractor parked beside the barn, a dusty pickup and a horse trailer, a windmill, a few black cattle grazing, a dirt ranch road with a metal cattle gate and a ranch mailbox at the highway. A hawk sits on a fence post; two turkey vultures circle high.

**Wild road with traffic**
> In the opposite lane on the camera's left, a white camper van is coming toward us, well inside its own lane, with an ordinary car a little way behind it. Gulls sit on two of the guardrail posts.

**Busy stop (gas station)**
> It is an ordinary busy moment: at the far pump a man in a cap fills a dusty green pickup; at the other a woman cleans her hatchback's windshield with a squeegee while a dog looks out of the back window; a woman walks out of the station shop holding a coffee and a paper bag; two touring motorcycles are parked by the building; an ice freezer chest and a caged propane rack stand against the wall; a hand-lettered sign in the window reads OPEN; crows on the canopy edge.

**Scenic overlook** (the tour's one main stop)
> The pullout is busy, as on any sunny day: parked nose-in along the fence to our left and right, a white camper van with two surfboards on its roof rack, a vintage camper bus with no badges and a surfboard on top, a dusty wagon with a kayak on its roof, and two touring motorcycles on their side stands. At the fence, people stand looking at the view, some taking photos with their phones: a couple with their arms around each other, a dad pointing out the bridge to a small boy, a woman holding a small dog, an older couple in sun hats. A brown interpretive sign on two posts stands by the fence, too far away to read; a trash can; gulls and a raven on the fence posts. Nobody is running.

Say where the car is: "in a car parked nose-in on a wide gravel pullout, a few metres back from a low fence … The gravel of the pullout fills the bottom of the frame right up to the fence; there is no road in front of us."

**Breakdown** (once per tour)
> Ahead on the right, pulled well off the road onto a wide gravel shoulder, a dusty older sedan has broken down with its hood up and its hazard lights on; a white flatbed tow truck with an amber light bar is parked in front of it, and the tow driver in a hi-vis vest crouches by the sedan's front wheel; the owner stands by the guardrail talking on her phone, and a teenage boy sits on the guardrail beside her; an orange warning triangle stands on the shoulder behind the car. Everyone is well off the road and our lane is clear.

## Variant looks

**Before sunset** (sun in frame: keep it small, and ahead of the camera rather than far right, or the rear-view mirror hides it)
> in the late afternoon about half an hour before sunset. The road curves gently right towards the sea, which puts the low sun in frame ahead, just right of the road: a small, clean, round white-gold disc with a soft natural glow close around it, while the sky around it stays readable, warm blue-gold and not blown out. A glittering sun path runs across the water. Warm golden light rakes across the hills and the road; long shadows stretch from every post and bush. The sky is still blue overhead, warming to pale gold near the horizon; the scattered clouds near the sun are just beginning to show faint hints of white-pink along their edges. No lens-flare ghosts, orbs, rings or streaks.

**Sunset over the sea**
> The sun is setting into the ocean ahead-right: only a thin bright sliver of the orange sun is left above the sea horizon, laying a glowing orange-red path across the water. The clouds over the sea are lit from below in deep pink, coral and crimson; higher up, the sky deepens to lavender and violet-blue. The hills on the left are dusky, with warm rim light along their crests. A line of pelicans flies low over the water. On the right, a gravel pullout where two cars are parked and a few people stand in silhouette watching the sunset. An oncoming car with its headlights on.

**Night in town**
> at night, about nine o'clock. Warm light spills from shop windows and restaurant fronts; old-fashioned lantern street lamps glow; strings of small white lights twinkle in the median trees. Cars are parked along the kerb with light glinting off them; oncoming cars come up the hill with their headlights on; well down the street ahead, the red taillights of one car in our lane. People walk on the lit sidewalks: a couple arm in arm, a group leaving a restaurant, a person walking a dog, diners at an outdoor table under a patio heater. Our own headlights light the road just ahead. The sky is deep navy, not black. Warm amber and gold light against deep blue shadows, true and crisp, not orange-washed, not noisy.

**Night road**
> at night under a clear sky with a thin crescent moon. Our own low-beam headlights light the road ahead: the asphalt, the centre line, the edge line, the raised reflective markers glinting, and white reflector posts shining back. About fifty metres ahead in our lane, a car's red taillights, and another pair further on. In the opposite lane on the camera's left, an oncoming car with bright white headlights is about to pass us, with two more pairs of headlights following it round the curve. One lit window of a hillside house far up the slope; a faint deep-blue afterglow over the sea; stars. Headlights glow naturally; no lens-flare ghosts or streaks.

**Rain**
> on a rainy afternoon. Steady light rain falls from a low, even grey sky; cloud hangs on the hills and drifts through the trees. The asphalt is soaking wet and dark with silvery reflections of the sky, water in the wheel tracks and puddles along the shoulder. An oncoming car with its headlights on throws up a fine spray. Houses up the hill have lit windows; a person in a yellow raincoat walks a dog along a driveway. Wet foliage is a deep saturated green and the rock is dark and glistening. Colours are rich and wet, not washed out to grey. No raindrops on the lens or glass; they are added later.

## Clip block

> Smooth forward drive at a steady {50} km/h along {road} {in the variant's light}. {Traffic as events: the silver oncoming car in the opposite lane on our LEFT keeps to its own lane, approaches and passes us on the left, and is gone out of the left of the frame.} {What slides past: the utility poles and their sagging wires slide past on the right; the birds stay perched on the wires.} {Life that keeps coming: more people stroll on the sidewalks further down the street, and more cars come up the hill toward us.} Keep the exact colour and light of the start frame: {palette}. Camera locked at the driver's eye height, centred in the right-hand lane, no lane changes, no turns, no shake. The horizon stays where it is in the start frame. Nothing of our own car: no hood, dashboard, glass or wipers. Everything that is parked stays parked; every building, pole, sign and tree is solid and stays rooted where it stands, passing by only as we move; nothing fades in or out. Signs keep their exact text. People move slowly and naturally; nobody runs. No lens flare, no orbs. No audio, no music.

For HeyGen: `"prompt_enhancement": "disabled"`, a fixed `seed`, 768p while drafting.
