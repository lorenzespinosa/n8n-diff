// Output formats for a diff result: plain text by default, JSON on request.

function formatValue(value) {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}

function countPhrase(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function changeLines(change) {
  if (change.kind === 'added') {
    return [`  + ${change.path} = ${formatValue(change.after)}`];
  }
  if (change.kind === 'removed') {
    return [`  - ${change.path} = ${formatValue(change.before)}`];
  }
  return [
    `  - ${change.path} = ${formatValue(change.before)}`,
    `  + ${change.path} = ${formatValue(change.after)}`,
  ];
}

function nodeLabel(node) {
  return node.type ? `${node.name} (${node.type})` : node.name;
}

function summaryLine(summary) {
  const parts = [];
  if (summary.addedNodes > 0) {
    parts.push(countPhrase(summary.addedNodes, 'node added', 'nodes added'));
  }
  if (summary.removedNodes > 0) {
    parts.push(countPhrase(summary.removedNodes, 'node removed', 'nodes removed'));
  }
  if (summary.renamedNodes > 0) {
    parts.push(countPhrase(summary.renamedNodes, 'node renamed', 'nodes renamed'));
  }
  if (summary.parameterChanges > 0) {
    parts.push(countPhrase(summary.parameterChanges, 'parameter change', 'parameter changes'));
  }
  if (summary.connectionChanges > 0) {
    parts.push(countPhrase(summary.connectionChanges, 'connection change', 'connection changes'));
  }
  if (summary.positionMoves > 0) {
    parts.push(countPhrase(summary.positionMoves, 'position move', 'position moves'));
  }
  if (summary.workflowChanges > 0) {
    parts.push(countPhrase(summary.workflowChanges, 'workflow change', 'workflow changes'));
  }
  return `Summary: ${parts.join(', ')}`;
}

function renderText(result) {
  const lines = [];

  if (result.identical) {
    lines.push('No differences after normalization.');
    lines.push('');
    lines.push('Summary: identical');
    return `${lines.join('\n')}\n`;
  }

  if (result.addedNodes.length > 0) {
    lines.push('Added nodes');
    for (const node of result.addedNodes) {
      lines.push(`  + ${nodeLabel(node)}`);
    }
    lines.push('');
  }

  if (result.removedNodes.length > 0) {
    lines.push('Removed nodes');
    for (const node of result.removedNodes) {
      lines.push(`  - ${nodeLabel(node)}`);
    }
    lines.push('');
  }

  if (result.renamed.length > 0) {
    lines.push('Renamed nodes');
    for (const rename of result.renamed) {
      lines.push(`  * ${rename.from} -> ${rename.to}`);
    }
    lines.push('');
  }

  for (const group of result.parameterChanges) {
    lines.push(`Node: ${group.node}`);
    for (const change of group.changes) {
      lines.push(...changeLines(change));
    }
    lines.push('');
  }

  if (result.connectionChanges.length > 0) {
    lines.push('Connections');
    for (const change of result.connectionChanges) {
      const sign = change.kind === 'added' ? '+' : '-';
      lines.push(`  ${sign} ${change.path}`);
    }
    lines.push('');
  }

  if (result.positionMoves.length > 0) {
    lines.push('Position moves');
    for (const move of result.positionMoves) {
      lines.push(`  * ${move.node} moved ${formatValue(move.before)} -> ${formatValue(move.after)}`);
    }
    lines.push('');
  }

  if (result.workflowChanges.length > 0) {
    lines.push('Workflow');
    for (const change of result.workflowChanges) {
      lines.push(...changeLines(change));
    }
    lines.push('');
  }

  lines.push(summaryLine(result.summary));
  return `${lines.join('\n')}\n`;
}

function renderJson(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export { renderText, renderJson, summaryLine };
