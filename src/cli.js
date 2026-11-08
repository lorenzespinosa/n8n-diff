#!/usr/bin/env node
// Command line entry point: n8n-diff before.json after.json [options]

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { diffWorkflows } from './diff.js';
import { readWorkflow } from './reader.js';
import { renderJson, renderText } from './render.js';

// Mirrors the version in package.json.
const VERSION = '0.1.0';

const USAGE = `Usage: n8n-diff <before.json> <after.json> [options]

Compare two exported n8n workflow JSON files and print what changed.

Options:
  --format text|json   output format (default: text)
  --keep-volatile      keep fields that usually change between exports
                       (id, updatedAt, versionId, meta.instanceId, empty pinData)
  --only scope         limit the comparison to nodes, connections, or parameters
  -h, --help           show this help
  --version            show the version

Exit codes:
  0  no differences in the compared scope after normalization
  1  differences found
  2  error, for example bad arguments, an unreadable file, or invalid JSON
`;

const FORMATS = new Set(['text', 'json']);
const SCOPES = new Set(['nodes', 'connections', 'parameters']);

function fail(message) {
  throw new Error(message);
}

function nextValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined) {
    fail(`${flag} needs a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    files: [],
    format: 'text',
    keepVolatile: false,
    only: null,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--version') {
      options.version = true;
    } else if (arg === '--keep-volatile') {
      options.keepVolatile = true;
    } else if (arg === '--format' || arg.startsWith('--format=')) {
      const value = arg.startsWith('--format=')
        ? arg.slice('--format='.length)
        : nextValue(argv, i++, '--format');
      if (!FORMATS.has(value)) {
        fail(`unknown format "${value}", expected text or json`);
      }
      options.format = value;
    } else if (arg === '--only' || arg.startsWith('--only=')) {
      const value = arg.startsWith('--only=')
        ? arg.slice('--only='.length)
        : nextValue(argv, i++, '--only');
      if (!SCOPES.has(value)) {
        fail(`unknown scope "${value}", expected nodes, connections, or parameters`);
      }
      options.only = value;
    } else if (arg.startsWith('-')) {
      fail(`unknown option "${arg}"`);
    } else {
      options.files.push(arg);
    }
  }

  if (!options.help && !options.version && options.files.length !== 2) {
    fail('expected exactly two workflow files, for example: n8n-diff before.json after.json');
  }
  return options;
}

// Runs the CLI with the given argument array. Writes the report to the given
// streams, which default to process stdout and stderr. Returns the exit code.
function run(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;

  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    stderr.write(`n8n-diff: ${err.message}\n`);
    return 2;
  }

  if (options.help) {
    stdout.write(USAGE);
    return 0;
  }

  if (options.version) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }

  let before;
  let after;
  try {
    before = readWorkflow(options.files[0]);
    after = readWorkflow(options.files[1]);
  } catch (err) {
    stderr.write(`n8n-diff: ${err.message}\n`);
    return 2;
  }

  let result;
  try {
    result = diffWorkflows(before, after, {
      keepVolatile: options.keepVolatile,
      only: options.only,
    });
  } catch (err) {
    stderr.write(`n8n-diff: ${err.message}\n`);
    return 2;
  }

  stdout.write(options.format === 'json' ? renderJson(result) : renderText(result));
  return result.identical ? 0 : 1;
}

function invokedDirectly() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

// A closed pipe (for example n8n-diff ... | head) must not print a stack or
// force a wrong exit code; keep whatever code run() computed.
process.stdout?.on?.('error', (err) => {
  if (err.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw err;
});

if (invokedDirectly()) {
  process.exitCode = run(process.argv.slice(2));
}

export { run, parseArgs, USAGE };
