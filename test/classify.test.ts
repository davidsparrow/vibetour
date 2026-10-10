import { describe, expect, it } from 'vitest';
import { classifyCommand, classifyTask, safeLabel } from '../src/core/classify';

describe('classifyCommand', () => {
  it.each([
    ['npm test', 'test', 'npm test'],
    ['pytest -k foo', 'test', 'pytest'],
    ['cargo build --release', 'build', 'cargo build'],
    ['npx vitest run', 'test', 'npx vitest run'],
    ['npm run lint', 'lint', 'npm run lint'],
    ['claude', 'agent', 'claude'],
    ['FOO=bar npm test', 'test', 'npm test'],
    ['git commit -m "x"', 'git', 'git commit'],
    ['npm install', 'install', 'npm install'],
    ['npm run dev', 'run', 'npm run dev'],
  ] as const)('%s → %s', (line, kind, label) => {
    expect(classifyCommand(line)).toEqual({ kind, label });
  });

  it('recognises other common tools', () => {
    expect(classifyCommand('go test ./...').kind).toBe('test');
    expect(classifyCommand('npm run typecheck').kind).toBe('lint');
    expect(classifyCommand('./node_modules/.bin/tsc -p .').kind).toBe('build');
    expect(classifyCommand('pip install -r requirements.txt').kind).toBe('install');
    expect(classifyCommand('npx @openai/codex').kind).toBe('agent');
    expect(classifyCommand('aider --model sonnet')).toEqual({ kind: 'agent', label: 'aider' });
    expect(classifyCommand('npm test && npm run build').kind).toBe('test');
    expect(classifyCommand('ls -la').kind).toBe('other');
    expect(classifyCommand('').kind).toBe('other');
  });

  it('never leaks secrets into labels', () => {
    const cases = [
      'API_KEY=sk-123 npm test',
      'export API_KEY=sk-123',
      'curl -H "Authorization: Bearer sk-123" https://api.example.com',
      'git checkout 3f2a9c1e4b5d6f7a8b9c0d1e2f3a4b5c6d7e8f90',
      'git push https://user:sk-123@github.com/acme/repo.git',
      'mysql -psk-123 prod',
      'deploy --token=sk-123',
      'heroku config:set API_KEY=sk-123',
      'echo sk-12345678901234567890123456789',
      'docker login -u me -p sk-123 registry.example.com',
    ];
    for (const line of cases) {
      const { label } = classifyCommand(line);
      expect(label, line).not.toMatch(/sk-1|3f2a9c1e4b5d|github\.com|example\.com|user:/);
      expect(safeLabel(line), line).not.toMatch(/sk-1|3f2a9c1e4b5d/);
    }
    expect(safeLabel('git checkout 3f2a9c1e4b5d6f7a')).toBe('git checkout');
  });
});

describe('classifyTask', () => {
  it('uses the task group first, then the name', () => {
    expect(classifyTask('compile everything', 'build')).toEqual({ kind: 'build', label: 'compile everything' });
    expect(classifyTask('unit', 'test').kind).toBe('test');
    expect(classifyTask('npm: lint')).toEqual({ kind: 'lint', label: 'npm: lint' });
    expect(classifyTask('a very long task name that keeps going and going').label).toHaveLength(32);
  });

  it('never keeps short bare values that could be secrets', () => {
    expect(safeLabel('npm test sk-123')).toBe('npm test');
    expect(safeLabel('deploy prod ghp_abcdef')).toBe('deploy prod');
    expect(safeLabel('make build ./out/secret')).toBe('make build');
  });

  it('recognises Claude Code started through npx', () => {
    expect(classifyCommand('npx @anthropic-ai/claude-code')).toEqual({ kind: 'agent', label: 'claude' });
    expect(classifyCommand('npx -y @anthropic-ai/claude-code@latest').kind).not.toBe('test');
  });
});
