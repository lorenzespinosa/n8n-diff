// Canonical form for n8n workflow exports.
// Two exports of the same workflow normalize to the same value even when the
// key order differs or the usual bookkeeping fields changed between exports.

const WORKFLOW_VOLATILE_KEYS = ['id', 'updatedAt', 'versionId'];
const NODE_VOLATILE_KEYS = ['id'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (isPlainObject(value)) {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      // defineProperty keeps keys like __proto__ as ordinary data
      Object.defineProperty(sorted, key, {
        value: sortKeysDeep(value[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return sorted;
  }
  return value;
}

function withoutKeys(object, keys) {
  const copy = { ...object };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

function dropVolatileFields(workflow) {
  let cleaned = withoutKeys(workflow, WORKFLOW_VOLATILE_KEYS);

  if (isPlainObject(cleaned.meta)) {
    const meta = withoutKeys(cleaned.meta, ['instanceId']);
    if (Object.keys(meta).length > 0) {
      cleaned = { ...cleaned, meta };
    } else {
      cleaned = withoutKeys(cleaned, ['meta']);
    }
  }

  if (isPlainObject(cleaned.pinData) && Object.keys(cleaned.pinData).length === 0) {
    cleaned = withoutKeys(cleaned, ['pinData']);
  }

  if (Array.isArray(cleaned.nodes)) {
    cleaned.nodes = cleaned.nodes.map((node) =>
      isPlainObject(node) ? withoutKeys(node, NODE_VOLATILE_KEYS) : node
    );
  }

  return cleaned;
}

function nodeName(node) {
  if (isPlainObject(node) && typeof node.name === 'string') {
    return node.name;
  }
  return '';
}

function sortNodesByName(nodes) {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const left = nodeName(a.node);
      const right = nodeName(b.node);
      if (left < right) return -1;
      if (left > right) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.node);
}

// Returns a canonical copy of the workflow: volatile fields dropped unless
// keepVolatile is set, all object keys sorted, nodes sorted by name.
function normalizeWorkflow(workflow, options = {}) {
  if (!isPlainObject(workflow)) {
    throw new TypeError('workflow must be an object');
  }
  const base = options.keepVolatile ? workflow : dropVolatileFields(workflow);
  const normalized = sortKeysDeep(base);
  if (Array.isArray(normalized.nodes)) {
    normalized.nodes = sortNodesByName(normalized.nodes);
  }
  return normalized;
}

function canonicalJson(workflow, options = {}) {
  return JSON.stringify(normalizeWorkflow(workflow, options));
}

function workflowsEqual(before, after, options = {}) {
  return canonicalJson(before, options) === canonicalJson(after, options);
}

export { normalizeWorkflow, canonicalJson, workflowsEqual, isPlainObject };
