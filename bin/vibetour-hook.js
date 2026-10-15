#!/usr/bin/env node
'use strict';

/**
 * VibeTour agent hook forwarder (PRD §15, §26).
 *
 * Claude Code runs this as a hook command with the hook JSON on stdin; Codex's
 * `notify` passes the JSON as the last argument (use `--provider codex`). Only
 * metadata — event, session, tool and sub-agent names, and the kind of API
 * error that ended a turn — is forwarded to the local VibeTour Companion
 * server. Prompts, tool inputs and outputs never leave this process.
 *
 * It always exits 0 and never prints anything: hook output can be injected
 * into the agent's context, and a failing hook must not disturb the agent.
 *
 * Context: on SessionStart, PostToolUse and Stop it also sends how full the
 * session's context window is, as one number. It works that out from the
 * token counts of the last reply in Claude Code's transcript; nothing else is
 * read from it. The transcript format is internal to Claude Code, so if it
 * changes this sends no reading rather than a wrong one.
 *
 * Status line: `vibetour-hook.js --statusline [command]` is a Claude Code
 * `statusLine` command. It sends Claude Code's own exact context reading and
 * prints a status line: the given command's output (it gets the same JSON on
 * stdin), or the model and how much context is left.
 *
 * Target: VIBETOUR_URL (+ VIBETOUR_TOKEN) from the environment — set by the
 * VS Code extension in its integrated terminals — else the session file
 * written by the running server: ${VIBETOUR_HOME:-~/.vibetour}/companion.json.
 *
 * Plain CommonJS with no dependencies, so it runs from anywhere.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const MAX_INPUT = 1024 * 1024;
const STDIN_TIMEOUT_MS = 2000;
const POST_TIMEOUT_MS = 800;
const WRAPPED_TIMEOUT_MS = 3000;
const STATUSLINE = process.argv[2] === '--statusline';
// The last reply's usage is near the end; a reply bigger than this is skipped.
const TRANSCRIPT_TAIL = 1024 * 1024;
const CONTEXT_EVENTS = new Set(['SessionStart', 'PostToolUse', 'Stop']);
const FIELDS = ['hook_event_name', 'session_id', 'tool_name', 'tool_use_id', 'notification_type', 'agent_id', 'type', 'provider'];

function quit() {
  process.exit(0);
}

process.on('uncaughtException', quit);
process.on('unhandledRejection', quit);
// Never outlive the agent's patience, whatever happens below.
setTimeout(quit, STDIN_TIMEOUT_MS + POST_TIMEOUT_MS * 2 + 500 + (STATUSLINE ? WRAPPED_TIMEOUT_MS : 0)).unref();

function tryParse(text) {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch (_) {
    return undefined;
  }
}

function parseArgs(argv) {
  let provider;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--provider') provider = argv[++i];
    else if (argv[i].startsWith('--provider=')) provider = argv[i].slice('--provider='.length);
  }
  return { provider, payload: tryParse(argv[argv.length - 1]) };
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    const chunks = [];
    let size = 0;
    let finished = false;
    const finish = (text) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.stdin.destroy();
      resolve(text);
    };
    const timer = setTimeout(() => finish(Buffer.concat(chunks).toString('utf8')), STDIN_TIMEOUT_MS);
    process.stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_INPUT) return finish('');
      chunks.push(chunk);
    });
    process.stdin.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => finish(''));
  });
}

/** Keeps only the metadata VibeTour needs (mirrors sanitizeHookPayload in src/core/hooks.ts). */
function sanitize(raw, provider) {
  const out = {};
  for (const key of FIELDS) {
    if (typeof raw[key] === 'string') out[key] = raw[key].slice(0, 120);
  }
  const input = raw.tool_input && typeof raw.tool_input === 'object' ? raw.tool_input : {};
  const subagent = typeof raw.subagent_type === 'string' ? raw.subagent_type : input.subagent_type;
  if (typeof subagent === 'string') out.subagent_type = subagent.slice(0, 60);
  if (typeof provider === 'string' && provider) out.provider = provider.slice(0, 30);
  // StopFailure: the error's kind (rate_limit, overloaded…), never its details or message.
  if (typeof raw.error === 'string' && /^[a-z][a-z_]{0,39}$/.test(raw.error)) out.error = raw.error;
  return out;
}

function count(v) {
  return typeof v === 'number' && v > 0 ? v : 0;
}

/**
 * How full a context window is, 0..1. Claude Code gives current models (Claude 5,
 * Opus 4.7 and later) and `[1m]` variants a 1M window, older ones 200K.
 */
function contextShare(tokens, model) {
  let window = Number(process.env.VIBETOUR_CONTEXT_WINDOW);
  if (!(window > 0)) {
    const m = typeof model === 'string' ? model.toLowerCase() : '';
    const extended = /\[1m\]/.test(m) || /claude-(fable|opus|sonnet|haiku)-([5-9]|\d\d)/.test(m) || /claude-opus-4-[7-9]/.test(m);
    window = tokens > 200000 || (extended && process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT !== '1') ? 1000000 : 200000;
  }
  return Math.round(Math.min(1, tokens / window) * 1000) / 1000;
}

