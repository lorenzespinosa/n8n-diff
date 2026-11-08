import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffWorkflows } from '../src/diff.js';
import { makeNode, makeWorkflow, singleConnection } from './helpers.js';

function httpNode(overrides = {}) {
  return makeNode({
    id: 'http-1',
    name: 'HTTP Request',
    type: 'n8n-nodes-base.httpRequest',
    parameters: { url: 'https://api.example.com/v1' },
    ...overrides,
  });
}

test('reports identical workflows as identical', () => {
  const before = makeWorkflow({ nodes: [httpNode()] });
  const after = makeWorkflow({ nodes: [httpNode()] });
  const result = diffWorkflows(before, after);
  assert.equal(result.identical, true);
  assert.deepEqual(result.summary, {
    addedNodes: 0,
    removedNodes: 0,
    renamedNodes: 0,
    parameterChanges: 0,
    connectionChanges: 0,
    positionMoves: 0,
    workflowChanges: 0,
  });
});

test('ignores key order differences', () => {
  const before = { nodes: [{ name: 'A', type: 'n8n-nodes-base.noOp', parameters: { b: 2, a: 1 } }] };
  const after = { nodes: [{ parameters: { a: 1, b: 2 }, type: 'n8n-nodes-base.noOp', name: 'A' }] };
  assert.equal(diffWorkflows(before, after).identical, true);
});

test('ignores volatile field differences', () => {
  const before = makeWorkflow({
    nodes: [makeNode({ id: 'n-before', name: 'Webhook' })],
  });
  const after = makeWorkflow({
    id: 'workflow-2',
    updatedAt: '2026-06-06T00:00:00.000Z',
    versionId: 'version-2',
    meta: { instanceId: 'instance-2' },
    nodes: [makeNode({ id: 'n-after', name: 'Webhook' })],
  });
  assert.equal(diffWorkflows(before, after).identical, true);
});

test('reports volatile differences when keepVolatile is set', () => {
  const before = makeWorkflow();
  const after = makeWorkflow({ updatedAt: '2026-06-06T00:00:00.000Z', meta: { instanceId: 'instance-2' } });
  const result = diffWorkflows(before, after, { keepVolatile: true });
  assert.equal(result.identical, false);
  assert.ok(result.workflowChanges.some((change) => change.path === 'updatedAt'));
  assert.ok(result.workflowChanges.some((change) => change.path === 'meta.instanceId'));
});

test('detects an added node', () => {
  const before = makeWorkflow({ nodes: [httpNode()] });
  const after = makeWorkflow({ nodes: [httpNode(), makeNode({ name: 'Fetch', type: 'n8n-nodes-base.code' })] });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.addedNodes, [{ name: 'Fetch', type: 'n8n-nodes-base.code' }]);
  assert.equal(result.summary.addedNodes, 1);
});

test('detects a removed node', () => {
  const before = makeWorkflow({ nodes: [httpNode(), makeNode({ name: 'Old', type: 'n8n-nodes-base.slack' })] });
  const after = makeWorkflow({ nodes: [httpNode()] });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.removedNodes, [{ name: 'Old', type: 'n8n-nodes-base.slack' }]);
  assert.equal(result.summary.removedNodes, 1);
});

test('detects a renamed node with identical content', () => {
  const before = makeWorkflow({ nodes: [makeNode({ id: 'a', name: 'Old Name', parameters: { x: 1 } })] });
  const after = makeWorkflow({ nodes: [makeNode({ id: 'b', name: 'New Name', parameters: { x: 1 } })] });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.renamed, [{ from: 'Old Name', to: 'New Name' }]);
  assert.equal(result.summary.renamedNodes, 1);
});

test('does not report a rename as an add and a remove', () => {
  const before = makeWorkflow({ nodes: [makeNode({ id: 'a', name: 'Old Name' })] });
  const after = makeWorkflow({ nodes: [makeNode({ id: 'b', name: 'New Name' })] });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.addedNodes, []);
  assert.deepEqual(result.removedNodes, []);
});

test('reports a rename with a move as a rename and a position move', () => {
  const before = makeWorkflow({ nodes: [makeNode({ id: 'a', name: 'Old', position: [0, 0] })] });
  const after = makeWorkflow({ nodes: [makeNode({ id: 'b', name: 'New', position: [40, 80] })] });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.renamed, [{ from: 'Old', to: 'New' }]);
  assert.deepEqual(result.positionMoves, [{ node: 'New', before: [0, 0], after: [40, 80] }]);
  assert.deepEqual(result.parameterChanges, []);
});

