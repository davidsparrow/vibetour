/** What the battery gauge can show on this display. */
export type BatteryStatus =
  /** The browser doesn't report battery (Safari, Firefox). */
  | { kind: 'unsupported' }
  /** No battery found yet: a desktop, or a laptop that's plugged in and full. */
  | { kind: 'none' }
  | { kind: 'battery'; level: number; charging: boolean };

/** The fields of the browser's BatteryManager that matter here. */
export interface BatteryReading {
  level: number;
  charging: boolean;
  dischargingTime: number;
}

/**
 * Browsers report a desktop as a battery that is full, charging and never
 * draining, and a laptop that's plugged in and full looks just the same. So
 * that counts as no battery until it drains or drops below full; once a
 * battery has shown up (`seen`), it stays.
 */
export function batteryStatus(b: BatteryReading, seen: boolean): BatteryStatus {
  const onMainsAndFull = b.charging && b.level >= 1 && b.dischargingTime === Infinity;
  return onMainsAndFull && !seen ? { kind: 'none' } : { kind: 'battery', level: b.level, charging: b.charging };
}

/** Why the battery gauge is hidden on this display, or null when it can show. */
export function batteryHiddenReason(status: BatteryStatus): string | null {
  if (status.kind === 'unsupported') return "this browser doesn't report battery";
  if (status.kind === 'none') return 'no battery found yet';
  return null;
}
