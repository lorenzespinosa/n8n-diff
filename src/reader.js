// Reads and validates one exported workflow file. All filesystem access for
// workflow input lives here so the CLI module stays free of path handling.

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { isPlainObject } from './normalize.js';

const utf8 = new TextDecoder('utf-8', { fatal: true });

function fail(message) {
  throw new Error(message);
}

// Normalizes one command line path and checks that it names an existing
// regular file before anything tries to read it.
function resolveWorkflowPath(file) {
  if (typeof file !== 'string' || file.length === 0 || file.includes('\0')) {
    fail('workflow path must be a non-empty string');
  }
  const resolved = resolve(file);
  let stats;
  try {
    stats = statSync(resolved);
  } catch (err) {
    fail(`cannot read ${file}: ${err.message}`);
  }
  if (!stats.isFile()) {
    fail(`${file} is not a regular file`);
  }
  return resolved;
}

function readWorkflow(file) {
  const target = resolveWorkflowPath(file);

  let raw;
  try {
    // decode strictly so invalid bytes fail instead of becoming U+FFFD
    // which could make two different files compare as identical
    raw = utf8.decode(readFileSync(target)).replace(/^\uFEFF/, '');
  } catch (err) {
    fail(`cannot read ${file}: ${err.message}`);
  }

  let workflow;
  try {
    workflow = JSON.parse(raw);
  } catch (err) {
    fail(`${file} is not valid JSON: ${err.message}`);
  }

  if (!isPlainObject(workflow)) {
    fail(`${file} must contain a workflow object`);
  }
  if (!Array.isArray(workflow.nodes)) {
    fail(`${file}: nodes must be an array (not an n8n workflow export?)`);
  }
  if (workflow.nodes.some((node) => !isPlainObject(node))) {
    fail(`${file}: every node must be an object`);
  }
  if ('connections' in workflow && !isPlainObject(workflow.connections)) {
    fail(`${file}: connections must be an object`);
  }
  return workflow;
}

export { readWorkflow };