test('reports position only moves without parameter changes', () => {
  const before = makeWorkflow({ nodes: [httpNode({ position: [0, 0] })] });
  const after = makeWorkflow({ nodes: [httpNode({ position: [220, 300] })] });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.positionMoves, [
    { node: 'HTTP Request', before: [0, 0], after: [220, 300] },
  ]);
  assert.deepEqual(result.parameterChanges, []);
  assert.deepEqual(result.connectionChanges, []);
  assert.equal(result.identical, false);
});

test('detects a parameter value change with path notation', () => {
  const before = makeWorkflow({ nodes: [httpNode()] });
  const after = makeWorkflow({ nodes: [httpNode({ parameters: { url: 'https://api.example.com/v2' } })] });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.parameterChanges, [
    {
      node: 'HTTP Request',
      changes: [
        {
          path: 'nodes[HTTP Request].parameters.url',
          kind: 'changed',
          before: 'https://api.example.com/v1',
          after: 'https://api.example.com/v2',
        },
      ],
    },
  ]);
});

test('detects an added parameter', () => {
  const before = makeWorkflow({ nodes: [httpNode()] });
  const after = makeWorkflow({ nodes: [httpNode({ parameters: { url: 'https://api.example.com/v1', timeout: 5000 } })] });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.parameterChanges[0].changes, [
    { path: 'nodes[HTTP Request].parameters.timeout', kind: 'added', after: 5000 },
  ]);
});

test('detects a removed parameter', () => {
  const before = makeWorkflow({ nodes: [httpNode({ parameters: { url: 'https://api.example.com/v1', retry: true } })] });
  const after = makeWorkflow({ nodes: [httpNode()] });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.parameterChanges[0].changes, [
    { path: 'nodes[HTTP Request].parameters.retry', kind: 'removed', before: true },
  ]);
});

test('builds paths through nested objects and arrays', () => {
  const before = makeWorkflow({
    nodes: [
      httpNode({
        parameters: { headers: { parameters: [{ name: 'x-token', value: 'old' }] } },
      }),
    ],
  });
  const after = makeWorkflow({
    nodes: [
      httpNode({
        parameters: { headers: { parameters: [{ name: 'x-token', value: 'new' }, { name: 'x-trace', value: 'on' }] } },
      }),
    ],
  });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.parameterChanges[0].changes, [
    {
      path: 'nodes[HTTP Request].parameters.headers.parameters[0].value',
      kind: 'changed',
      before: 'old',
      after: 'new',
    },
    {
      path: 'nodes[HTTP Request].parameters.headers.parameters[1]',
      kind: 'added',
      after: { name: 'x-trace', value: 'on' },
    },
  ]);
});

test('detects a node type change', () => {
  const before = makeWorkflow({ nodes: [makeNode({ name: 'Step', type: 'n8n-nodes-base.noOp' })] });
  const after = makeWorkflow({ nodes: [makeNode({ name: 'Step', type: 'n8n-nodes-base.code' })] });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.parameterChanges[0].changes, [
    {
      path: 'nodes[Step].type',
      kind: 'changed',
      before: 'n8n-nodes-base.noOp',
      after: 'n8n-nodes-base.code',
    },
  ]);
});

test('detects a typeVersion change', () => {
  const before = makeWorkflow({ nodes: [httpNode({ typeVersion: 4.1 })] });
  const after = makeWorkflow({ nodes: [httpNode({ typeVersion: 4.2 })] });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.parameterChanges[0].changes, [
    { path: 'nodes[HTTP Request].typeVersion', kind: 'changed', before: 4.1, after: 4.2 },
  ]);
});

test('detects a credentials change', () => {
  const before = makeWorkflow({
    nodes: [httpNode({ credentials: { httpHeaderAuth: { id: 'c1', name: 'Header Auth' } } })],
  });
  const after = makeWorkflow({
    nodes: [httpNode({ credentials: { httpHeaderAuth: { id: 'c2', name: 'Header Auth' } } })],
  });
  const result = diffWorkflows(before, after);
  assert.ok(
    result.parameterChanges[0].changes.some(
      (change) =>
        change.path === 'nodes[HTTP Request].credentials.httpHeaderAuth.id' &&
        change.kind === 'changed' &&
        change.before === 'c1' &&
        change.after === 'c2'
    )
  );
});

test('detects an added connection', () => {
  const before = makeWorkflow({ nodes: [makeNode({ name: 'Webhook' }), makeNode({ name: 'Fetch' })] });
  const after = makeWorkflow({
    nodes: before.nodes,
    connections: { Webhook: singleConnection('Fetch') },
  });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.connectionChanges, [
    { path: 'connections[Webhook].main[0] -> Fetch', kind: 'added', source: 'Webhook', target: 'Fetch' },
  ]);
});

