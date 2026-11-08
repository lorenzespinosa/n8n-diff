import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkflow, canonicalJson, workflowsEqual } from '../src/normalize.js';
import { makeNode, makeWorkflow } from './helpers.js';

test('drops the workflow id by default', () => {
  const normalized = normalizeWorkflow(makeWorkflow());
  assert.equal('id' in normalized, false);
});

test('drops updatedAt by default', () => {
  const normalized = normalizeWorkflow(makeWorkflow());
  assert.equal('updatedAt' in normalized, false);
});

test('drops versionId by default', () => {
  const normalized = normalizeWorkflow(makeWorkflow());
  assert.equal('versionId' in normalized, false);
});

test('drops meta.instanceId but keeps other meta fields', () => {
  const normalized = normalizeWorkflow(makeWorkflow({ meta: { instanceId: 'i-1', templateId: 't-9' } }));
  assert.deepEqual(normalized.meta, { templateId: 't-9' });
});

test('drops meta entirely when instanceId was the only field', () => {
  const normalized = normalizeWorkflow(makeWorkflow());
  assert.equal('meta' in normalized, false);
});

test('drops empty pinData by default', () => {
  const normalized = normalizeWorkflow(makeWorkflow({ pinData: {} }));
  assert.equal('pinData' in normalized, false);
});

test('keeps pinData when it has content', () => {
  const normalized = normalizeWorkflow(makeWorkflow({ pinData: { Webhook: [{ json: { ok: true } }] } }));
  assert.deepEqual(normalized.pinData, { Webhook: [{ json: { ok: true } }] });
});

test('drops node level ids by default', () => {
  const normalized = normalizeWorkflow({
    nodes: [makeNode({ id: 'secret-uuid', name: 'Webhook' })],
  });
  assert.equal('id' in normalized.nodes[0], false);
});

test('keeps volatile fields when keepVolatile is set', () => {
  const workflow = makeWorkflow({
    id: 'workflow-9',
    updatedAt: '2026-02-02T00:00:00.000Z',
    versionId: 'version-9',
    meta: { instanceId: 'instance-9' },
    nodes: [makeNode({ id: 'node-9', name: 'Webhook' })],
  });
  const normalized = normalizeWorkflow(workflow, { keepVolatile: true });
  assert.equal(normalized.id, 'workflow-9');
  assert.equal(normalized.updatedAt, '2026-02-02T00:00:00.000Z');
  assert.equal(normalized.versionId, 'version-9');
  assert.deepEqual(normalized.meta, { instanceId: 'instance-9' });
  assert.deepEqual(normalized.pinData, {});
  assert.equal(normalized.nodes[0].id, 'node-9');
});

test('sorts nodes by name', () => {
  const normalized = normalizeWorkflow({
    nodes: [
      makeNode({ id: 'z', name: 'Zulu' }),
      makeNode({ id: 'a', name: 'Alpha' }),
      makeNode({ id: 'm', name: 'Mike' }),
    ],
  });
  assert.deepEqual(
    normalized.nodes.map((node) => node.name),
    ['Alpha', 'Mike', 'Zulu']
  );
});

test('sorts object keys recursively', () => {
  const normalized = normalizeWorkflow({
    nodes: [makeNode({ name: 'A', parameters: { zeta: 1, alpha: { two: 2, one: 1 } } })],
  });
  assert.deepEqual(Object.keys(normalized.nodes[0].parameters), ['alpha', 'zeta']);
  assert.deepEqual(Object.keys(normalized.nodes[0].parameters.alpha), ['one', 'two']);
});

test('sorts connection keys', () => {
  const normalized = normalizeWorkflow({
    connections: {
      Zulu: {},
      Alpha: {},
    },
  });
  assert.deepEqual(Object.keys(normalized.connections), ['Alpha', 'Zulu']);
});

test('treats different key orders as equal', () => {
  const before = { nodes: [{ name: 'A', type: 'n8n-nodes-base.noOp', parameters: { b: 2, a: 1 } }] };
  const after = { nodes: [{ parameters: { a: 1, b: 2 }, type: 'n8n-nodes-base.noOp', name: 'A' }] };
  assert.equal(canonicalJson(before), canonicalJson(after));
});

test('treats different node order as equal', () => {
  const before = { nodes: [makeNode({ name: 'A' }), makeNode({ name: 'B' })] };
  const after = { nodes: [makeNode({ name: 'B' }), makeNode({ name: 'A' })] };
  assert.equal(canonicalJson(before), canonicalJson(after));
});

test('does not mutate the input workflow', () => {
  const input = makeWorkflow({
    meta: { instanceId: 'i-1', templateId: 'keep' },
    nodes: [makeNode({ id: 'n-1', name: 'B', parameters: { b: 2, a: 1 } }), makeNode({ id: 'n-2', name: 'A' })],
  });
  const snapshot = JSON.parse(JSON.stringify(input));
  normalizeWorkflow(input);
  assert.deepEqual(input, snapshot);
});

test('handles a workflow without nodes', () => {
  const normalized = normalizeWorkflow({ name: 'Empty' });
  assert.equal('nodes' in normalized, false);
  assert.equal(normalized.name, 'Empty');
});

test('handles a workflow with only a name', () => {
  const normalized = normalizeWorkflow({ name: 'Tiny' });
  assert.deepEqual(normalized, { name: 'Tiny' });
});

test('throws for non object input', () => {
  assert.throws(() => normalizeWorkflow(null), /workflow must be an object/);
  assert.throws(() => normalizeWorkflow('nope'), /workflow must be an object/);
});

test('workflowsEqual ignores volatile differences', () => {
  const before = makeWorkflow();
  const after = makeWorkflow({
    id: 'workflow-2',
    updatedAt: '2026-03-03T00:00:00.000Z',
    versionId: 'version-2',
    meta: { instanceId: 'instance-2' },
  });
  assert.equal(workflowsEqual(before, after), true);
});

test('workflowsEqual detects real differences', () => {
  const before = makeWorkflow({ nodes: [makeNode({ name: 'A' })] });
  const after = makeWorkflow({ nodes: [makeNode({ name: 'A', type: 'n8n-nodes-base.httpRequest' })] });
  assert.equal(workflowsEqual(before, after), false);
});
