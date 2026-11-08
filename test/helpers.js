// Shared fixture builders for the test suite.

function makeNode(overrides = {}) {
  return {
    id: 'node-1',
    name: 'Do Something',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [0, 0],
    parameters: {},
    ...overrides,
  };
}

function makeWorkflow(overrides = {}) {
  return {
    id: 'workflow-1',
    name: 'Test workflow',
    nodes: [],
    connections: {},
    settings: {},
    pinData: {},
    active: false,
    meta: { instanceId: 'instance-1' },
    versionId: 'version-1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function singleConnection(target) {
  return { main: [[{ node: target, type: 'main', index: 0 }]] };
}

export { makeNode, makeWorkflow, singleConnection };
