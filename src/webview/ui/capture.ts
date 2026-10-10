import type { JourneyPack, TimeOfDay } from '../../core/packs';
import type { TourSnapshot } from '../../core/protocol';

/**
 * "Capture my workplace" (PRD §29): a polished share card of the view and
 * destination. Private development details are never drawn; the project name
 * is opt-in.
 */

const WHEN: Record<TimeOfDay, string> = {
  dawn: 'at dawn',
  morning: 'this morning',
  day: 'today',
  golden: 'this evening',
  sunset: 'this evening',
  dusk: 'tonight',
  night: 'tonight',
};

export function captionFor(pack: JourneyPack, snap?: TourSnapshot): string {
  const j = snap?.journey;
  if (!j) return `Coding from ${pack.route.from} ${WHEN[pack.variants[0].timeOfDay]}.`;
  if (j.phase === 'arrived' || j.phase === 'staying') return `Coding from ${pack.route.to} ${WHEN[j.arrivalTimeOfDay ?? j.timeOfDay]}.`;
  const wp = pack.route.waypoints[j.location.waypointIndex] ?? pack.route.waypoints[0];
  const tod = j.progress > 0.6 && j.arrivalTimeOfDay ? j.arrivalTimeOfDay : j.timeOfDay;
  return `Coding ${j.location.label.startsWith('Near') || j.location.label.startsWith('Approaching') ? 'near' : 'from'} ${wp.name} ${WHEN[tod]}.`;
}

export function composeCapture(
  source: HTMLCanvasElement,
  pack: JourneyPack,
  opts: { caption: string; project?: string; snapshot?: TourSnapshot },
): HTMLCanvasElement {
  const W = 1600;
  const H = 900;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // Scene, cover-fitted.
  const scale = Math.max(W / source.width, H / source.height);
  const sw = source.width * scale;
  const sh = source.height * scale;
  g.drawImage(source, (W - sw) / 2, (H - sh) / 2, sw, sh);

  // Cinematic vignette.
  const v = g.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.5, H * 0.95);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);

  // A stylised dashboard silhouette with glowing instruments.
  g.fillStyle = 'rgba(8,10,14,0.92)';
  g.beginPath();
  g.moveTo(0, H);
  g.lineTo(0, H * 0.8);
  g.bezierCurveTo(W * 0.25, H * 0.73, W * 0.75, H * 0.73, W, H * 0.8);
  g.lineTo(W, H);
  g.closePath();
  g.fill();
  const dial = (x: number, r: number, color: string, value: number) => {
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(x, H * 0.9, r, Math.PI * 0.75, Math.PI * 2.25);
    g.stroke();
    g.strokeStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.beginPath();
    g.arc(x, H * 0.9, r, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * value));
    g.stroke();
    g.shadowBlur = 0;
  };
  const a = opts.snapshot?.activity;
  dial(W * 0.2, 46, '#ffb35c', a?.devActivity ?? 0.6);
  dial(W * 0.3, 46, '#6fd3ff', a?.agentActivity ?? 0.4);
  dial(W * 0.7, 34, '#7be0a0', opts.snapshot?.journey?.progress ?? 0.3);
  dial(W * 0.78, 34, '#ff7a6b', a?.errorIntensity ?? 0.1);

  // Caption and destination.
  g.textAlign = 'left';
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 18;
  g.font = '600 56px "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
  g.fillText(opts.caption, 72, 128);
  g.font = '500 26px "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.86)';
  g.fillText(`${pack.title}  ·  ${pack.route.from} → ${pack.route.to}  ·  ${pack.route.name}`, 74, 176);
  if (opts.project) {
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(`Building ${opts.project}`, 74, 214);
  }
  g.shadowBlur = 0;
  g.textAlign = 'center';
  g.font = '700 22px "Inter", system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillText('V I B E T O U R', W / 2, H - 40);
  g.font = '400 16px "Inter", system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillText('See the world while you code.', W / 2, H - 16);
  return c;
}

export function downloadCanvas(canvas: HTMLCanvasElement, fileName: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}