test('detects a removed connection', () => {
  const before = makeWorkflow({
    nodes: [makeNode({ name: 'Webhook' }), makeNode({ name: 'Fetch' })],
    connections: { Webhook: singleConnection('Fetch') },
  });
  const after = makeWorkflow({ nodes: before.nodes });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.connectionChanges, [
    { path: 'connections[Webhook].main[0] -> Fetch', kind: 'removed', source: 'Webhook', target: 'Fetch' },
  ]);
});

test('reports rewiring as a remove and an add', () => {
  const before = makeWorkflow({
    nodes: [makeNode({ name: 'Webhook' }), makeNode({ name: 'A' }), makeNode({ name: 'B' })],
    connections: { Webhook: singleConnection('A') },
  });
  const after = makeWorkflow({
    nodes: before.nodes,
    connections: { Webhook: singleConnection('B') },
  });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.connectionChanges, [
    { path: 'connections[Webhook].main[0] -> A', kind: 'removed', source: 'Webhook', target: 'A' },
    { path: 'connections[Webhook].main[0] -> B', kind: 'added', source: 'Webhook', target: 'B' },
  ]);
});

test('detects an output index change', () => {
  const before = makeWorkflow({
    nodes: [makeNode({ name: 'Route' }), makeNode({ name: 'Go' })],
    connections: { Route: { main: [[{ node: 'Go', type: 'main', index: 0 }]] } },
  });
  const after = makeWorkflow({
    nodes: before.nodes,
    connections: { Route: { main: [[], [{ node: 'Go', type: 'main', index: 0 }]] } },
  });
  const result = diffWorkflows(before, after);
  assert.deepEqual(
    result.connectionChanges.map((change) => change.path).sort(),
    ['connections[Route].main[0] -> Go', 'connections[Route].main[1] -> Go']
  );
  assert.equal(result.summary.connectionChanges, 2);
});

test('supports multiple outputs', () => {
  const before = makeWorkflow({
    nodes: [makeNode({ name: 'Route' }), makeNode({ name: 'A' }), makeNode({ name: 'B' })],
    connections: {
      Route: { main: [[{ node: 'A', type: 'main', index: 0 }], [{ node: 'B', type: 'main', index: 0 }]] },
    },
  });
  const after = makeWorkflow({
    nodes: before.nodes,
    connections: {
      Route: { main: [[{ node: 'A', type: 'main', index: 0 }], [{ node: 'C', type: 'main', index: 0 }]] },
    },
  });
  const result = diffWorkflows(before, after);
  assert.deepEqual(
    result.connectionChanges.map((change) => change.path),
    ['connections[Route].main[1] -> B', 'connections[Route].main[1] -> C']
  );
});

test('does not report connection churn for renamed nodes', () => {
  const before = makeWorkflow({
    nodes: [makeNode({ id: 'a', name: 'Old', type: 'n8n-nodes-base.webhook' }), makeNode({ name: 'Save' })],
    connections: { Old: singleConnection('Save') },
  });
  const after = makeWorkflow({
    nodes: [makeNode({ id: 'b', name: 'New', type: 'n8n-nodes-base.webhook' }), makeNode({ name: 'Save' })],
    connections: { New: singleConnection('Save') },
  });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.renamed, [{ from: 'Old', to: 'New' }]);
  assert.deepEqual(result.connectionChanges, []);
});

test('reports workflow level changes', () => {
  const before = makeWorkflow({ active: false });
  const after = makeWorkflow({ active: true });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.workflowChanges, [
    { path: 'active', kind: 'changed', before: false, after: true },
  ]);
});

test('reports workflow name changes', () => {
  const before = makeWorkflow({ name: 'Before name' });
  const after = makeWorkflow({ name: 'After name' });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.workflowChanges, [
    { path: 'name', kind: 'changed', before: 'Before name', after: 'After name' },
  ]);
});

test('ignores node array order differences', () => {
  const before = makeWorkflow({ nodes: [makeNode({ name: 'A' }), makeNode({ name: 'B' })] });
  const after = makeWorkflow({ nodes: [makeNode({ name: 'B' }), makeNode({ name: 'A' })] });
  assert.equal(diffWorkflows(before, after).identical, true);
});

