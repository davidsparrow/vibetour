/** The package version, injected at build time; tests run unbundled and get a dev placeholder. */
export const VERSION: string = typeof __VIBETOUR_VERSION__ !== 'undefined' ? __VIBETOUR_VERSION__ : '0.0.0-dev';
