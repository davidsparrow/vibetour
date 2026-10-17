#!/usr/bin/env node
// Makes the Controls Map: sets each dashboard state, numbers its controls, takes a
// screenshot, and writes docs/site/controls-map.html with a key under each picture.
//
//   npm run controls-map                 # builds first, then this script
//   node tools/controls-map/capture.mjs [--fragment <file>] [--no-radio] [--only <id,id>]
//
// --fragment also writes the page without its <html>/<head>/<body> wrapper, for
// publishing as a shareable page. --no-radio skips the FM picture, which needs the
// network (it plays a real SomaFM station through the CLI companion).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { renderPage } from './page.mjs';
import { STATES } from './states.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IMG_DIR = join(ROOT, 'docs/site/images/controls');
const PAGE = join(ROOT, 'docs/site/controls-map.html');
const VIEW = { width: 1280, height: 760 };
/** Close-ups of the screen: a taller window gives the dash, and so the screen, its full height. */
const CLOSE_VIEW = { width: 1280, height: 980 };
const CLOSE_PAD = { x: 120, y: 18 };
const DEMO_PORT = 5183;
/** A still from the California Coast footage, shown behind the dashboard in place of the live 3D scene. */
const BACKDROP = `data:image/jpeg;base64,${readFileSync(join(ROOT, 'tools/controls-map/backdrop.jpg')).toString('base64')}`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const only = value('--only')?.split(',');

/** Starts the demo server and waits until it answers. */
async function startDemo() {
  const child = spawn(process.execPath, [join(ROOT, 'scripts/serve-demo.mjs')], { env: { ...process.env, PORT: String(DEMO_PORT) }, stdio: 'ignore' });
  const url = `http://127.0.0.1:${DEMO_PORT}/`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return { child, url };
    } catch {
      // not up yet
    }
    await new Promise((ok) => setTimeout(ok, 250));
  }
  child.kill();
  throw new Error('The demo server did not start');
}