test('counts every section in the summary', () => {
  const before = makeWorkflow({
    nodes: [
      httpNode(),
      makeNode({ name: 'Old', type: 'n8n-nodes-base.slack' }),
      makeNode({ name: 'Stable' }),
    ],
    connections: { Stable: singleConnection('HTTP Request') },
  });
  const after = makeWorkflow({
    nodes: [
      httpNode({ parameters: { url: 'https://api.example.com/v2' } }),
      makeNode({ name: 'Stable' }),
      makeNode({ name: 'Fresh', type: 'n8n-nodes-base.code' }),
    ],
    connections: { Stable: singleConnection('Fresh') },
  });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.summary, {
    addedNodes: 1,
    removedNodes: 1,
    renamedNodes: 0,
    parameterChanges: 1,
    connectionChanges: 2,
    positionMoves: 0,
    workflowChanges: 0,
  });
});

test('filters the report to nodes only', () => {
  const before = makeWorkflow({
    nodes: [httpNode({ position: [0, 0] }), makeNode({ name: 'Stable' })],
    connections: { Stable: singleConnection('HTTP Request') },
  });
  const after = makeWorkflow({
    nodes: [httpNode({ position: [40, 40], parameters: { url: 'https://api.example.com/v2' } }), makeNode({ name: 'Stable' }), makeNode({ name: 'Fresh' })],
    connections: { Stable: singleConnection('Fresh') },
  });
  const result = diffWorkflows(before, after, { only: 'nodes' });
  assert.deepEqual(result.addedNodes.map((node) => node.name), ['Fresh']);
  assert.deepEqual(result.positionMoves.map((move) => move.node), ['HTTP Request']);
  assert.deepEqual(result.parameterChanges, []);
  assert.deepEqual(result.connectionChanges, []);
  assert.deepEqual(result.workflowChanges, []);
});

test('filters the report to parameters only', () => {
  const before = makeWorkflow({
    nodes: [httpNode(), makeNode({ name: 'Stable' })],
    connections: { Stable: singleConnection('HTTP Request') },
  });
  const after = makeWorkflow({
    nodes: [httpNode({ parameters: { url: 'https://api.example.com/v2' } }), makeNode({ name: 'Stable' }), makeNode({ name: 'Fresh' })],
    connections: { Stable: singleConnection('Fresh') },
  });
  const result = diffWorkflows(before, after, { only: 'parameters' });
  assert.deepEqual(result.parameterChanges[0].changes, [
    {
      path: 'nodes[HTTP Request].parameters.url',
      kind: 'changed',
      before: 'https://api.example.com/v1',
      after: 'https://api.example.com/v2',
    },
  ]);
  assert.deepEqual(result.addedNodes, []);
  assert.deepEqual(result.connectionChanges, []);
});

test('filters the report to connections only', () => {
  const before = makeWorkflow({
    nodes: [httpNode(), makeNode({ name: 'Stable' })],
    connections: { Stable: singleConnection('HTTP Request') },
  });
  const after = makeWorkflow({
    nodes: [httpNode({ parameters: { url: 'https://api.example.com/v2' } }), makeNode({ name: 'Stable' }), makeNode({ name: 'Fresh' })],
    connections: { Stable: singleConnection('Fresh') },
  });
  const result = diffWorkflows(before, after, { only: 'connections' });
  assert.equal(result.connectionChanges.length, 2);
  assert.deepEqual(result.parameterChanges, []);
  assert.deepEqual(result.addedNodes, []);
});

test('treats out of scope changes as identical with only parameters', () => {
  const before = makeWorkflow({ nodes: [makeNode({ name: 'A' })] });
  const after = makeWorkflow({ nodes: [makeNode({ name: 'A' }), makeNode({ name: 'B' })] });
  const result = diffWorkflows(before, after, { only: 'parameters' });
  assert.equal(result.identical, true);
});

test('reports a rename plus an edit as a remove and an add', () => {
  const before = makeWorkflow({ nodes: [makeNode({ id: 'a', name: 'Old', parameters: { x: 1 } })] });
  const after = makeWorkflow({ nodes: [makeNode({ id: 'b', name: 'New', parameters: { x: 2 } })] });
  const result = diffWorkflows(before, after);
  assert.deepEqual(result.renamed, []);
  assert.deepEqual(result.removedNodes, [{ name: 'Old', type: 'n8n-nodes-base.noOp' }]);
  assert.deepEqual(result.addedNodes, [{ name: 'New', type: 'n8n-nodes-base.noOp' }]);
});

test('rejects an invalid only value', () => {
  const before = makeWorkflow();
  const after = makeWorkflow();
  assert.throws(
    () => diffWorkflows(before, after, { only: 'settings' }),
    /only must be 'nodes', 'connections', or 'parameters'/
  );
});
