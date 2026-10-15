import type { RadioStation } from '../../core/music';

/**
 * The curated FM presets: SomaFM, a listener-supported, commercial-free
 * station group in San Francisco with stable stream URLs. The FM pane credits
 * them and links to somafm.com/support.
 */

export interface PresetStation extends RadioStation {
  url: string;
}

export const SOMAFM_SUPPORT_URL = 'https://somafm.com/support/';

const soma = (channel: string, name: string, tags: string[]): PresetStation => ({
  id: `soma:${channel}`,
  name,
  codec: 'MP3',
  bitrate: 128,
  countryCode: 'US',
  country: 'United States',
  tags,
  homepage: `https://somafm.com/${channel}/`,
  source: 'preset',
  url: `https://ice1.somafm.com/${channel}-128-mp3`,
});

export const SOMAFM_PRESETS: PresetStation[] = [
  soma('groovesalad', 'Groove Salad', ['ambient', 'downtempo']),
  soma('dronezone', 'Drone Zone', ['ambient', 'space']),
  soma('spacestation', 'Space Station Soma', ['electronic', 'space']),
  soma('lush', 'Lush', ['electronic', 'vocal']),
  soma('secretagent', 'Secret Agent', ['lounge', 'soundtrack']),
  soma('bootliquor', 'Boot Liquor', ['americana', 'country']),
  soma('deepspaceone', 'Deep Space One', ['ambient', 'space']),
  soma('missioncontrol', 'Mission Control', ['ambient', 'space']),
  soma('beatblender', 'Beat Blender', ['electronic', 'house']),
  soma('indiepop', 'Indie Pop Rocks!', ['indie', 'pop']),
  soma('u80s', 'Underground 80s', ['80s', 'new wave']),
  soma('seventies', 'Left Coast 70s', ['70s', 'rock']),
  soma('folkfwd', 'Folk Forward', ['folk', 'indie']),
  soma('sonicuniverse', 'Sonic Universe', ['jazz']),
  soma('illstreet', 'Illinois Street Lounge', ['lounge', 'exotica']),
  soma('thistle', 'ThistleRadio', ['celtic', 'world']),
  soma('suburbsofgoa', 'Suburbs of Goa', ['world', 'asian']),
  soma('fluid', 'Fluid', ['hiphop', 'instrumental']),
];

/** Strips the stream URL: what displays may see. */
export function publicStation({ url: _url, ...station }: PresetStation): RadioStation {
  return station;
}
