import { randomBytes } from 'node:crypto';

/**
 * The page that loads the browser app (dist/webview/app.js + app.css), shared
 * by the VS Code webview and the Companion Display server. The app reads its
 * host from `window.__VIBETOUR_BOOT__`, set by an inline nonce'd script.
 */

export type BootConfig = { host: 'vscode' } | { host: 'companion'; token: string };

export interface AppPageOptions {
  boot: BootConfig;
  nonce: string;
  /** Maps an asset name (`app.js`) to the URL the page loads it from. Defaults to the relative name. */
  asset?: (name: string) => string;
  /** CSP for a `<meta>` tag (webviews). The companion server sends its CSP as a header instead. */
  csp?: string;
}

export function makeNonce(): string {
  return randomBytes(18).toString('base64url');
}

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** JSON that is safe to inline inside a `<script>` element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function renderAppHtml(opts: AppPageOptions): string {
  const asset = opts.asset ?? ((name: string) => name);
  const nonce = attr(opts.nonce);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    ...(opts.csp ? [`<meta http-equiv="Content-Security-Policy" content="${attr(opts.csp)}">`] : []),
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<title>VibeTour</title>',
    `<link rel="icon" href="${attr(asset('favicon.svg'))}">`,
    `<link rel="stylesheet" href="${attr(asset('app.css'))}">`,
    '</head>',
    '<body>',
    '<div id="app"></div>',
    `<script nonce="${nonce}">window.__VIBETOUR_BOOT__ = ${scriptJson(opts.boot)};</script>`,
    `<script nonce="${nonce}" src="${attr(asset('app.js'))}"></script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function webviewCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data: blob:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${cspSource}`,
    'media-src blob: data:',
    "connect-src 'none'",
  ].join('; ');
}

export function companionCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "media-src 'self' blob: data:",
    "frame-ancestors 'none'",
  ].join('; ');
}
