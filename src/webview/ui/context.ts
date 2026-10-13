import type { JourneyPack } from '../../core/packs';
import type { Catalog, ClientCommand, ClientPrefs, DisplayMode, HostInfo, TourSnapshot } from '../../core/protocol';
import type { BatteryStatus } from './battery';

/** What UI components need from the app shell. */
export interface AppContext {
  send(cmd: ClientCommand): void;
  readonly host?: HostInfo;
  readonly catalog?: Catalog;
  readonly snapshot?: TourSnapshot;
  readonly prefs: ClientPrefs;
  /** This display's battery, for the battery gauge. */
  readonly battery: BatteryStatus;
  pack(id: string): JourneyPack | undefined;
  setMode(mode: DisplayMode): void;
  open(view: 'picker' | 'passport' | 'settings' | 'help'): void;
  close(): void;
  capture(caption?: string): void;
  toast(text: string): void;
  updatePrefs(change: (p: ClientPrefs) => void): void;
  previewPack(packId: string | undefined, variantId?: string): void;
}
