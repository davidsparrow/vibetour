import './styles.css';
import { App } from './app';
import { DemoHost } from './demo';
import { CompanionTransport, DemoTransport, VsCodeTransport, type Transport } from './transport';

declare global {
  interface Window {
    __VIBETOUR_BOOT__?: { host: 'vscode' } | { host: 'companion'; token: string } | { host: 'demo' };
  }
}

const boot = window.__VIBETOUR_BOOT__ ?? { host: 'demo' as const };
const params = new URLSearchParams(location.search);

let transport: Transport;
if (boot.host === 'vscode') {
  transport = new VsCodeTransport();
} else if (boot.host === 'companion') {
  transport = new CompanionTransport(boot.token);
} else {
  // ?speed=N accelerates the simulated session; ?fresh starts with empty state.
  const speed = Math.min(200, Math.max(1, Number(params.get('speed')) || 1));
  const demo = new DemoHost(speed, params.get('autopilot') !== '0', !params.has('fresh'));
  transport = new DemoTransport(demo);
}

const app = new App(document.getElementById('app')!, transport);
// Handy for debugging from the console and for end-to-end tests.
(window as unknown as { vibetour: App }).vibetour = app;
