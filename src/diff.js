// Structural diff between two n8n workflows, computed on normalized copies.

import { normalizeWorkflow, isPlainObject } from './normalize.js';

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key, index) => key === bKeys[index] && deepEqual(a[key], b[key]));
  }
  return false;
}

function makeChange(path, kind, before, after) {
  const change = { path, kind };
  if (before !== undefined) change.before = before;
  if (after !== undefined) change.after = after;
  return change;
}

// Leaf level diff. Paths use dots for keys and [index] for array items, for
// example nodes[HTTP Request].parameters.headers.parameters[0].name.
function deepChanges(path, before, after) {
  if (deepEqual(before, after)) return [];

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    const changes = [];
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
      if (!hasBefore) {
        changes.push(makeChange(childPath, 'added', undefined, after[key]));
      } else if (!hasAfter) {
        changes.push(makeChange(childPath, 'removed', before[key], undefined));
      } else {
        changes.push(...deepChanges(childPath, before[key], after[key]));
      }
    }
    return changes;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const changes = [];
    const shared = Math.min(before.length, after.length);
    for (let i = 0; i < shared; i += 1) {
      changes.push(...deepChanges(`${path}[${i}]`, before[i], after[i]));
    }
    for (let i = shared; i < before.length; i += 1) {
      changes.push(makeChange(`${path}[${i}]`, 'removed', before[i], undefined));
    }
    for (let i = shared; i < after.length; i += 1) {
      changes.push(makeChange(`${path}[${i}]`, 'added', undefined, after[i]));
    }
    return changes;
  }

  return [makeChange(path, 'changed', before, after)];
}

function nodesByName(workflow) {
  const map = new Map();
  const seen = new Map();
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    if (!isPlainObject(node)) continue;
    const raw = typeof node.name === 'string' ? node.name : '';
    const occurrence = (seen.get(raw) ?? 0) + 1;
    seen.set(raw, occurrence);
    // duplicate names stay distinct so no node is silently dropped
    const name = occurrence === 1 ? raw : `${raw} [${occurrence}]`;
    if (!map.has(name)) map.set(name, node);
  }
  return map;
}

function duplicateNames(workflow) {
  const counts = new Map();
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    if (!isPlainObject(node)) continue;
    const raw = typeof node.name === 'string' ? node.name : '';
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name, count]) => ({ name, count }));
}

// Everything except name and position. Two nodes with the same fingerprint
// differ only by name (and possibly position), so they count as one rename.
function nodeFingerprint(node) {
  const rest = { ...node };
  delete rest.name;
  delete rest.position;
  return JSON.stringify(rest);
}

function nodeDescription(node, name) {
  return { name, type: isPlainObject(node) && node.type !== undefined ? node.type : null };
}

function flattenConnections(connections, renameMap = new Map()) {
  const edges = [];
  if (!isPlainObject(connections)) return edges;
  for (const [rawSource, byType] of Object.entries(connections)) {
    const source = renameMap.get(rawSource) ?? rawSource;
    if (!isPlainObject(byType)) continue;
    for (const [type, outputs] of Object.entries(byType)) {
      if (!Array.isArray(outputs)) continue;
      outputs.forEach((targets, outputIndex) => {
        if (!Array.isArray(targets)) return;
        targets.forEach((target, slot) => {
          if (!isPlainObject(target)) return;
          const rawTarget = typeof target.node === 'string' ? target.node : '';
          edges.push({
            source,
            type,
            outputIndex,
            // slot records order within an output; n8n runs targets in order
            slot,
            target: renameMap.get(rawTarget) ?? rawTarget,
            targetType: typeof target.type === 'string' ? target.type : type,
            targetIndex: typeof target.index === 'number' ? target.index : 0,
          });
        });
      });
    }
  }
  return edges;
}

function edgeKey(edge) {
  return JSON.stringify([
    edge.source,
    edge.type,
    edge.outputIndex,
    edge.slot,
    edge.target,
    edge.targetType,
    edge.targetIndex,
  ]);
}

function edgePath(edge) {
  return `connections[${edge.source}].${edge.type}[${edge.outputIndex}] -> ${edge.target}`;
}

