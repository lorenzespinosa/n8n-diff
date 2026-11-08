# n8n-diff

Compare two exported n8n workflow JSON files and see what actually changed.

An n8n export carries a lot of noise: instance ids, version stamps, updatedAt
values, node ids, and key order that shifts between exports. n8n-diff
normalizes both files first, so the report shows real edits instead of export
churn. It is built for people reviewing workflow changes: a pull request that
touches a workflow export, a backup compared against the live version, or two
branches of the same automation.

## Install

Requires Node 18 or newer.

```sh
npm install -g n8n-diff
```

Or run it straight from a checkout:

```sh
node src/cli.js before.json after.json
```

## Usage

```sh
n8n-diff <before.json> <after.json> [--format text|json] [--keep-volatile] [--only nodes|connections|parameters]
```

### Example

Take two exports of the same workflow. The second one moves the Webhook node
on the canvas, points Create order at a v2 endpoint with a timeout, replaces
the Slack alert with a Code node, rewires the connection, and activates the
workflow. It also carries new version stamps and node ids, which is just
export noise.

`before.json`:

```json
{
  "id": "w-101",
  "name": "Order sync",
  "nodes": [
    { "parameters": { "httpMethod": "POST", "path": "orders" }, "id": "n-1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [-160, 0] },
    { "parameters": { "url": "https://api.example.com/v1/orders", "options": {} }, "id": "n-2", "name": "Create order", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [240, 0] },
    { "parameters": { "text": "Order created" }, "id": "n-3", "name": "Slack alert", "type": "n8n-nodes-base.slack", "typeVersion": 2.1, "position": [640, 0] }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Create order", "type": "main", "index": 0 }]] },
    "Create order": { "main": [[{ "node": "Slack alert", "type": "main", "index": 0 }]] }
  },
  "pinData": {},
  "active": false,
  "settings": {},
  "versionId": "v-12",
  "meta": { "instanceId": "inst-1" },
  "updatedAt": "2026-01-06T09:00:00.000Z"
}
```

`after.json`:

```json
{
  "id": "w-101",
  "name": "Order sync",
  "nodes": [
    { "parameters": { "httpMethod": "POST", "path": "orders" }, "id": "n-9", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [-200, 0] },
    { "parameters": { "url": "https://api.example.com/v2/orders", "options": { "timeout": 5000 } }, "id": "n-8", "name": "Create order", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [240, 0] },
    { "parameters": { "jsCode": "return [];" }, "id": "n-7", "name": "Log failure", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [640, 0] }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Create order", "type": "main", "index": 0 }]] },
    "Create order": { "main": [[{ "node": "Log failure", "type": "main", "index": 0 }]] }
  },
  "pinData": {},
  "active": true,
  "settings": {},
  "versionId": "v-13",
  "meta": { "instanceId": "inst-1" },
  "updatedAt": "2026-01-08T14:30:00.000Z"
}
```

Run:

```sh
n8n-diff before.json after.json
```

Output:

```text
Added nodes
  + Log failure (n8n-nodes-base.code)

Removed nodes
  - Slack alert (n8n-nodes-base.slack)

Node: Create order
  + nodes[Create order].parameters.options.timeout = 5000
  - nodes[Create order].parameters.url = "https://api.example.com/v1/orders"
  + nodes[Create order].parameters.url = "https://api.example.com/v2/orders"

Connections
  - connections[Create order].main[0] -> Slack alert
  + connections[Create order].main[0] -> Log failure

Position moves
  * Webhook moved [-160,0] -> [-200,0]

Workflow
  - active = false
  + active = true

Summary: 1 node added, 1 node removed, 2 parameter changes, 2 connection changes, 1 position move, 1 workflow change
```

When both files normalize to the same workflow:

```text
No differences after normalization.

Summary: identical
```

With `--format json` the same report comes back as one JSON object with
`identical`, `renamed`, `addedNodes`, `removedNodes`, `parameterChanges`,
`connectionChanges`, `positionMoves`, `workflowChanges`, and `summary` fields,
which is handy for scripts and editor integrations.

## What gets normalized

By default the comparison drops fields that usually change between exports
even when the workflow itself did not change:

- `id` at workflow and node level
- `updatedAt`
- `versionId`
- `meta.instanceId`
- `pinData` when it is empty

Object keys are sorted recursively and nodes are sorted by name, so key order
and node order in the export never count as a change. Pass `--keep-volatile`
to compare the files exactly as exported.

## How changes are reported

- Added and removed nodes, with node type.
- Renamed nodes: a removed node paired with an added node whose content
  matches everything except the name counts as one rename, and connections
  follow the rename instead of showing churn. A rename plus an edit no longer
  matches that rule, so it shows up as a remove and an add instead.
- Parameter and property changes grouped by node with full paths, for example
  `nodes[HTTP Request].parameters.url` or
  `nodes[HTTP Request].parameters.headers.parameters[0].name`. Node level
  fields such as `type`, `typeVersion`, and `credentials` use the same path
  notation.
- Connection changes, for example `connections[Webhook].main[0] -> Save`.
- Position only moves, reported in their own section so canvas tidy up never
  hides behind parameter edits.
- Workflow level changes such as `name`, `active`, and `settings`.

## Options

- `--format text|json`: output format, default `text`.
- `--keep-volatile`: compare volatile fields too, as described above.
- `--only nodes|connections|parameters`: limit the report to one scope. The
  exit code follows the selected scope, so
  `n8n-diff prod.json pr.json --only parameters` exits 0 when parameters are
  untouched even if nodes were added. Position moves count under the `nodes`
  scope.
- `-h, --help`: show usage.
- `--version`: show the version.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | no differences in the compared scope after normalization |
| 1 | differences found |
| 2 | error, for example bad arguments, an unreadable file, or invalid JSON |

The exit codes make it easy to gate CI on workflow drift:

```sh
n8n-diff exported/baseline.json exported/pull-request.json
```

## Alongside n8n-lint and n8n-audit

This tool sits between two siblings in the same family:

- `n8n-lint` checks a single workflow export against rules and flags issues
  in the file you have right now.
- `n8n-audit` scores a workflow for overall health and risk.
- `n8n-diff` explains the edit itself: what changed between two exports.

Together they cover a review end to end. Lint catches problems, audit scores
quality, and diff shows exactly what a change touched before you approve it.

## Development

```sh
npm test
```

The suite uses only `node:test`, so there is nothing to install.

## License

MIT, see [LICENSE](LICENSE).
