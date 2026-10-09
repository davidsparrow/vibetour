import type { JourneyPack } from '../core/packs';
import californiaCoast from '../../packs/california-coast/manifest.json';
import icelandSouthCoast from '../../packs/iceland-south-coast/manifest.json';
import marsColony from '../../packs/mars-colony/manifest.json';
import scottishHighlands from '../../packs/scottish-highlands/manifest.json';
import swissAlps from '../../packs/swiss-alps/manifest.json';
import tokyoNight from '../../packs/tokyo-night/manifest.json';
import tuscany from '../../packs/tuscany/manifest.json';

/**
 * Built-in Journey Packs: the free "VibeTour Originals" (PRD §71, §72).
 * Each lives in /packs/<id>/manifest.json, matching the Journey Pack layout
 * from PRD §39.
 */
export const BUILTIN_PACKS: JourneyPack[] = [
  californiaCoast,
  tokyoNight,
  swissAlps,
  tuscany,
  icelandSouthCoast,
  scottishHighlands,
  marsColony,
] as unknown as JourneyPack[];

export const DEFAULT_PACK_ID = 'california-coast';