/**
 * The context reading after the last reply in a Claude Code transcript: its input,
 * cache-write and cache-read tokens, as Claude Code counts them. Only the counts
 * and the model name are read.
 */
function transcriptContext(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.extname(file) !== '.jsonl') return undefined;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, TRANSCRIPT_TAIL);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, size - length);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const compacted = line.includes('"compact_boundary"') || line.includes('"isCompactSummary"');
      if (!compacted && !line.includes('"usage"')) continue;
      const entry = tryParse(line);
      if (!entry) continue;
      // Before a compaction's first reply, the last usage is from before it: no reading yet.
      if (entry.subtype === 'compact_boundary' || entry.isCompactSummary === true) return undefined;
      if (entry.type !== 'assistant' || entry.isSidechain) continue;
      const message = entry.message && typeof entry.message === 'object' ? entry.message : {};
      const usage = message.usage && typeof message.usage === 'object' ? message.usage : {};
      const tokens = count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + count(usage.cache_read_input_tokens);
      if (tokens > 0) return contextShare(tokens, message.model);
    }
  } catch (_) {
    /* unreadable or changed format: no reading */
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (_) {
        /* ignore */
      }
    }
  }
  return undefined;
}

/** A Claude Code hook's context reading: the transcript, or on resume the hook's own token count. */
function hookContext(raw) {
  const fromTranscript = transcriptContext(raw.transcript_path);
  if (fromTranscript !== undefined) return fromTranscript;
  if (raw.hook_event_name === 'SessionStart' && count(raw.context_tokens) > 0) return contextShare(raw.context_tokens, raw.model);
  return undefined;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function targets() {
  const list = [];
  const envUrl = process.env.VIBETOUR_URL;
  if (envUrl) {
    try {
      const url = new URL(envUrl);
      const token = process.env.VIBETOUR_TOKEN || url.searchParams.get('token');
      if (url.protocol === 'http:' && token) {
        list.push({ hostname: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) || 80, token });
      }
    } catch (_) {
      /* ignore a malformed URL */
    }
  }
  try {
    const home = process.env.VIBETOUR_HOME || path.join(os.homedir(), '.vibetour');
    const info = JSON.parse(fs.readFileSync(path.join(home, 'companion.json'), 'utf8'));
    const known = list.some((t) => t.port === info.port && t.token === info.token);
    if (!known && typeof info.port === 'number' && typeof info.token === 'string' && (!info.pid || processAlive(info.pid))) {
      list.push({ hostname: '127.0.0.1', port: info.port, token: info.token });
    }
  } catch (_) {
    /* no running VibeTour */
  }
  return list;
}

function post(target, body) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: '/api/agent-event',
        method: 'POST',
        timeout: POST_TIMEOUT_MS,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: `Bearer ${target.token}`,
        },
      },
      (res) => {
        // Anything but 2xx (a stale token, another server on that port) means: try the next target.
        const delivered = res.statusCode >= 200 && res.statusCode < 300;
        res.resume();
        res.on('end', () => resolve(delivered));
        res.on('error', () => resolve(delivered));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end(body);
  });
}

async function deliver(body) {
  for (const target of targets()) {
    if (await post(target, body)) return;
  }
}

/** Runs the user's own status line command with the same input, and returns what it prints. */
function runWrapped(command, input) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (_) {
      return resolve('');
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve(out);
    }, WRAPPED_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve(out);
    };
    child.stdout.on('data', (chunk) => {
      if (out.length < 64 * 1024) out += chunk.toString('utf8');
    });
    child.on('error', done);
    child.on('close', done);
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

async function statusLine(command) {
  const text = await readStdin();
  const raw = tryParse(text) || {};
  const window = raw.context_window && typeof raw.context_window === 'object' ? raw.context_window : {};
  const used = typeof window.used_percentage === 'number' ? Math.round(Math.min(100, Math.max(0, window.used_percentage)) * 10) / 1000 : undefined;
  const sent =
    used !== undefined && typeof raw.session_id === 'string'
      ? deliver(JSON.stringify({ hook_event_name: 'StatusLine', session_id: raw.session_id.slice(0, 80), context: used }))
      : Promise.resolve();
  let line;
  if (command) line = await runWrapped(command, text);
  else {
    const model = raw.model && typeof raw.model.display_name === 'string' ? raw.model.display_name.slice(0, 40) : 'Claude';
    line = used === undefined ? model : `${model} · ${Math.round((1 - used) * 100)}% context left`;
  }
  await new Promise((resolve) => process.stdout.write(line, resolve));
  await sent;
}

async function main() {
  if (STATUSLINE) return statusLine(process.argv.slice(3).join(' ').trim());
  const args = parseArgs(process.argv.slice(2));
  const raw = args.payload || tryParse(await readStdin());
  if (!raw) return;
  const payload = sanitize(raw, args.provider);
  if (!payload.hook_event_name && !payload.type) return;
  if (CONTEXT_EVENTS.has(payload.hook_event_name)) {
    const context = hookContext(raw);
    if (context !== undefined) payload.context = context;
  }
  await deliver(JSON.stringify(payload));
}

main().then(quit, quit);
