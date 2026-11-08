import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffWorkflows } from '../src/diff.js';
import { renderText, renderJson } from '../src/render.js';
import { makeNode, makeWorkflow, singleConnection } from './helpers.js';

const before = makeWorkflow({
  nodes: [
    makeNode({ name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'orders' } }),
    makeNode({
      id: 'http-1',
      name: 'Fetch',
      type: 'n8n-nodes-base.httpRequest',
      parameters: { url: 'https://v1.example.com' },
    }),
  ],
  connections: { Webhook: singleConnection('Fetch') },
});

const after = makeWorkflow({
  nodes: [
    makeNode({ name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'orders' } }),
    makeNode({
      id: 'http-2',
      name: 'Fetch',
      type: 'n8n-nodes-base.httpRequest',
      parameters: { url: 'https://v2.example.com', retry: true },
    }),
    makeNode({ name: 'Save', type: 'n8n-nodes-base.postgres' }),
  ],
  connections: { Webhook: singleConnection('Save'), Fetch: singleConnection('Save') },
});

const changed = diffWorkflows(before, after);

test('prints a no differences message for identical workflows', () => {
  const text = renderText(diffWorkflows(makeWorkflow(), makeWorkflow()));
  assert.ok(text.includes('No differences after normalization.'), text);
  assert.ok(text.includes('Summary: identical'), text);
});

test('prints a summary line', () => {
  const text = renderText(changed);
  assert.ok(text.includes('Summary: 1 node added, 2 parameter changes, 3 connection changes'), text);
});

test('marks added nodes with a plus', () => {
  const text = renderText(changed);
  assert.ok(text.includes('+ Save (n8n-nodes-base.postgres)'), text);
});

test('marks removed nodes with a minus', () => {
  const result = diffWorkflows(
    makeWorkflow({ nodes: [makeNode({ name: 'Old', type: 'n8n-nodes-base.slack' })] }),
    makeWorkflow({ nodes: [] })
  );
  const text = renderText(result);
  assert.ok(text.includes('- Old (n8n-nodes-base.slack)'), text);
});

test('groups parameter changes under the node name', () => {
  const text = renderText(changed);
  const header = text.indexOf('Node: Fetch');
  const urlLine = text.indexOf('nodes[Fetch].parameters.url');
  assert.ok(header > -1, text);
  assert.ok(urlLine > header, text);
});

test('omits unchanged nodes', () => {
  const text = renderText(changed);
  assert.equal(text.includes('Node: Webhook'), false);
});

test('shows the old and new value for a changed parameter', () => {
  const text = renderText(changed);
  assert.ok(text.includes('- nodes[Fetch].parameters.url = "https://v1.example.com"'), text);
  assert.ok(text.includes('+ nodes[Fetch].parameters.url = "https://v2.example.com"'), text);
});

test('marks an added parameter with a single plus line', () => {
  const text = renderText(changed);
  assert.ok(text.includes('+ nodes[Fetch].parameters.retry = true'), text);
  assert.equal(text.includes('- nodes[Fetch].parameters.retry'), false);
});

test('marks a removed parameter with a single minus line', () => {
  const result = diffWorkflows(
    makeWorkflow({ nodes: [makeNode({ name: 'A', parameters: { gone: 1 } })] }),
    makeWorkflow({ nodes: [makeNode({ name: 'A', parameters: {} })] })
  );
  const text = renderText(result);
  assert.ok(text.includes('- nodes[A].parameters.gone = 1'), text);
  assert.equal(text.includes('+ nodes[A].parameters.gone'), false);
});

test('renders connection changes', () => {
  const text = renderText(changed);
  assert.ok(text.includes('Connections'), text);
  assert.ok(text.includes('- connections[Webhook].main[0] -> Fetch'), text);
  assert.ok(text.includes('+ connections[Webhook].main[0] -> Save'), text);
  assert.ok(text.includes('+ connections[Fetch].main[0] -> Save'), text);
});

test('renders position moves in their own section', () => {
  const result = diffWorkflows(
    makeWorkflow({ nodes: [makeNode({ name: 'A', position: [0, 0] })] }),
    makeWorkflow({ nodes: [makeNode({ name: 'A', position: [120, 60] })] })
  );
  const text = renderText(result);
  assert.ok(text.includes('Position moves'), text);
  assert.ok(text.includes('* A moved [0,0] -> [120,60]'), text);
  assert.equal(text.includes('parameters'), false);
});

test('renders renames', () => {
  const result = diffWorkflows(
    makeWorkflow({ nodes: [makeNode({ id: 'a', name: 'Old' })] }),
    makeWorkflow({ nodes: [makeNode({ id: 'b', name: 'New' })] })
  );
  const text = renderText(result);
  assert.ok(text.includes('Renamed nodes'), text);
  assert.ok(text.includes('* Old -> New'), text);
});

test('renders workflow level changes', () => {
  const result = diffWorkflows(makeWorkflow({ active: false }), makeWorkflow({ active: true }));
  const text = renderText(result);
  assert.ok(text.includes('Workflow'), text);
  assert.ok(text.includes('- active = false'), text);
  assert.ok(text.includes('+ active = true'), text);
});

test('json output is valid json with the expected keys', () => {
  const parsed = JSON.parse(renderJson(changed));
  assert.deepEqual(Object.keys(parsed).sort(), [
    'addedNodes',
    'connectionChanges',
    'identical',
    'parameterChanges',
    'positionMoves',
    'removedNodes',
    'renamed',
    'summary',
    'workflowChanges',
  ]);
});

test('json output marks identical workflows', () => {
  const parsed = JSON.parse(renderJson(diffWorkflows(makeWorkflow(), makeWorkflow())));
  assert.equal(parsed.identical, true);
  assert.equal(parsed.summary.parameterChanges, 0);
  assert.deepEqual(parsed.addedNodes, []);
});

test('json output carries the summary counts', () => {
  const parsed = JSON.parse(renderJson(changed));
  assert.deepEqual(parsed.summary, {
    addedNodes: 1,
    removedNodes: 0,
    renamedNodes: 0,
    parameterChanges: 2,
    connectionChanges: 3,
    positionMoves: 0,
    workflowChanges: 0,
  });
});
