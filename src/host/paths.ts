/**
 * Path helpers shared by the IDE adapter and the standalone CLI: which paths
 * are tooling churn rather than development activity, and a display name for
 * a file's language. Paths are workspace-relative.
 */

/**
 * Directories whose changes are build output, dependencies or caches. A test
 * run that writes `__pycache__` or a `cargo build` filling `target/` must not
 * look like an agent editing the project.
 */
const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  'coverage',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.gradle',
  '.idea',
  '.vibetour-dev',
]);

/** Editor swap files, OS metadata and temp files. */
const TEMP_FILE = /^(\.DS_Store|Thumbs\.db)$|\.(swp|swo|swx|tmp)$|~$|^\.#|^#.*#$|^4913$/;

export function isIgnoredPath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => IGNORED_DIRS.has(p))) return true;
  return TEMP_FILE.test(parts[parts.length - 1] ?? '');
}

/** Workspace-relative, no `..` segments, not absolute: safe to join onto a workspace root. */
export function isSafeRelativePath(relPath: unknown): relPath is string {
  if (typeof relPath !== 'string' || !relPath || relPath.length > 1024 || relPath.includes('\0')) return false;
  if (/^([\\/]|[a-zA-Z]:)/.test(relPath)) return false;
  return !relPath.split(/[\\/]+/).some((p) => p === '..');
}

const ID_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  typescriptreact: 'TypeScript',
  javascript: 'JavaScript',
  javascriptreact: 'JavaScript',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  ruby: 'Ruby',
  php: 'PHP',
  csharp: 'C#',
  fsharp: 'F#',
  cpp: 'C++',
  c: 'C',
  'objective-c': 'Objective-C',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  html: 'HTML',
  vue: 'Vue',
  svelte: 'Svelte',
  markdown: 'Markdown',
  json: 'JSON',
  jsonc: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  shellscript: 'Shell',
  powershell: 'PowerShell',
  sql: 'SQL',
  dart: 'Dart',
  lua: 'Lua',
  elixir: 'Elixir',
  scala: 'Scala',
  zig: 'Zig',
  haskell: 'Haskell',
  dockerfile: 'Dockerfile',
  plaintext: 'Text',
};

const EXT_IDS: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  cs: 'csharp',
  fs: 'fsharp',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  c: 'c',
  h: 'c',
  m: 'objective-c',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  vue: 'vue',
  svelte: 'svelte',
  md: 'markdown',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  ps1: 'powershell',
  sql: 'sql',
  dart: 'dart',
  lua: 'lua',
  ex: 'elixir',
  exs: 'elixir',
  scala: 'scala',
  zig: 'zig',
  hs: 'haskell',
};

/** Display name for a VS Code language id, e.g. `typescriptreact` → `TypeScript`. */
export function languageName(languageId: string): string | undefined {
  if (!languageId) return undefined;
  return ID_NAMES[languageId] ?? languageId.charAt(0).toUpperCase() + languageId.slice(1);
}

/** Display name for a file's language, guessed from its extension. */
export function languageForPath(path: string): string | undefined {
  const name = path.split(/[\\/]/).pop() ?? '';
  if (name === 'Dockerfile') return 'Dockerfile';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const id = EXT_IDS[name.slice(dot + 1).toLowerCase()];
  return id ? ID_NAMES[id] : undefined;
}
