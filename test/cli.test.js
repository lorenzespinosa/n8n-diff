import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { makeNode, makeWorkflow } from './helpers.js';

let tempDir;

function fixture(name, value) {
  if (!tempDir) {
    tempDir = mkdtempSync(join(tmpdir(), 'n8n-diff-test-'));
  }
  const file = join(tempDir, name);
  writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function capture() {
  const out = [];
  const err = [];
  return {
    io: {
      stdout: { write: (chunk) => out.push(chunk) },
      stderr: { write: (chunk) => err.push(chunk) },
    },
    get stdout() {
      return out.join('');
    },
    get stderr() {
      return err.join('');
    },
  };
}

after(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('exits 0 for workflows that differ only in volatile fields', () => {
  const before = fixture('before.json', makeWorkflow({ nodes: [makeNode({ name: 'A' })] }));
  const after = fixture('after.json', makeWorkflow({
    id: 'workflow-2',
    updatedAt: '2026-05-05T00:00:00.000Z',
    nodes: [makeNode({ id: 'node-2', name: 'A' })],
  }));
  const captured = capture();
  const code = run([before, after], captured.io);
  assert.equal(code, 0);
  assert.ok(captured.stdout.includes('No differences after normalization.'), captured.stdout);
});

test('exits 1 when there are differences', () => {
  const before = fixture('b1.json', makeWorkflow({ nodes: [makeNode({ name: 'A', parameters: { x: 1 } })] }));
  const after = fixture('a1.json', makeWorkflow({ nodes: [makeNode({ name: 'A', parameters: { x: 2 } })] }));
  const captured = capture();
  const code = run([before, after], captured.io);
  assert.equal(code, 1);
  assert.ok(captured.stdout.includes('nodes[A].parameters.x'), captured.stdout);
});

test('exits 2 when a file argument is missing', () => {
  const captured = capture();
  const code = run(['only-one.json'], captured.io);
  assert.equal(code, 2);
  assert.ok(captured.stderr.includes('expected exactly two workflow files'), captured.stderr);
});

test('exits 2 for an unknown option', () => {
  const captured = capture();
  const code = run(['x.json', 'y.json', '--frozen'], captured.io);
  assert.equal(code, 2);
  assert.ok(captured.stderr.includes('unknown option'), captured.stderr);
});

test('exits 2 when a file does not exist', () => {
  const missing = join(tmpdir(), 'n8n-diff-definitely-missing.json');
  const captured = capture();
  const code = run([missing, missing], captured.io);
  assert.equal(code, 2);
  assert.ok(captured.stderr.includes('cannot read'), captured.stderr);
});

test('exits 2 for invalid json', () => {
  const bad = fixture('bad.json', '{ oops this is not json');
  const good = fixture('good.json', makeWorkflow());
  const captured = capture();
  const code = run([bad, good], captured.io);
  assert.equal(code, 2);
  assert.ok(captured.stderr.includes('not valid JSON'), captured.stderr);
});

test('exits 2 for an invalid format value', () => {
  const before = fixture('b2.json', makeWorkflow());
  const after = fixture('a2.json', makeWorkflow());
  const captured = capture();
  const code = run([before, after, '--format', 'xml'], captured.io);
  assert.equal(code, 2);
  assert.ok(captured.stderr.includes('unknown format'), captured.stderr);
});

test('exits 2 for an invalid only value', () => {
  const before = fixture('b3.json', makeWorkflow());
  const after = fixture('a3.json', makeWorkflow());
  const captured = capture();
  const code = run([before, after, '--only', 'settings'], captured.io);
  assert.equal(code, 2);
  assert.ok(captured.stderr.includes('unknown scope'), captured.stderr);
});

test('exits 2 when nodes is not an array', () => {
  const bad = fixture('bad-nodes.json', { nodes: 'nope' });
  const good = fixture('good2.json', makeWorkflow());
  const captured = capture();
  const code = run([bad, good], captured.io);
  assert.equal(code, 2);
  assert.ok(captured.stderr.includes('nodes must be an array'), captured.stderr);
});

test('prints json output with --format json', () => {
  const before = fixture('b4.json', makeWorkflow({ nodes: [makeNode({ name: 'A', parameters: { x: 1 } })] }));
  const after = fixture('a4.json', makeWorkflow({ nodes: [makeNode({ name: 'A', parameters: { x: 2 } })] }));
  const captured = capture();
  const code = run([before, after, '--format', 'json'], captured.io);
  assert.equal(code, 1);
  const parsed = JSON.parse(captured.stdout);
  assert.equal(parsed.identical, false);
  assert.equal(parsed.summary.parameterChanges, 1);
});

test('accepts the equals sign form of --format', () => {
  const before = fixture('b5.json', makeWorkflow());
  const after = fixture('a5.json', makeWorkflow());
  const captured = capture();
  const code = run([before, after, '--format=json'], captured.io);
  assert.equal(code, 0);
  assert.equal(captured.stdout.trim().startsWith('{'), true);
});

test('compares volatile fields when --keep-volatile is set', () => {
  const before = fixture('b6.json', makeWorkflow());
  const after = fixture('a6.json', makeWorkflow({ updatedAt: '2026-07-07T00:00:00.000Z' }));

  const plain = capture();
  assert.equal(run([before, after], plain.io), 0);

  const strict = capture();
  const code = run([before, after, '--keep-volatile'], strict.io);
  assert.equal(code, 1);
  assert.ok(strict.stdout.includes('updatedAt'), strict.stdout);
});

test('narrows the report with --only parameters', () => {
  const before = fixture('b7.json', makeWorkflow({ nodes: [makeNode({ name: 'A', parameters: { x: 1 } })] }));
  const after = fixture('a7.json', makeWorkflow({
    nodes: [makeNode({ name: 'A', parameters: { x: 2 } }), makeNode({ name: 'B' })],
  }));
  const captured = capture();
  const code = run([before, after, '--only', 'parameters'], captured.io);
  assert.equal(code, 1);
  assert.ok(captured.stdout.includes('nodes[A].parameters.x'), captured.stdout);
  assert.equal(captured.stdout.includes('Added nodes'), false);
  assert.ok(captured.stdout.includes('Summary: 1 parameter change'), captured.stdout);
});

test('prints usage for --help and exits 0', () => {
  const captured = capture();
  const code = run(['--help'], captured.io);
  assert.equal(code, 0);
  assert.ok(captured.stdout.includes('Usage: n8n-diff'), captured.stdout);
  assert.ok(captured.stdout.includes('--keep-volatile'), captured.stdout);
});

test('prints the version for --version and exits 0', () => {
  const captured = capture();
  const code = run(['--version'], captured.io);
  assert.equal(code, 0);
  assert.match(captured.stdout, /^\d+\.\d+\.\d+\n$/);
});
