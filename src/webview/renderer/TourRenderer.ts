import {
  NeutralToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Behavior } from '../../core/motion';
import type { EnvParams, JourneyPack, TimeOfDay, Weather } from '../../core/packs';
import type { ClientPrefs, DisplayMode } from '../../core/protocol';
import { Backdrop, SkyDome, type BackdropKind } from './sky';
import { Glows } from './glows';
import { Landmarks, LANDMARK_LATERAL, landmarkLength } from './landmarks';
import { lightingFor, mixLighting, type Lighting } from './lighting';
import { clamp, lerp, smoothstep } from './noise';
import { Props } from './props';
import { Road } from './road';
import { FarGround, Terrain, Water, type Pose } from './terrain';
import { Traffic } from './traffic';
import { Tunnels } from './tunnel';
import { WeatherFx } from './weather';
import { EnvSchedule, isWater, LANE, RoadPath, resolveEnv, ROAD_HALF, VIEW, type Feature, type ResolvedEnv } from './world';

export interface RenderState {
  pack: JourneyPack;
  /** Changes when the journey/variant changes, forcing a fresh world. */
  worldKey: string;
  seed: number;
  timeOfDay: TimeOfDay;
  arrivalTimeOfDay?: TimeOfDay;
  weather: Weather;
  skyTint?: string;
  progress: number;
  sceneKey: string;
  env: EnvParams;
  behavior: Behavior;
  targetSpeed: number;
}

export interface RendererStats {
  fps: number;
  pixelRatio: number;
  speed: number;
}

const STOPS: Behavior[] = ['scenic-stop', 'pull-over', 'arrived', 'parked'];
const STATIC_INTERVAL_S = 150;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

function backdropFor(t: ResolvedEnv['left']['terrain']): BackdropKind {
  if (t === 'mountains') return 'mountains';
  if (t === 'city') return 'skyline';
  if (t === 'ocean' || t === 'cliffs') return 'none';
  return 'hills';
}

/**
 * The Tour Renderer (PRD §17): a stylised, procedurally generated drive
 * rendered with three.js. Everything is camera-relative so journeys can run
 * for hours without precision problems.
 */
export class TourRenderer {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(58, 16 / 9, 0.3, 4000);
  private readonly hemi = new HemisphereLight('#ffffff', '#444444', 1);
  private readonly sun = new DirectionalLight('#ffffff', 2);
  private readonly headlights = new SpotLight('#fff1d6', 0, 190, 0.62, 0.75, 0.9);
  private readonly fog = new Fog('#cccccc', 60, 880);

  private readonly schedule = new EnvSchedule();
  private features: Feature[] = [];
  private nextFeatureId = 1;
  private path: RoadPath;
  private readonly sky = new SkyDome();
  private readonly backdrop = new Backdrop();
  private terrain!: Terrain;
  private readonly water = new Water();
  private readonly farGround = new FarGround();
  private road!: Road;
  private props!: Props;
  private landmarks!: Landmarks;
  private readonly tunnels: Tunnels;
  private readonly weather = new WeatherFx();
  private readonly glows = new Glows();
  private traffic!: Traffic;

  private state?: RenderState;
  private worldKey = '';
  private sceneKey = '';
  private lightA!: Lighting;
  private lightB!: Lighting;
  private light!: Lighting;
  private lightFrom?: Lighting;
  private lightBlend = 1;

  private d = 0;
  private v = 0;
  private lateral = LANE / 2;
  private time = 0;
  private inside = 0;
  private fade = 1;
  private staticTimer = 0;
  private openTunnel?: Feature;
  private straightKey?: string;