/** Starts the CLI companion on a scratch project, radio on, and returns its display URL. */
async function startCompanion() {
  const project = mkdtempSync(join(tmpdir(), 'vibetour-map-project-'));
  const home = mkdtempSync(join(tmpdir(), 'vibetour-map-home-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: project });
  writeFileSync(join(project, 'README.md'), '# Controls map\n');
  const child = spawn(process.execPath, [join(ROOT, 'dist/cli.js'), project, '--port', '0', '--no-open'], { env: { ...process.env, VIBETOUR_HOME: home } });
  const url = await new Promise((ok, fail) => {
    let out = '';
    const timer = setTimeout(() => fail(new Error(`The companion did not print a URL:\n${out}`)), 15_000);
    const read = (d) => {
      out += String(d);
      const m = out.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+/);
      if (m) {
        clearTimeout(timer);
        ok(m[0]);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
  });
  const stop = async () => {
    const exited = new Promise((ok) => child.once('exit', ok));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((ok) => setTimeout(ok, 10_000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { url, stop };
}

/**
 * Draws a numbered badge and a thin outline on each control that is on screen, in
 * key order. A control counts as on screen when most of it shows inside every
 * scrolling or clipping box around it; the rest are left out of the key, with a
 * warning. Selectors are plain CSS.
 */
async function mark(page, items, close) {
  const rects = await page.evaluate((sels) => {
    const shown = (el) => {
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
    };
    return sels.map((sel) => {
      const el = document.querySelector(sel);
      if (!el || !shown(el)) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      let [x1, y1, x2, y2] = [r.left, r.top, r.right, r.bottom];
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (!shown(p)) return null;
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) {
          const pr = p.getBoundingClientRect();
          [x1, y1, x2, y2] = [Math.max(x1, pr.left), Math.max(y1, pr.top), Math.min(x2, pr.right), Math.min(y2, pr.bottom)];
        }
      }
      [x1, y1, x2, y2] = [Math.max(0, x1), Math.max(0, y1), Math.min(innerWidth, x2), Math.min(innerHeight, y2)];
      const [w, h] = [x2 - x1, y2 - y1];
      // Most of it in view, or a good block of a long list.
      if (w < 4 || h < 4 || (w * h < 0.3 * r.width * r.height && (w < 48 || h < 48))) return null;
      return { x: x1, y: y1, width: w, height: h };
    });
  }, items.map((i) => i.sel));
  const found = [];
  items.forEach((item, i) => {
    if (rects[i]) found.push({ ...item, box: rects[i] });
    else console.warn(`  not on screen, left out: ${item.name} (${item.sel})`);
  });
  await page.evaluate(
    ({ boxes, view, close }) => {
      document.getElementById('cm-overlay')?.remove();
      const layer = document.createElement('div');
      layer.id = 'cm-overlay';
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
      const AMBER = '#f2b134';
      const badge = (n, x, y) => {
        const b = document.createElement('div');
        b.textContent = String(n);
        b.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:22px;height:22px;border-radius:50%;background:${AMBER};color:#0c0f14;font:700 12px/22px Barlow,Arial,sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.7)`;
        layer.append(b);
      };
      const ring = (b) => {
        const r = document.createElement('div');
        r.style.cssText = `position:absolute;left:${b.x - 2}px;top:${b.y - 2}px;width:${b.width + 4}px;height:${b.height + 4}px;border:1.5px solid rgba(242,177,52,.95);border-radius:5px;box-shadow:0 0 0 1px rgba(0,0,0,.45)`;
        layer.append(r);
      };
      if (!close) {
        const placed = [];
        boxes.forEach((b, i) => {
          ring(b);
          const x0 = Math.max(2, Math.min(view.width - 24, b.x - 11));
          const y = Math.max(2, Math.min(view.height - 24, b.y - 11));
          // Badges side by side rather than on top of each other: try left of the spot first, outside the control.
          const free = (x) => x >= 2 && x <= view.width - 24 && !placed.some(([px, py]) => Math.abs(px - x) < 23 && Math.abs(py - y) < 23);
          const tries = [0, -24, 24, -48, 48, -72, 72, -96, 96].map((d) => x0 + d);
          const x = tries.find(free) ?? x0;
          placed.push([x, y]);
          badge(i + 1, x, y);
        });
      } else {
        // A close-up: dim all but the screen, numbers in the margins, a leader line to each control.
        const { crop, focus } = close;
        const dim = (x, y, w, h) => {
          const d = document.createElement('div');
          d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:rgba(8,10,14,.72)`;
          layer.append(d);
        };
        dim(crop.x, crop.y, crop.width, focus.y - crop.y);
        dim(crop.x, focus.y + focus.height, crop.width, crop.y + crop.height - focus.y - focus.height);
        dim(crop.x, focus.y, focus.x - crop.x, focus.height);
        dim(focus.x + focus.width, focus.y, crop.x + crop.width - focus.x - focus.width, focus.height);
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('width', String(view.width));
        svg.setAttribute('height', String(view.height));
        svg.style.cssText = 'position:absolute;inset:0;overflow:visible';
        layer.append(svg);
        const line = (d, stroke, width) => {
          const path = document.createElementNS(NS, 'path');
          path.setAttribute('d', d);
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', stroke);
          path.setAttribute('stroke-width', String(width));
          path.setAttribute('stroke-linejoin', 'round');
          svg.append(path);
        };
        const mid = focus.x + focus.width / 2;
        const sides = { L: [], R: [] };
        boxes.forEach((b, i) => {
          ring(b);
          sides[b.x + b.width / 2 < mid ? 'L' : 'R'].push({ n: i + 1, b, cy: b.y + b.height / 2 });
        });
        const GAP = 25;
        const top = crop.y + 13;
        const bottom = crop.y + crop.height - 13;
        for (const [side, list] of Object.entries(sides)) {
          list.sort((a, b) => a.cy - b.cy);
          let prev = -Infinity;
          for (const it of list) prev = it.y = Math.max(it.cy, prev + GAP, top);
          // Past the bottom: pull the column up, keeping the spacing.
          for (let k = list.length - 1; k >= 0; k--) {
            const limit = k === list.length - 1 ? bottom : list[k + 1].y - GAP;
            if (list[k].y > limit) list[k].y = limit;
          }
          const bx = side === 'L' ? crop.x + 16 : crop.x + crop.width - 16;
          const out = side === 'L' ? 1 : -1;
          for (const it of list) {
            const tx = side === 'L' ? it.b.x - 2 : it.b.x + it.b.width + 2;
            const knee = side === 'L' ? Math.max(bx + 16, Math.min(tx - 8, focus.x - 6)) : Math.min(bx - 16, Math.max(tx + 8, focus.x + focus.width + 6));
            const d = `M ${bx + out * 11} ${it.y} L ${knee} ${it.y} L ${tx} ${it.cy}`;
            line(d, 'rgba(0,0,0,.55)', 3.2);
            line(d, AMBER, 1.3);
            badge(it.n, bx - 11, it.y - 11);
          }
        }
      }
      document.body.append(layer);
    },
    { boxes: found.map((f) => f.box), view: close ? CLOSE_VIEW : VIEW, close },
  );
  return found.map(({ box, ...rest }) => rest);
}

async function main() {
  mkdirSync(IMG_DIR, { recursive: true });
  const demo = await startDemo();
  const wantRadio = !flag('--no-radio') && (!only || only.includes('radio-fm'));
  const companion = wantRadio ? await startCompanion() : undefined;
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const done = [];
  try {
    for (const state of STATES) {
      if (only && !only.includes(state.id)) continue;
      if (state.needs === 'companion' && !companion) continue;
      console.log(`${state.id}: ${state.title}`);
      // Every picture at twice the pixels, so it stays sharp on a high-density screen and when opened full size.
      const page = await browser.newPage({ viewport: state.close ? CLOSE_VIEW : VIEW, deviceScaleFactor: 2 });
      await page.goto(state.needs === 'companion' ? companion.url : `${demo.url}${state.query ?? '?fresh&autopilot=0'}`);
      await state.setup(page);
      // The real coast behind the glass, not the low-poly scene the demo draws.
      await page.addStyleTag({ content: `.scene-canvas,.scene-fallback{visibility:hidden}.scene{background:#05070c url("${BACKDROP}") center / cover no-repeat}` });
      // The demo's own pill and panel aren't part of the product, and a click leaves a focus ring.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('.demo-panel, .demo-pill')) el.style.display = 'none';
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      let close;
      if (state.close) {
        const focus = await page.locator(state.close).first().boundingBox();
        const x = Math.max(0, focus.x - CLOSE_PAD.x);
        const y = Math.max(0, focus.y - CLOSE_PAD.y);
        const crop = { x, y, width: Math.min(CLOSE_VIEW.width, focus.x + focus.width + CLOSE_PAD.x) - x, height: Math.min(CLOSE_VIEW.height, focus.y + focus.height + CLOSE_PAD.y) - y };
        close = { crop, focus };
      }
      const items = await mark(page, state.items, close);
      // Close-ups of the screen are flat UI: PNG. Whole views have the coast photo behind them: JPEG, a tenth the size.
      const file = `${state.id}.${close ? 'png' : 'jpg'}`;
      await page.screenshot({ path: join(IMG_DIR, file), ...(close ? { clip: close.crop } : { type: 'jpeg', quality: 88 }) });
      const size = close ? { width: Math.round(close.crop.width * 2), height: Math.round(close.crop.height * 2) } : { width: VIEW.width * 2, height: VIEW.height * 2 };
      done.push({ ...state, items, image: `images/controls/${file}`, ...size });
      await page.close();
    }
  } finally {
    await browser.close();
    demo.child.kill();
    await companion?.stop();
  }
  if (only) {
    console.log('--only: pictures updated, page left as it was');
    return;
  }
  if (!companion) console.warn('No FM picture (--no-radio): the page leaves FM out');
  const generated = new Date().toISOString().slice(0, 10);
  writeFileSync(PAGE, renderPage(done, { generated, wrap: true }));
  console.log(`wrote ${PAGE}`);
  const fragment = value('--fragment');
  if (fragment) {
    writeFileSync(fragment, renderPage(done, { generated, wrap: false }));
    console.log(`wrote ${fragment}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
