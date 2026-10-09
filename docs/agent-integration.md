# Connecting coding agents

VibeTour treats AI agents as cockpit entities (PRD §15):

- **Co-pilot:** your main agent sits on the **radio**.
- **Crew:** sub-agents show up in the **side mirrors**, labelled NAV, ENG, QA, COMMS or OPS.
- **Activity:** agent activity moves the **tachometer** and keeps the journey cruising on autopilot.
- **Waiting for you:** when an agent needs approval or a reply, the car pulls into a **scenic stop** until you answer.

VibeTour only ever receives metadata: event names, tool names, ids and sub-agent types. Prompts, tool inputs, diffs and outputs are dropped before anything is sent, and everything stays on `127.0.0.1`.

## Claude Code

1. Make sure a VibeTour host is running: VS Code with the extension, or `node dist/cli.js <project>`.
2. In VS Code run **VibeTour: Copy Claude Code Hook Configuration**. It copies the forwarder to `~/.vibetour/bin/vibetour-hook.js` and puts a `hooks` block on your clipboard.
3. Paste the block into `.claude/settings.json` (project) or `~/.claude/settings.json` (all projects). It looks like this:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"/home/you/.vibetour/bin/vibetour-hook.js\"", "timeout": 5 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"/home/you/.vibetour/bin/vibetour-hook.js\"", "timeout": 5 }] }],
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"/home/you/.vibetour/bin/vibetour-hook.js\"", "timeout": 5 }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"/home/you/.vibetour/bin/vibetour-hook.js\"", "timeout": 5 }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "node \"/home/you/.vibetour/bin/vibetour-hook.js\"", "timeout": 5 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"/home/you/.vibetour/bin/vibetour-hook.js\"", "timeout": 5 }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node \"/home/you/.vibetour/bin/vibetour-hook.js\"", "timeout": 5 }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "node \"/home/you/.vibetour/bin/vibetour-hook.js\"", "timeout": 5 }] }]
  }
}
```

Without VS Code, you can point the same configuration at `bin/vibetour-hook.js` in this repository.

How hook events map onto the journey:

| Claude Code hook | VibeTour | On the road |
| --- | --- | --- |
| `UserPromptSubmit` | co-pilot *working* | Steady autopilot cruise |
| `PreToolUse` | co-pilot *using a tool* (e.g. "Using Edit") | Cruise |
| `PreToolUse` with `Task`/`Agent` | a crew agent appears in a side mirror | — |
| `PostToolUse` with `Task`/`Agent` | that crew agent leaves | — |
| `Notification` | co-pilot *waiting for you* | Scenic stop until you reply |
| `Stop` | co-pilot *finished — your turn* | Normal travel while you review |
| `SessionEnd` | co-pilot leaves the cockpit | — |

The forwarder finds the server through `VIBETOUR_URL` and `VIBETOUR_TOKEN` when they are set. The extension sets them in its integrated terminals, so several VS Code windows each get their own agents. Otherwise it reads the session file `~/.vibetour/companion.json` (override the directory with `VIBETOUR_HOME`). It always exits 0, prints nothing, and gives up after about a second, so it can never slow down or confuse the agent.

Agents started inside the VS Code terminal (`claude`, `codex`, `aider`, `gemini`, …) are also detected through shell integration. Files the agent changes on disk count as agent activity even without hooks.

## Codex

Point Codex's `notify` program at the forwarder:

```toml
# ~/.codex/config.toml
notify = ["node", "/home/you/.vibetour/bin/vibetour-hook.js", "--provider", "codex"]
```

Each completed turn shows up as "Turn complete — your move".

## Any other agent: the HTTP API

POST provider-neutral events to the running host:

```bash
curl -s -X POST "http://127.0.0.1:47477/api/agent-event" \
  -H "Authorization: Bearer $VIBETOUR_TOKEN" \
  -H "content-type: application/json" \
  -d '{"type":"agent","agentId":"my-agent","name":"Aider","role":"copilot","status":"working","detail":"Refactoring","context":0.42}'
```

- `status` is one of `working`, `tool`, `waiting`, `idle`, `done`, `error`.
- `role` is optional: `copilot`, `nav`, `eng`, `qa`, `comms`, `ops` or `crew`.
- Set `parentId` to show an agent as crew under another agent.
- `context` (0–1) feeds the fuel gauge when it is set to *Agent context*.
- Remove an agent with `{"type":"agent.remove","agentId":"my-agent"}`.
- The port and token are in `~/.vibetour/companion.json`. Requests need the token (`?token=` or a Bearer header) and a loopback `Host`.

| Response | Meaning |
| --- | --- |
| `202` | Accepted |
| `400` | Malformed event |
| `401` | Missing or wrong token |
| `413` | Body larger than 16 KB |