  private prefs: ClientPrefs;
  private mode: DisplayMode = 'tour';
  private running = false;
  private raf = 0;
  private last = 0;
  private lastFrame = 0;
  private basePixelRatio = 1;
  private pixelRatio = 1;
  private frameTimes: number[] = [];
  private throttleCheckAt = 0;
  private fps = 0;
  private fpsFrames = 0;
  private fpsAt = 0;
  private readonly resizeObserver?: ResizeObserver;
  private readonly sunDir = new Vector3();
  private readonly colors = { water: new Color(), groundFar: new Color(), silhouette: new Color() };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    prefs: ClientPrefs,
  ) {
    this.prefs = prefs;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: !prefs.lowGpu,
      powerPreference: prefs.lowGpu ? 'low-power' : 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.scene.fog = this.fog;
    this.scene.add(this.camera, this.hemi, this.sun, this.sun.target);
    this.camera.add(this.headlights, this.headlights.target);
    this.headlights.position.set(0, -0.4, 0);
    this.headlights.target.position.set(0, -1.6, -60);

    const feats = () => this.features;
    this.path = new RoadPath(1, this.schedule, feats);
    this.tunnels = new Tunnels(this.path);
    this.scene.add(this.sky.mesh, this.backdrop.group, this.water.mesh, this.farGround.mesh, this.tunnels.group, this.weather.group, this.glows.group);

    this.applyPixelRatio(true);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement ?? canvas);
    }
    this.resize();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  // -------------------------------------------------------------- public API

  setPrefs(prefs: ClientPrefs): void {
    const lowChanged = prefs.lowGpu !== this.prefs.lowGpu;
    this.prefs = prefs;
    if (lowChanged) this.applyPixelRatio(true);
    this.props?.setDensity(prefs.lowGpu ? 0.55 : 1);
    this.applyWeather();
  }

  setMode(mode: DisplayMode): void {
    this.mode = mode;
  }

  setState(state: RenderState): void {
    const prev = this.state;
    this.state = state;
    if (state.worldKey !== this.worldKey) {
      this.buildWorld(state);
      return;
    }
    if (state.sceneKey !== this.sceneKey) this.scheduleScene(state);
    if (
      !prev ||
      prev.timeOfDay !== state.timeOfDay ||
      prev.arrivalTimeOfDay !== state.arrivalTimeOfDay ||
      prev.weather !== state.weather ||
      prev.skyTint !== state.skyTint
    ) {
      this.setLighting(state, true);
    }
    const wasCheckpoint = prev?.behavior === 'checkpoint';
    if (state.behavior === 'checkpoint' && !wasCheckpoint) this.openCheckpoint();
    if (state.behavior !== 'checkpoint' && (this.openTunnel || this.straightKey)) this.closeCheckpoint();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  get stats(): RendererStats {
    return { fps: this.fps, pixelRatio: this.pixelRatio, speed: this.v };
  }

  /** Renders a fresh frame and returns the canvas for compositing (PRD §29). */
  capture(): HTMLCanvasElement {
    if (this.state) this.frame(0);
    return this.canvas;
  }

  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver?.disconnect();
    this.terrain?.dispose();
    this.road?.dispose();
    this.props?.dispose();
    this.landmarks?.dispose();
    this.traffic?.dispose();
    this.tunnels.dispose();
    this.weather.dispose();
    this.glows.dispose();
    this.sky.dispose();
    this.backdrop.dispose();
    this.water.dispose();
    this.farGround.dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------- world setup

  private buildWorld(state: RenderState): void {
    const pack = state.pack;
    const firstWorld = this.worldKey === '';
    this.worldKey = state.worldKey;
    this.sceneKey = state.sceneKey;
    const seed = state.seed;
    const env = resolveEnv(pack, state.env);
    this.features = [];
    this.openTunnel = undefined;
    this.straightKey = undefined;
    this.schedule.reset(env, state.sceneKey);
    this.path = new RoadPath(seed, this.schedule, () => this.features);
    this.path.reset(0);
    this.d = 40;
    this.v = firstWorld ? state.targetSpeed * pack.cruiseSpeed * 0.8 : this.v * 0.5;
    this.lateral = (pack.drivingSide === 'right' ? 1 : -1) * (LANE / 2);
    this.fade = firstWorld ? 1 : 0;

    this.terrain?.mesh.removeFromParent();
    this.terrain?.dispose();
    this.terrain = new Terrain(this.path, this.schedule, () => this.features, seed % 97);
    this.terrain.reset(seed % 97, pack.palette);
    this.scene.add(this.terrain.mesh);

    this.road?.surface.removeFromParent();
    this.road?.rails.removeFromParent();
    this.road?.dispose();
    this.road = new Road(this.path, this.schedule, () => this.features);
    this.road.setPack(pack, this.renderer);
    this.scene.add(this.road.surface, this.road.rails);

    this.props?.dispose();
    this.props = new Props(this.path, this.schedule, () => this.features, (s, lat) => this.terrain.heightAt(s, lat), seed);
    this.props.setDensity(this.prefs.lowGpu ? 0.55 : 1);
    for (const m of this.props.setPalette(pack.palette, seed)) this.scene.add(m);

    this.landmarks?.group.removeFromParent();
    this.landmarks?.dispose();
    this.landmarks = new Landmarks(this.path, (s, lat) => this.terrain.heightAt(s, lat), pack.palette, seed);
    this.scene.add(this.landmarks.group);

    this.tunnels.path = this.path;
    this.tunnels.setRock(pack.palette.rock);

    this.traffic?.mesh.removeFromParent();
    this.traffic?.dispose();
    this.traffic = new Traffic(this.path);
    const city = env.left.terrain === 'city' || env.right.terrain === 'city';
    this.traffic.configure(pack.drivingSide, pack.palette.accents, pack.travelMode === 'drive' ? (city ? 2 : 1) : 0);
    this.scene.add(this.traffic.mesh);

    const pal = pack.palette;
    this.colors.water.set(pal.water);
    this.colors.groundFar.set(pal.groundFar).multiplyScalar(0.9);
    this.colors.silhouette.set(pal.rock).lerp(new Color(pal.groundFar), 0.4).multiplyScalar(0.6);
    if (pack.moods.includes('mountains')) this.colors.silhouette.lerp(new Color(pal.snow), 0.22);

    this.registerFeatures(env, 60);
    this.path.ensure(this.d + VIEW + 200);
    this.setLighting(state, !firstWorld);
    this.applyWeather();
    if (state.behavior === 'checkpoint') this.openCheckpoint();
  }

  private scheduleScene(state: RenderState): void {
    this.sceneKey = state.sceneKey;
    const env = resolveEnv(state.pack, state.env);
    const s = Math.max(this.path.computedUntil + 8, this.d + 60);
    if (this.schedule.push(s, env, state.sceneKey)) this.registerFeatures(env, s);
  }

  private registerFeatures(env: ResolvedEnv, s: number): void {
    const id = () => this.nextFeatureId++;
    if (env.bridge && (env.landmark === 'arch-bridge' || env.landmark === 'suspension-bridge')) {
      const L = landmarkLength(env.landmark);
      const s0 = s + 160;
      this.features.push({ id: id(), kind: 'bridge', s0, s1: s0 + L });
      this.features.push({ id: id(), kind: 'landmark', s0, s1: s0 + L, landmark: env.landmark, lateral: 0 });
    } else if (env.landmark) {
      const s0 = s + 260;
      this.features.push({
        id: id(),
        kind: 'landmark',
        s0,
        s1: s0 + landmarkLength(env.landmark),
        landmark: env.landmark,
        side: env.landmarkSide,
        lateral: LANDMARK_LATERAL[env.landmark],
      });
    }
    if (env.tunnel) {
      const s0 = s + 200;
      this.features.push({ id: id(), kind: 'tunnel', s0, s1: s0 + 520 });
    }
    // Forget features far behind us.
    this.features = this.features.filter((f) => f.s1 > this.d - 600);
  }

  /** Tests/builds started: stage a tunnel, gallery or long straight ahead (PRD §41). */
  private openCheckpoint(): void {
    if (!this.state || this.openTunnel || this.straightKey || this.prefs.staticScenery) return;
    const env = this.schedule.at(this.d + 400).b;
    if (env.checkpoint === 'straight') {
      // A long straight road: flatten the curves from the horizon onwards.
      this.straightKey = `${this.sceneKey}:straight`;
      this.schedule.push(this.path.computedUntil + 8, { ...this.schedule.last, curvature: 0.04, hilliness: 0.2 }, this.straightKey);
      return;
    }
    const kind = env.checkpoint === 'tunnel' ? 'tunnel' : 'gallery';
    const lastEnd = Math.max(0, ...this.features.filter((f) => f.kind === 'tunnel' || f.kind === 'gallery').map((f) => (Number.isFinite(f.s1) ? f.s1 : this.d)));
    const s0 = Math.max(this.d + 380, lastEnd + 120);
    if (this.features.some((f) => f.kind === 'bridge' && f.s1 > s0 - 50 && f.s0 < s0 + 400)) return;
    const side = isWater(env.left.terrain) && !isWater(env.right.terrain) ? 'left' : 'right';
    this.openTunnel = { id: this.nextFeatureId++, kind, s0, s1: Infinity, side };
    this.features.push(this.openTunnel);
  }

  /** Verification finished: the road opens up. */
  private closeCheckpoint(): void {
    if (this.straightKey && this.state) {
      this.straightKey = undefined;
      this.schedule.push(this.path.computedUntil + 8, resolveEnv(this.state.pack, this.state.env), this.sceneKey);
    }
    const t = this.openTunnel;
    if (!t) return;
    t.s1 = Math.max(this.d + 90, t.s0 + 160);
    this.openTunnel = undefined;
  }

  private setLighting(state: RenderState, animate: boolean): void {
    const tint = state.skyTint ?? state.pack.palette.skyTint;
    const weather = this.prefs.noWeather && state.weather !== 'clear' && state.weather !== 'cloudy' ? 'cloudy' : state.weather;
    this.lightA = lightingFor(state.timeOfDay, weather, tint);
    this.lightB = lightingFor(state.arrivalTimeOfDay ?? state.timeOfDay, weather, tint);
    if (animate && this.light) {
      this.lightFrom = mixLighting(this.light, this.light, 0);
      this.lightBlend = 0;
    } else {
      this.lightBlend = 1;
    }
    this.light = mixLighting(this.lightA, this.lightB, 0);
  }

  private applyWeather(): void {
    const w = this.state?.weather ?? 'clear';
    const on = !this.prefs.noWeather;
    this.weather.set(on ? w : 'clear', this.prefs.lowGpu ? 0.5 : 1);
    this.road?.setWet(on && w === 'rain' ? 1 : 0);
  }

  // ------------------------------------------------------------------ frame

  private readonly onVisibility = () => {
    if (!document.hidden && this.running) {
      this.last = performance.now();
    }
  };

  private readonly loop = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden || !this.state) return;
    const targetFps = this.mode === 'work' ? 4 : this.prefs.lowGpu ? 30 : this.prefs.fps;
    if (now - this.lastFrame < 1000 / targetFps - 2) return;
    this.lastFrame = now;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();
    this.frame(dt);
    this.trackPerformance(performance.now() - t0, targetFps, now);
  };

  private frame(dt: number): void {
    const state = this.state!;
    const pack = state.pack;
    const prefs = this.prefs;
    this.time += dt;

    // Speed: calm acceleration, never twitchy (PRD §10).
    const reduce = prefs.reducedMotion ? 0.6 : 1;
    let target = state.targetSpeed * pack.cruiseSpeed * reduce;
    if (prefs.staticScenery) target = 0;
    const accel = 1.5 * reduce;
    const decel = 2.1 * reduce;
    this.v += clamp(target - this.v, -decel * dt, accel * dt);
    if (this.v < 0.02 && target === 0) this.v = 0;
    this.d += this.v * dt;

    if (prefs.staticScenery) {
      // Static Mode: a rotating sequence of scenic stops (PRD §24).
      this.staticTimer += dt;
      if (this.staticTimer > STATIC_INTERVAL_S) {
        this.fade = Math.max(0, this.fade - dt * 1.5);
        if (this.fade <= 0) {
          this.staticTimer = 0;
          this.d += 700;
        }
      } else this.fade = Math.min(1, this.fade + dt * 0.8);
    } else {
      this.fade = Math.min(1, this.fade + dt * 0.8);
    }

    // Pull onto the shoulder for stops.
    const sideSign = pack.drivingSide === 'right' ? 1 : -1;
    const stopping = STOPS.includes(state.behavior);
    const laneTarget = sideSign * (stopping ? ROAD_HALF + 1.1 : LANE / 2);
    const shiftRate = stopping ? (this.v < pack.cruiseSpeed * 0.75 ? 0.9 : 0) : 1.2;
    this.lateral += clamp(laneTarget - this.lateral, -shiftRate * dt, shiftRate * dt);

    this.path.ensure(this.d + VIEW + 200);
    this.path.prune(this.d - 400);
    this.schedule.prune(this.d - 400);

    // Camera pose.
    const c = this.path.sample(this.d);
    const ahead = this.path.sample(this.d + 7);
    const h = ahead.h;
    const pose: Pose = {
      d: this.d,
      x: c.x + Math.cos(c.h) * this.lateral,
      z: c.z + Math.sin(c.h) * this.lateral,
      y: c.e + 1.25,
      h,
      cos: Math.cos(h),
      sin: Math.sin(h),
    };
    const slope = (this.path.sample(this.d + 24).e - c.e) / 24;
    const motionOk = !prefs.reducedMotion && !prefs.noCameraMotion;
    const curvature = this.path.curvature(this.d, c.h);
    const bob = motionOk ? Math.sin(this.time * 9) * 0.012 * (this.v / 20) : 0;
    pose.y += bob;
    this.camera.rotation.set(Math.atan(slope) * 0.7 - 0.045, 0, motionOk ? clamp(-curvature * this.v * 0.9, -0.03, 0.03) : 0, 'YXZ');

    // Lighting: journey-progress time-of-day blend + variant crossfade.
    const progressT = smoothstep(0.35, 1, state.progress);
    let light = mixLighting(this.lightA, this.lightB, progressT, this.light);
    if (this.lightFrom && this.lightBlend < 1) {
      this.lightBlend = Math.min(1, this.lightBlend + dt / 3);
      light = mixLighting(this.lightFrom, light, smoothstep(0, 1, this.lightBlend), this.light);
    }
    this.light = light;

    // Feature layers.
    this.inside = lerp(this.inside, this.tunnels.update(pose, this.features), Math.min(1, dt * 3));
    const env = this.schedule.at(this.d).b;
    const az = (env.sunAzimuth * Math.PI) / 180;
    const el = (light.sunElevation * Math.PI) / 180;
    // World-space sun, rotated into the camera's frame.
    const wx = Math.sin(az) * Math.cos(el);
    const wz = -Math.cos(az) * Math.cos(el);
    this.sunDir.set(wx * pose.cos + wz * pose.sin, Math.sin(el), -wx * pose.sin + wz * pose.cos).normalize();

    const dim = 1 - this.inside * 0.78;
    this.hemi.color.copy(light.skyHorizon).lerp(light.skyTop, 0.35);
    this.hemi.groundColor.copy(light.hemiGround);
    // three.js lights are physically based (Lambert divides by π), hence the scale.
    this.hemi.intensity = light.ambient * 2.5 * dim;
    this.sun.color.copy(light.sun);
    this.sun.intensity = light.sunIntensity * 1.9 * (1 - this.inside * 0.9) * smoothstep(-6, 2, light.sunElevation);
    this.sun.position.copy(this.sunDir).multiplyScalar(200);
    this.headlights.intensity = Math.max(light.night, this.inside * 0.6) * 60;
    this.fog.color.copy(light.fog).multiplyScalar(1 - this.inside * 0.7);
    this.fog.near = light.fogNear;
    this.fog.far = light.fogFar;
    this.renderer.toneMappingExposure = light.exposure * (0.25 + 0.75 * this.fade);

    this.sky.update(light, this.sunDir, this.time, this.d);
    const left = backdropFor(env.left.terrain);
    const right = backdropFor(env.right.terrain);
    const silhouette = this.colors.silhouette;
    this.backdrop.setKinds(left, right, state.seed % 13, silhouette);
    this.backdrop.update(dt, h, pose.y, light.fog, light.night, silhouette);

    this.terrain.update(pose);
    this.road.update(pose);
    const waterInView = this.schedule.anyWater(this.d - 300, this.d + VIEW + 300);
    this.water.update(pose, {
      water: this.colors.water,
      sky: light.skyHorizon,
      sun: light.sun,
      sunDir: this.sunDir,
      fog: this.fog,
      time: prefs.reducedMotion ? 0 : this.time,
      night: light.night,
      ambient: light.ambient * dim,
    });
    this.water.mesh.visible = waterInView;
    this.farGround.update(pose, this.colors.groundFar, !waterInView);

    this.glows.begin(this.fog.far);
    this.props.update(pose, light.night, this.glows);
    this.landmarks.update(pose, this.features, this.glows, this.time, light.night);
    this.traffic.update(pose, dt, this.time, this.features, light.night, this.glows, !prefs.staticScenery);
    this.glows.commit(Math.max(light.night, this.inside * 0.3));
    this.weather.update(dt, this.v, this.time, this.inside);

    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ performance

  private applyPixelRatio(reset: boolean): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.basePixelRatio = this.prefs.lowGpu ? Math.min(dpr, 1) * 0.65 : Math.min(dpr, 2);
    if (reset) this.pixelRatio = this.basePixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.resize();
  }

  /** Automatic GPU throttling (PRD §25). */
  private trackPerformance(ms: number, targetFps: number, now: number): void {
    this.fpsFrames++;
    if (now - this.fpsAt > 1000) {
      this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsAt));
      this.fpsFrames = 0;
      this.fpsAt = now;
    }
    if (!this.prefs.autoThrottle || this.mode === 'work') return;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (now < this.throttleCheckAt || this.frameTimes.length < 60) return;
    this.throttleCheckAt = now + 2500;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const budget = 1000 / targetFps;
    if (avg > budget * 0.85 && this.pixelRatio > 0.5) {
      this.pixelRatio = Math.max(0.5, this.pixelRatio * 0.82);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.frameTimes = [];
    } else if (avg < budget * 0.35 && this.pixelRatio < this.basePixelRatio) {
      this.pixelRatio = Math.min(this.basePixelRatio, this.pixelRatio * 1.15);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.frameTimes = [];
    }
  }

  resize(): void {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth);
    const hgt = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    // Wide windows get a slightly narrower vertical FOV so the road stays natural.
    this.camera.fov = w / hgt > 2 ? 50 : 58;
    this.camera.updateProjectionMatrix();
  }
}

export { hashString };
