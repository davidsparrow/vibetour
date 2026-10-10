#!/usr/bin/env node
'use strict';

/**
 * VibeTour agent hook forwarder (PRD §15, §26).
 *
 * Claude Code runs this as a hook command with the hook JSON on stdin; Codex's
 * `notify` passes the JSON as the last argument (use `--provider codex`). Only
 * metadata — event, session, tool and sub-agent names — is forwarded to the
 * local VibeTour Companion server. Prompts, tool inputs and outputs never
 * leave this process.
 *
 * It always exits 0 and never prints anything: hook output can be injected
 * into the agent's context, and a failing hook must not disturb the agent.
 *
 * Target: VIBETOUR_URL (+ VIBETOUR_TOKEN) from the environment — set by the
 * VS Code extension in its integrated terminals — else the session file
 * written by the running server: ${VIBETOUR_HOME:-~/.vibetour}/companion.json.
 *
 * Plain CommonJS with no dependencies, so it runs from anywhere.
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const MAX_INPUT = 1024 * 1024;
const STDIN_TIMEOUT_MS = 2000;
const POST_TIMEOUT_MS = 800;
const FIELDS = ['hook_event_name', 'session_id', 'tool_name', 'tool_use_id', 'notification_type', 'agent_id', 'type', 'provider'];

function quit() {
  process.exit(0);
}

process.on('uncaughtException', quit);
process.on('unhandledRejection', quit);
// Never outlive the agent's patience, whatever happens below.
setTimeout(quit, STDIN_TIMEOUT_MS + POST_TIMEOUT_MS * 2 + 500).unref();

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
  return out;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = args.payload || tryParse(await readStdin());
  if (!raw) return;
  const payload = sanitize(raw, args.provider);
  if (!payload.hook_event_name && !payload.type) return;
  const body = JSON.stringify(payload);
  for (const target of targets()) {
    if (await post(target, body)) return;
  }
}

main().then(quit, quit);
