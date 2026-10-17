// Renders the Controls Map page from the captured states. The styling follows
// docs/site/footage-study.html: a night instrument panel, with a light variant.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Key text: `R` becomes a key cap, *word* italics. Everything else is plain text. */
const rich = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<kbd>$1</kbd>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

const STYLE = `
/* Layout: an owner's manual for the cockpit. One picture per screen, numbered callouts on it, the key right under it. */
:root{
  --bg:#0c0f14; --panel:#131821; --line:#243042; --fg:#e8ecf2; --mute:#98a4b8;
  --amber:#f2b134; --amber-ink:#0c0f14; --chip:#1a2130;
  --display:"Barlow Condensed","Arial Narrow",sans-serif; --body:"Barlow","Helvetica Neue",Arial,sans-serif; --mono:"IBM Plex Mono",Menlo,Consolas,monospace;
  color-scheme:dark;
}
@media (prefers-color-scheme: light){ :root:not([data-theme="dark"]){
  --bg:#f3f1ec; --panel:#ffffff; --line:#d8d3c8; --fg:#1b1f26; --mute:#5c6573;
  --amber:#b8780a; --amber-ink:#ffffff; --chip:#ebe7de; color-scheme:light; } }
:root[data-theme="light"]{
  --bg:#f3f1ec; --panel:#ffffff; --line:#d8d3c8; --fg:#1b1f26; --mute:#5c6573;
  --amber:#b8780a; --amber-ink:#ffffff; --chip:#ebe7de; color-scheme:light; }
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--body);font-size:16px;line-height:1.5}
.wrap{max-width:1060px;margin:0 auto;padding-inline:20px;padding-block:40px 64px;display:flex;flex-direction:column;gap:44px}
header{display:flex;flex-direction:column;gap:12px;max-width:68ch}
.brand{font-family:var(--display);font-weight:700;font-size:1.05rem;letter-spacing:.14em;text-transform:uppercase;color:var(--amber)}
h1{font-family:var(--display);font-weight:600;font-size:clamp(2.2rem,6vw,3.2rem);line-height:1;margin:0;text-wrap:balance}
.lede{margin:0;font-size:1.08rem;color:var(--fg)}
.meta{font-family:var(--mono);font-size:.78rem;color:var(--mute);display:flex;flex-wrap:wrap;gap:4px 18px}
nav{display:flex;flex-wrap:wrap;gap:8px}
nav a{font-family:var(--display);font-weight:600;font-size:.95rem;letter-spacing:.06em;text-transform:uppercase;color:var(--fg);text-decoration:none;background:var(--chip);border:1px solid var(--line);border-radius:999px;padding:4px 12px}
nav a:hover,nav a:focus-visible{border-color:var(--amber);color:var(--amber);outline:none}
section{display:flex;flex-direction:column;gap:14px;scroll-margin-top:16px}
.eyebrow{font-family:var(--display);font-weight:600;font-size:.85rem;letter-spacing:.16em;text-transform:uppercase;color:var(--amber)}
h2{font-family:var(--display);font-weight:600;font-size:clamp(1.6rem,4vw,2.1rem);line-height:1.05;margin:0;text-wrap:balance}
.intro{margin:0;max-width:68ch;color:var(--mute)}
figure{margin:0}
figure img{display:block;width:100%;max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px;background:#000}
figcaption{font-family:var(--mono);font-size:.75rem;color:var(--mute);margin-top:6px}
.zoom{display:block;border-radius:6px}
.zoom:focus-visible{outline:2px solid var(--amber);outline-offset:3px}
ol.key{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;border-top:1px solid var(--line)}
ol.key li{display:grid;grid-template-columns:30px minmax(0,1.1fr) minmax(0,1.5fr) minmax(0,1.5fr);gap:6px 18px;padding:10px 0;border-bottom:1px solid var(--line);align-items:start}
.n{width:24px;height:24px;border-radius:50%;background:var(--amber);color:var(--amber-ink);font:700 .78rem/24px var(--body);text-align:center;font-variant-numeric:tabular-nums}
.c{font-weight:600;min-width:0}
.f,.k{min-width:0;color:var(--fg);font-size:.95rem}
.f::before,.k::before{display:block;font-family:var(--display);font-weight:600;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}
.f::before{content:"Fed by"}
.k::before{content:"Click or key"}
.head{display:grid;grid-template-columns:30px minmax(0,1.1fr) minmax(0,1.5fr) minmax(0,1.5fr);gap:18px;font-family:var(--display);font-weight:600;font-size:.75rem;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);padding-bottom:6px}
.head + ol.key .f::before,.head + ol.key .k::before{display:none}
kbd{font-family:var(--mono);font-size:.8em;background:var(--chip);border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:0 5px}
em{font-style:italic}
footer{border-top:1px solid var(--line);padding-top:18px;color:var(--mute);font-size:.92rem;max-width:68ch;display:flex;flex-direction:column;gap:8px}
footer a{color:var(--amber)}
code{font-family:var(--mono);font-size:.85em}
@media (max-width:720px){
  .head{display:none}
  ol.key li{grid-template-columns:30px minmax(0,1fr)}
  .f,.k{grid-column:2}
  .head + ol.key .f::before,.head + ol.key .k::before{display:block}
}
`;

