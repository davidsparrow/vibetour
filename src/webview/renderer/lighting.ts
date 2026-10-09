import { Color } from 'three';
import type { TimeOfDay, Weather } from '../../core/packs';

/**
 * Stylised time-of-day and weather presets. The goal is "premium driving game
 * menu / cinematic visualisation" (PRD §17), not physical accuracy.
 */

export interface Lighting {
  skyTop: Color;
  skyHorizon: Color;
  hemiGround: Color;
  sun: Color;
  sunIntensity: number;
  /** Degrees above the horizon (negative = below). */
  sunElevation: number;
  ambient: number;
  fog: Color;
  fogNear: number;
  fogFar: number;
  stars: number;
  /** 0 = daylight, 1 = full night (headlights, lit windows, glows). */
  night: number;
  clouds: number;
  exposure: number;
}

interface Preset {
  skyTop: string;
  skyHorizon: string;
  hemiGround: string;
  sun: string;
  sunIntensity: number;
  sunElevation: number;
  ambient: number;
  fog: string;
  stars: number;
  night: number;
  clouds: number;
  exposure: number;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  dawn: { skyTop: '#2c3d6e', skyHorizon: '#f2a98c', hemiGround: '#5a4a52', sun: '#ffb48e', sunIntensity: 1.0, sunElevation: 4, ambient: 0.55, fog: '#d3a99f', stars: 0.25, night: 0.35, clouds: 0.35, exposure: 1.0 },
  morning: { skyTop: '#5a8fd4', skyHorizon: '#d4e6f3', hemiGround: '#6b6a55', sun: '#fff0d4', sunIntensity: 1.9, sunElevation: 22, ambient: 0.8, fog: '#cfe0ec', stars: 0, night: 0, clouds: 0.3, exposure: 1.0 },
  day: { skyTop: '#3c7bd6', skyHorizon: '#bdd9f1', hemiGround: '#6f6c58', sun: '#fffaf0', sunIntensity: 2.2, sunElevation: 55, ambient: 0.9, fog: '#c3daee', stars: 0, night: 0, clouds: 0.3, exposure: 1.0 },
  golden: { skyTop: '#4b70b5', skyHorizon: '#f5c88e', hemiGround: '#6e5a48', sun: '#ffcf8c', sunIntensity: 2.0, sunElevation: 11, ambient: 0.72, fog: '#e9c79f', stars: 0, night: 0, clouds: 0.35, exposure: 1.02 },
  sunset: { skyTop: '#2f3f7a', skyHorizon: '#ff9a64', hemiGround: '#5e4446', sun: '#ff8c52', sunIntensity: 1.6, sunElevation: 2.5, ambient: 0.58, fog: '#e79d78', stars: 0.05, night: 0.2, clouds: 0.45, exposure: 1.05 },
  dusk: { skyTop: '#151c40', skyHorizon: '#7e5c8e', hemiGround: '#2f2a3c', sun: '#d07a76', sunIntensity: 0.45, sunElevation: -3, ambient: 0.4, fog: '#4c4064', stars: 0.55, night: 0.8, clouds: 0.3, exposure: 1.1 },
  night: { skyTop: '#04070f', skyHorizon: '#18223f', hemiGround: '#10131c', sun: '#a9bcff', sunIntensity: 0.35, sunElevation: 38, ambient: 0.3, fog: '#141c33', stars: 1, night: 1, clouds: 0.25, exposure: 1.15 },
};

function preset(time: TimeOfDay): Lighting {
  const p = PRESETS[time];
  return {
    skyTop: new Color(p.skyTop),
    skyHorizon: new Color(p.skyHorizon),
    hemiGround: new Color(p.hemiGround),
    sun: new Color(p.sun),
    sunIntensity: p.sunIntensity,
    sunElevation: p.sunElevation,
    ambient: p.ambient,
    fog: new Color(p.fog),
    fogNear: 80,
    fogFar: 980,
    stars: p.stars,
    night: p.night,
    clouds: p.clouds,
    exposure: p.exposure,
  };
}

function applyWeather(l: Lighting, weather: Weather): Lighting {
  const grey = new Color('#9aa3ad').multiplyScalar(0.4 + 0.6 * (1 - l.night));
  switch (weather) {
    case 'cloudy':
      l.skyTop.lerp(grey, 0.45);
      l.skyHorizon.lerp(grey, 0.3);
      l.sunIntensity *= 0.55;
      l.clouds = 0.85;
      l.fogFar = 700;
      break;
    case 'rain':
      l.skyTop.lerp(grey, 0.7).multiplyScalar(0.75);
      l.skyHorizon.lerp(grey, 0.6).multiplyScalar(0.8);
      l.fog.lerp(grey, 0.6).multiplyScalar(0.8);
      l.sunIntensity *= 0.35;
      l.ambient *= 0.85;
      l.clouds = 1;
      l.stars *= 0.1;
      l.fogNear = 20;
      l.fogFar = 460;
      l.night = Math.max(l.night, 0.35);
      break;
    case 'fog':
      l.skyTop.lerp(l.fog, 0.6);
      l.skyHorizon.lerp(l.fog, 0.85);
      l.sunIntensity *= 0.5;
      l.fogNear = 5;
      l.fogFar = 240;
      l.stars *= 0.2;
      l.clouds = 0.6;
      break;
    case 'snow': {
      const white = new Color('#dfe6ee').multiplyScalar(0.5 + 0.5 * (1 - l.night));
      l.skyTop.lerp(white, 0.5);
      l.skyHorizon.lerp(white, 0.6);
      l.fog.lerp(white, 0.7);
      l.sunIntensity *= 0.5;
      l.fogNear = 10;
      l.fogFar = 380;
      l.clouds = 0.9;
      l.stars *= 0.1;
      break;
    }
    case 'clear':
      break;
  }
  return l;
}

export function lightingFor(time: TimeOfDay, weather: Weather, skyTint?: string): Lighting {
  const l = applyWeather(preset(time), weather);
  if (skyTint) {
    const tint = new Color(skyTint);
    const amount = 0.82 * (1 - l.night * 0.6);
    l.skyTop.lerp(tint.clone().multiplyScalar(0.75), amount * 0.85);
    l.skyHorizon.lerp(tint, amount);
    l.fog.lerp(tint, amount * 0.9);
  }
  return l;
}

export function mixLighting(a: Lighting, b: Lighting, t: number, out?: Lighting): Lighting {
  const o = out ?? {
    skyTop: new Color(),
    skyHorizon: new Color(),
    hemiGround: new Color(),
    sun: new Color(),
    fog: new Color(),
  } as Lighting;
  const n = (x: number, y: number) => x + (y - x) * t;
  o.skyTop.copy(a.skyTop).lerp(b.skyTop, t);
  o.skyHorizon.copy(a.skyHorizon).lerp(b.skyHorizon, t);
  o.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
  o.sun.copy(a.sun).lerp(b.sun, t);
  o.fog.copy(a.fog).lerp(b.fog, t);
  o.sunIntensity = n(a.sunIntensity, b.sunIntensity);
  o.sunElevation = n(a.sunElevation, b.sunElevation);
  o.ambient = n(a.ambient, b.ambient);
  o.fogNear = n(a.fogNear, b.fogNear);
  o.fogFar = n(a.fogFar, b.fogFar);
  o.stars = n(a.stars, b.stars);
  o.night = n(a.night, b.night);
  o.clouds = n(a.clouds, b.clouds);
  o.exposure = n(a.exposure, b.exposure);
  return o;
}
