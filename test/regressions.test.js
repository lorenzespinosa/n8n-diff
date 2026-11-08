// Regression tests for review findings: prototype keys, duplicate node names,
// connection order, non-workflow input, byte-level file handling.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeWorkflow, workflowsEqual } from '../src/normalize.js';
import { diffWorkflows } from '../src/diff.js';
import { readWorkflow } from '../src/reader.js';
import { makeNode, makeWorkflow } from './helpers.js';

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function tmpFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'n8n-diff-regress-'));
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

// __proto__ in a literal would set the prototype instead of creating a key,
// so build these objects with defineProperty, the way a JSON parse would.
function withProtoKey(value) {
  const params = { visible: 1 };
  Object.defineProperty(params, '__proto__', {
    value, enumerable: true, writable: true, configurable: true,
  });
  return params;
}

test('__proto__ as a data key survives normalization', () => {
  const before = makeWorkflow({ parameters: withProtoKey('a') });
  const after = makeWorkflow({ parameters: withProtoKey('a') });
  after.parameters.visible = 2;
  before.parameters.visible = 2;
  assert.ok(workflowsEqual(before, after));
  const norm = normalizeWorkflow(before);
  assert.equal(Object.keys(norm.parameters).includes('__proto__'), true);
  assert.equal(norm.parameters.__proto__, 'a');
});

test('__proto__ value change is reported', () => {
  const before = makeWorkflow({ parameters: withProtoKey('a') });
  const after = makeWorkflow({ parameters: withProtoKey('b') });
  assert.equal(diffWorkflows(before, after).identical, false);
});

test('duplicate node names are not silently dropped', () => {
  const before = makeWorkflow({ nodes: [makeNode({ name: 'Twin', id: 'a' }), makeNode({ name: 'Twin', id: 'b', parameters: { x: 1 } })] });
  const after = makeWorkflow({ nodes: [makeNode({ name: 'Twin', id: 'a' })] });
  const result = diffWorkflows(before, after);
  assert.ok(result.parameterChanges.some((entry) => entry.node.includes('Twin')));
});

test('duplicate node count changes are surfaced', () => {
  const before = makeWorkflow({ nodes: [makeNode({ name: 'Twin', id: 'a' }), makeNode({ name: 'Twin', id: 'b' })] });
  const after = makeWorkflow({ nodes: [makeNode({ name: 'Twin', id: 'a' }), makeNode({ name: 'Twin', id: 'b' }), makeNode({ name: 'Twin', id: 'c' })] });
  const result = diffWorkflows(before, after);
  assert.ok(result.parameterChanges.some((entry) => entry.node === 'Twin' && entry.changes[0].before.includes('2 nodes')));
});

function withConnection(source, targets) {
  return makeWorkflow({
    nodes: [makeNode({ name: source }), ...targets.map((t) => makeNode({ name: t }))],
    connections: { [source]: { main: [targets.map((t) => ({ node: t, type: 'main', index: 0 }))] } },
  });
}

test('connection order within an output is a difference', () => {
  const before = withConnection('Start', ['A', 'B']);
  const after = withConnection('Start', ['B', 'A']);
  assert.equal(diffWorkflows(before, after).identical, false);
});

test('same order different targets is also a difference', () => {
  const before = withConnection('Start', ['A', 'B']);
  const after = withConnection('Start', ['A', 'C']);
  assert.equal(diffWorkflows(before, after).identical, false);
});

test('reader rejects valid JSON that is not a workflow', () => {
  const file = tmpFile('not-a-workflow.json', JSON.stringify({ name: 'pkg', version: '1.0.0' }));
  assert.throws(() => readWorkflow(file), /nodes must be an array/);
});

test('reader rejects non-object nodes', () => {
  const file = tmpFile('bad-nodes.json', JSON.stringify({ nodes: ['nope'] }));
  assert.throws(() => readWorkflow(file), /every node must be an object/);
});

test('reader strips a UTF-8 BOM', () => {
  const workflow = makeWorkflow();
  const file = tmpFile('bom.json', `\uFEFF${JSON.stringify(workflow)}`);
  const parsed = readWorkflow(file);
  assert.equal(Array.isArray(parsed.nodes), true);
});

test('reader rejects invalid UTF-8 bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'n8n-diff-regress-'));
  const file = join(dir, 'bad-utf8.json');
  writeFileSync(file, Buffer.concat([Buffer.from('{"nodes":'), Buffer.from([0xff, 0xfe, 0x00]), Buffer.from(']}')]));
  assert.throws(() => readWorkflow(file), /cannot read/);
});
