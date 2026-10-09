# Architecture

VibeTour follows the component split from PRD §17:

```
 IDE / CLI / agent hooks          src/extension, src/cli, bin/vibetour-hook.js
          │  provider-neutral DevEvents (metadata only)
          ▼
 ┌──────────────────────── VibeTourSession (src/core/session.ts) ────────────────────────┐
 │ WorkspaceTracker  → active file, Git, diagnostics, processes, agents, rear-view history │
 │ ActivityEngine    → IDLE … COMPLETE + instrument readings (speedo, tacho, temp, …)      │
 │ MotionController  → calm, debounced behaviours (cruise, checkpoint, scenic stop, …)     │
 │ JourneyEngine     → abstract progress, scene graph, arrival, persistence per project    │
 │ Passport/Library  → stamps, ticket stubs, favourites, travel memories (State Store)     │
 └───────────────────────────────┬─────────────────────────────────────────────────────────┘
                                 │ TourSnapshot (4 Hz) + Catalog      src/core/protocol.ts
              ┌──────────────────┼────────────────────┐
              ▼                  ▼                    ▼
       VS Code webview     Companion browser     Browser demo
       (postMessage)       (SSE + POST, token)   (in-page session)
              └──────────── src/webview: Tour Renderer + Cockpit UI ─┘
```

The core does not depend on VS Code, Node or the DOM. The same session runs in:

- the extension host
- the standalone CLI
- the browser demo, which `src/webview/demo.ts` drives with a simulated coding session

## Events and privacy

Adapters translate what they see into `DevEvent`s (`src/core/events.ts`): focus, edits (with an origin guess of user, agent or unknown), saves, navigation, review, window focus, diagnostics, process start/end, Git status, commits, branch changes, agents and external file changes. Events carry file names and counts, never contents.

Shell commands are reduced to a coarse kind (`test`, `build`, `lint`, `agent`…) plus a scrubbed label such as `npm test` (`src/core/classify.ts`). The raw command line never leaves the adapter.

Streaming Mode is applied when the snapshot is built. Displays never receive the private fields:

- file names and paths
- branch and repository names
- commit messages
- command labels
- agent details
- objectives

## Activity Engine (`src/core/activity.ts`)

State is chosen in priority order: `COMPLETE` › `BLOCKED` › `WAITING_FOR_USER` › `VERIFYING` › `AGENT_ACTIVE` › `ACTIVE` › `THINKING` › `IDLE`. `WARNING` overlays `ACTIVE` or `THINKING` when diagnostics, tests or lint are failing. The overlaid state is kept as `basis` so motion is unaffected.

The windows are deliberately generous:

- **Active:** 20 s of input still counts as active.
- **Thinking:** up to 5 minutes focused counts as thinking. Thinking is part of programming.
- **Agent at work:** external file changes in the last 15 s imply an agent is working.
- **Waiting:** an agent's *waiting* state expires after 30 minutes, in case hook events get lost.

**Blocked** happens in two cases:

- an agent reports an error
- a build failed and nobody has touched anything for 30 s

The engine also produces the instrument readings: decaying activity scores for the speedometer and tachometer, error intensity for the temperature gauge, the check-engine reason, and agent context usage.

## Motion rules (`src/core/motion.ts`)

| State | Behaviour |
| --- | --- |
| `ACTIVE`, `AGENT_ACTIVE` | cruise |
| Reviewing diffs | easy pace |
| `THINKING` | gentle cruise |
| `VERIFYING` | checkpoint: a tunnel, rock shed or long straight |
| `IDLE` < 3 min | slow |
| `IDLE` ≥ 3 min | scenic stop |
| `WAITING_FOR_USER` | scenic stop |
| `BLOCKED` | pull over with hazards on |
| Objective complete | approach |
| Arrived | arrived |
| Session ended | parked |

A new behaviour has to hold for a short time before it is applied (4 s for checkpoints), so the car never twitches. Resuming from a stop is immediate.

## Journey Engine (`src/core/journey.ts`)

**Progress.** Progress is abstract, as PRD §22 asks. It grows only with productive time, weighted by state (thinking counts too), and is scaled to the journey's scope:

| Scope | Length |
| --- | --- |
| Coffee Run | 25 min |
| Day Trip | 70 min |
| Scenic Drive | 140 min |
| Road Trip | 6 h, across sessions |
| Expedition | 24 h, across sessions |
| Free Drive | no destination |

**Final approach.** Progress holds at 92% until the objective is marked complete. Then a 90-second final approach runs, and arrival stamps the Passport. If you finish early, the journey is shortened. If you keep working past the cap, it extends with more cruise scenes.

**Scenes.** Each trip walks the pack's scene graph with a seeded random path, so repeat trips vary.

**Persistence.** Journeys persist per project (VS Code `workspaceState`, or a JSON file for the CLI). Closing the IDE parks the journey "in the garage", and it auto-resumes when work starts again. A journey parked by the user stays parked until they resume it.

## Tour Renderer (`src/webview/renderer`)

A stylised, procedural Three.js scene. The target is a "premium driving game menu", not photorealism.

**World model** (`world.ts`)
- The road centreline is integrated from a curvature function that is bounded and gently self-restoring, so a drive can go on indefinitely.
- An environment schedule keyed by distance cross-fades scenes over 260 m.
- Features (bridges, tunnels, landmarks) are placed along the road.
- Everything is rendered **camera-relative** to avoid floating-point drift over hours of driving.

**Layers**

| Layer | Approach |
| --- | --- |
| Terrain | Cached ribbon (cliffs, hills, mountains, lakes, dunes, city) |
| Road | Markings texture, guardrails and parapets |
| Water | Shader with sun glint |
| Sky | Shader with clouds and stars |
| Distant silhouettes | Rings for ranges and skylines |
| Props | Instanced and deterministic per 10 m cell: trees, buildings with lit windows, neon, vineyards, chalets, domes… |
| Landmarks | Built procedurally |
| Effects | Tunnels and rock sheds for test runs, rain/snow, oncoming traffic, additive glows at night |

**Lighting.** Time-of-day and weather presets are blended by journey progress, so the sun sets as you arrive.

**Performance (PRD §25)**
- configurable FPS (30 or 60)
- 4 FPS in Work Mode
- paused while hidden
- automatic pixel-ratio throttling
- a low-GPU mode
- a CSS fallback when WebGL is unavailable

## Displays (`src/webview`)

`app.ts` maps each snapshot to a `RenderState` and updates the cockpit (`ui/cockpit.ts`): gauges, mirrors, HUD, infotainment tabs, tour strip and Work Mode panels. It also manages the overlays: destination board and tickets, Passport, settings, and the arrival card.

Transports (`transport.ts`):

| Host | Transport |
| --- | --- |
| VS Code webview | `postMessage` |
| Companion | Server-Sent Events + POST |
| Demo | In-page `DemoHost` |

Display preferences such as mode, accessibility, FPS and audio are kept per display.

## Hosts

- **VS Code** (`src/extension`):
  - IDE adapter: editors, documents, diagnostics, shell integration, tasks, debug sessions, tabs and an external-change file watcher
  - Git adapter: built-in `vscode.git` API
  - tour panel (`retainContextWhenHidden: false`), status bar and commands
  - Companion server
- **Companion server** (`src/server/companionServer.ts`):
  - binds to loopback; a per-install token is required for pages, events and commands
  - Host and Origin checks against DNS rebinding
  - strict command validation and body limits
  - static assets only from `dist/webview`
- **CLI** (`src/cli`): directory watcher, Git poller, JSON stores in `~/.vibetour`, and the same server.
