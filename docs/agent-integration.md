# Connecting coding agents

VibeTour treats AI agents as cockpit entities (PRD §15):

- **Co-pilot:** your main agent sits on the radio's **CB band**.
- **Crew:** sub-agents count on the **Agents** dial and show on the radio's CB band, labelled NAV, ENG, QA, COMMS or OPS.
- **Activity:** agent activity moves the **tachometer** and keeps the journey cruising on autopilot.
- **Waiting for you:** when an agent needs approval or a reply, the car pulls into a **scenic stop** until you answer.

VibeTour only ever receives metadata: event names, tool names, ids, sub-agent types and how full the context window is. Prompts, tool inputs, diffs and outputs are dropped before anything is sent, and everything stays on `127.0.0.1`.

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
    "StopFailure": [{ "hooks": [{ "type": "command", "command": "node \"/home/you/.vibetour/bin/vibetour-hook.js\"", "timeout": 5 }] }],
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
| `PreToolUse` with `Task`/`Agent` | a crew agent joins: the Agents dial counts it, CB lists it | — |
| `PostToolUse` with `Task`/`Agent` | that crew agent leaves | — |
| `PreToolUse` with `AskUserQuestion` | co-pilot *has a question for you* | Scenic stop until you answer; alert on the stop card and in the Alerts tab |
| `PreToolUse` with `ExitPlanMode` | co-pilot *has a plan for you to approve* | Scenic stop until you reply; alert on the stop card and in the Alerts tab |
| `Notification` (`permission_prompt`) | co-pilot *needs your approval to use* the tool it was about to run | Scenic stop until you reply; alert on the stop card and in the Alerts tab |
| `Notification` (MCP input requests: `elicitation_dialog`, `elicitation_url_dialog`, `agent_needs_input`) | co-pilot *needs your input* | Scenic stop until you reply; alert on the stop card and in the Alerts tab |
| `Notification` (`idle_prompt`, `auth_success` and other notices that ask nothing) | ignored: the co-pilot is still *finished* | — |
| `Stop` | co-pilot *finished — your turn*; crew whose task never reported back leave | Normal travel while you review, with a *your turn* alert that lights the bells orange. Optionally pulls over after N quiet seconds (`vibetour.yourTurn.pullOver`) |
| `StopFailure` | the turn ended on an API error: co-pilot *stopped: rate limit* (or *API overloaded*, *billing problem*…). Only the error's kind is forwarded, never its details | Pulls onto the shoulder with hazards; alert on the stop card and in the Alerts tab |
| `SessionEnd` | co-pilot leaves the cockpit | — |

Interrupting Claude (Esc) fires no hook, so the co-pilot reads as working until your next prompt. Hook configurations copied before `StopFailure` was added still work; copy the configuration again to get API-error stops.

The forwarder finds the server through `VIBETOUR_URL` and `VIBETOUR_TOKEN` when they are set. The extension sets them in its integrated terminals, so several VS Code windows each get their own agents. Otherwise, or when that server turns the event away (say, a stale token), it reads the session file `~/.vibetour/companion.json` (override the directory with `VIBETOUR_HOME`). The newest running window or CLI owns that file, and when it closes another running one takes it over within about 10 seconds. It always exits 0, prints nothing, and gives up after about a second, so it can never slow down or confuse the agent.

### Context

The Context gauge shows how much of Claude's context window is left. It works with the hooks above and needs no extra setup.

- **From the hooks.** On `SessionStart`, `PostToolUse` and `Stop`, the forwarder reads the token counts of the last reply from the session's transcript (`transcript_path`). It sends one number: how full the window is. Nothing else is read from the transcript, and nothing else leaves your machine.
- **Window size.** Claude Code gives current models (Claude 5, and Opus 4.7 and later) a 1M window, and older ones 200K unless you use a `[1m]` model. The transcript doesn't record the window, so the forwarder works it out from the model name. It also respects `CLAUDE_CODE_DISABLE_1M_CONTEXT`. If it guesses wrong, set `VIBETOUR_CONTEXT_WINDOW` to the window size in tokens.
- **Limits.** The transcript format is internal to Claude Code and can change between releases. If it does, the gauge reads — rather than a wrong number. Just after a compaction it keeps its last reading until Claude's next reply.

For Claude Code's own exact figure, also use the forwarder as your status line. Claude Code runs it after every reply:

```json
{
  "statusLine": { "type": "command", "command": "node \"/home/you/.vibetour/bin/vibetour-hook.js\" --statusline" }
}
```

It prints the model and how much context is left, for example `Opus 5.5 · 58% context left`. Claude Code allows one status line. If you already have one, put its command after `--statusline`, in quotes. The forwarder passes it the same input and prints what it prints:

```json
{
  "statusLine": { "type": "command", "command": "node \"/home/you/.vibetour/bin/vibetour-hook.js\" --statusline \"bash ~/.claude/statusline.sh\"" }
}
```

The status line only updates the gauge for a session the hooks have already put in the cockpit.

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
- With `waiting`, `ask` says why: `question`, `plan` or `approval`, and with `approval`, `tool` names the tool (e.g. `"tool":"shell"`). The stop card and its alert pill say so.
- `role` is optional: `copilot`, `nav`, `eng`, `qa`, `comms`, `ops` or `crew`.
- Set `parentId` to show an agent as crew under another agent.
- `context` (0–1) is how full the agent's context window is. It feeds the Context gauge, which shows the fullest agent's window as how much is left.
- Remove an agent with `{"type":"agent.remove","agentId":"my-agent"}`.
- The port and token are in `~/.vibetour/companion.json`. Requests need the token (`?token=` or a Bearer header) and a loopback `Host`.

| Response | Meaning |
| --- | --- |
| `202` | Accepted |
| `400` | Malformed event |
| `401` | Missing or wrong token |
| `413` | Body larger than 16 KB |
