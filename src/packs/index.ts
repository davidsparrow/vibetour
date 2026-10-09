import type { JourneyPack } from '../core/packs';
import californiaCoast from '../../packs/california-coast/manifest.json';

/**
 * Built-in Journey Packs: the free "VibeTour Originals" (PRD §71, §72).
 * Each lives in /packs/<id>/manifest.json, matching the Journey Pack layout
 * from PRD §39.
 */
export const BUILTIN_PACKS: JourneyPack[] = [californiaCoast as unknown as JourneyPack];

export const DEFAULT_PACK_ID = 'california-coast';