const GROUPS = { dash: 'Dashboard', tab: 'Console tab', mode: 'Mode' };

function section(state) {
  const rows = state.items
    .map(
      (it, i) => `      <li><span class="n">${i + 1}</span><span class="c">${rich(it.name)}</span><span class="f">${rich(it.fed)}</span><span class="k">${rich(it.click)}</span></li>`,
    )
    .join('\n');
  return `  <section id="${esc(state.id)}">
    <div class="eyebrow">${esc(GROUPS[state.group] ?? state.group)}</div>
    <h2>${esc(state.title)}</h2>
    <p class="intro">${rich(state.intro)}</p>
    <figure>
      <a class="zoom" href="${esc(state.image)}" target="_blank" rel="noopener"><img src="${esc(state.image)}" alt="${esc(state.title)}: the VibeTour dashboard with its controls numbered" width="${state.width}" height="${state.height}" loading="lazy"></a>
      <figcaption>${esc(state.caption ?? (state.close ? 'Close-up of the screen, demo display' : 'Demo display, 1280 × 760 at twice the pixels'))}. Open the picture for full size.</figcaption>
    </figure>
    <div class="head" aria-hidden="true"><span></span><span>Control</span><span>Fed by</span><span>Click or key</span></div>
    <ol class="key">
${rows}
    </ol>
  </section>`;
}

export function renderPage(states, { generated, wrap }) {
  const head = `<title>VibeTour Controls Map</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${STYLE}</style>`;
  const body = `<div class="wrap">
  <header>
    <div class="brand">VibeTour</div>
    <h1>Controls Map</h1>
    <p class="lede">Every control on the dashboard, screen by screen. The numbers on each picture match its key: what feeds the control, and what a click or a key does.</p>
    <div class="meta"><span>Made ${esc(generated)}</span><span>1280 × 760, 2× pixels</span><span>Re-make: npm run controls-map</span></div>
  </header>
  <nav aria-label="Screens">
${states.map((s) => `    <a href="#${esc(s.id)}">${esc(s.short ?? s.title)}</a>`).join('\n')}
  </nav>
${states.map(section).join('\n')}
  <footer>
    <p>The <a href="https://github.com/davidsparrow/vibetour/blob/main/docs/signal-map.md">Signal Map</a> has the wiring behind these controls: every signal VibeTour listens to, the moment it becomes, and what that moment does to each object.</p>
    <p>Pictures come from the browser demo, which plays a scripted coding session. Behind the glass is a still from the California Coast footage, in place of the live scene the app draws today. The FM radio picture comes from the CLI companion, playing a real station. Made by <code>tools/controls-map/</code>.</p>
  </footer>
</div>`;
  if (!wrap) return `${head}\n${body}\n`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body>
${body}
</body>
</html>
`;
}