function diffEdges(beforeEdges, afterEdges) {
  const count = (edges) => {
    const counts = new Map();
    for (const edge of edges) {
      const key = edgeKey(edge);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const beforeCounts = count(beforeEdges);
  const afterCounts = count(afterEdges);

  const byKey = new Map();
  for (const edge of [...beforeEdges, ...afterEdges]) {
    if (!byKey.has(edgeKey(edge))) byKey.set(edgeKey(edge), edge);
  }

  const removed = [];
  const added = [];
  for (const key of [...byKey.keys()].sort()) {
    const beforeTotal = beforeCounts.get(key) ?? 0;
    const afterTotal = afterCounts.get(key) ?? 0;
    const edge = byKey.get(key);
    if (afterTotal > beforeTotal) {
      for (let i = 0; i < afterTotal - beforeTotal; i += 1) added.push(edge);
    } else if (beforeTotal > afterTotal) {
      for (let i = 0; i < beforeTotal - afterTotal; i += 1) removed.push(edge);
    }
  }
  return { removed, added };
}

// A removed node paired with an added node whose content matches everything
// except the name counts as a rename, so it does not flood the report with an
// add plus a remove plus connection churn.
function detectRenames(beforeNodes, afterNodes) {
  const addedNames = [...afterNodes.keys()].filter((name) => !beforeNodes.has(name)).sort();
  const removedNames = [...beforeNodes.keys()].filter((name) => !afterNodes.has(name)).sort();

  const candidatesByFingerprint = new Map();
  for (const name of addedNames) {
    const fingerprint = nodeFingerprint(afterNodes.get(name));
    if (!candidatesByFingerprint.has(fingerprint)) {
      candidatesByFingerprint.set(fingerprint, []);
    }
    candidatesByFingerprint.get(fingerprint).push(name);
  }

  const renamed = [];
  const renameMap = new Map();
  const unmatchedRemoved = [];
  for (const name of removedNames) {
    const fingerprint = nodeFingerprint(beforeNodes.get(name));
    const candidates = candidatesByFingerprint.get(fingerprint);
    if (candidates && candidates.length > 0) {
      const to = candidates.shift();
      renamed.push({ from: name, to });
      renameMap.set(name, to);
    } else {
      unmatchedRemoved.push(name);
    }
  }

  const renamedTo = new Set(renamed.map((entry) => entry.to));
  return {
    renamed,
    renameMap,
    addedNames: addedNames.filter((name) => !renamedTo.has(name)),
    removedNames: unmatchedRemoved,
  };
}

function positionOf(node) {
  if (isPlainObject(node) && Array.isArray(node.position)) return node.position;
  return null;
}

const SCOPES = new Set(['nodes', 'connections', 'parameters']);

function diffWorkflows(before, after, options = {}) {
  const keepVolatile = options.keepVolatile === true;
  const only = options.only ?? null;
  if (only !== null && !SCOPES.has(only)) {
    throw new TypeError("only must be 'nodes', 'connections', or 'parameters'");
  }

  const beforeNorm = normalizeWorkflow(before, { keepVolatile });
  const afterNorm = normalizeWorkflow(after, { keepVolatile });

  const beforeNodes = nodesByName(beforeNorm);
  const afterNodes = nodesByName(afterNorm);
  const { renamed, renameMap, addedNames, removedNames } = detectRenames(beforeNodes, afterNodes);

  const positionMoves = [];
  for (const entry of renamed) {
    const from = positionOf(beforeNodes.get(entry.from));
    const to = positionOf(afterNodes.get(entry.to));
    if (!deepEqual(from, to)) {
      positionMoves.push({ node: entry.to, before: from, after: to });
    }
  }

  const parameterChanges = [];
  for (const dup of duplicateNames(beforeNorm)) {
    const afterDup = duplicateNames(afterNorm).find((entry) => entry.name === dup.name);
    if (afterDup?.count !== dup.count) {
      parameterChanges.push({
        node: dup.name,
        changes: [{
          path: `nodes[${dup.name}]`,
          kind: 'changed',
          before: `${dup.count} nodes share this name`,
          after: afterDup ? `${afterDup.count} nodes share this name` : 'no duplicates',
        }],
      });
    }
  }
  for (const name of [...beforeNodes.keys()]
    .filter((candidate) => afterNodes.has(candidate))
    .sort()) {
    const beforeNode = beforeNodes.get(name);
    const afterNode = afterNodes.get(name);

    const beforeBody = { ...beforeNode };
    const afterBody = { ...afterNode };
    delete beforeBody.name;
    delete beforeBody.position;
    delete afterBody.name;
    delete afterBody.position;

    const changes = deepChanges(`nodes[${name}]`, beforeBody, afterBody);
    if (changes.length > 0) {
      parameterChanges.push({ node: name, changes });
    }

    const from = positionOf(beforeNode);
    const to = positionOf(afterNode);
    if (!deepEqual(from, to)) {
      positionMoves.push({ node: name, before: from, after: to });
    }
  }

  const beforeConnections = isPlainObject(beforeNorm.connections) ? beforeNorm.connections : {};
  const afterConnections = isPlainObject(afterNorm.connections) ? afterNorm.connections : {};
  const edges = diffEdges(
    flattenConnections(beforeConnections, renameMap),
    flattenConnections(afterConnections)
  );
  const toChange = (kind) => (edge) => ({
    path: edgePath(edge),
    kind,
    source: edge.source,
    target: edge.target,
  });
  const connectionChanges = [
    ...edges.removed.map(toChange('removed')),
    ...edges.added.map(toChange('added')),
  ];

  const beforeTop = { ...beforeNorm };
  const afterTop = { ...afterNorm };
  delete beforeTop.nodes;
  delete beforeTop.connections;
  delete afterTop.nodes;
  delete afterTop.connections;
  const workflowChanges = deepChanges('', beforeTop, afterTop);

  let result = {
    renamed,
    addedNodes: addedNames.map((name) => nodeDescription(afterNodes.get(name), name)),
    removedNodes: removedNames.map((name) => nodeDescription(beforeNodes.get(name), name)),
    parameterChanges,
    connectionChanges,
    positionMoves,
    workflowChanges,
  };

  if (only === 'nodes') {
    result = { ...result, parameterChanges: [], connectionChanges: [], workflowChanges: [] };
  } else if (only === 'parameters') {
    result = {
      ...result,
      renamed: [],
      addedNodes: [],
      removedNodes: [],
      connectionChanges: [],
      positionMoves: [],
      workflowChanges: [],
    };
  } else if (only === 'connections') {
    result = {
      ...result,
      renamed: [],
      addedNodes: [],
      removedNodes: [],
      parameterChanges: [],
      positionMoves: [],
      workflowChanges: [],
    };
  }

  const summary = {
    addedNodes: result.addedNodes.length,
    removedNodes: result.removedNodes.length,
    renamedNodes: result.renamed.length,
    parameterChanges: result.parameterChanges.reduce(
      (total, group) => total + group.changes.length,
      0
    ),
    connectionChanges: result.connectionChanges.length,
    positionMoves: result.positionMoves.length,
    workflowChanges: result.workflowChanges.length,
  };

  return {
    identical: Object.values(summary).every((count) => count === 0),
    ...result,
    summary,
  };
}

export { diffWorkflows, deepChanges, deepEqual };
