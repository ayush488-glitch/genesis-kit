#!/usr/bin/env node
// Per-session measurements from local coding-agent transcripts, so a harness change can be judged
// against what agents and humans actually did. It prints counts and identifiers only: no prompt
// text, no tool output and no file contents leave the transcript.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import * as zlib from 'node:zlib';

// A Genesis invocation in command position: at the start of a line, after ; & | ( or an opening quote, or after do/then,
// optionally through node or a path. A loop that runs one written command several times is counted once.
const COMMAND = /(?:^|[;&|("\n]|\b(?:do|then|else|time)\s)\s*(?:node\s+)?["']?(?:[^\s"';&|]*\/)?genesis(?:\.mjs)?["']?\s+([a-z]+)(?:\s+(approve)\b)?/g;
const PAPERCUT = /genesis(?:\.mjs)?["']?\s+trace\b[^\n;&|]*--event[\s=]+["']?papercut/g;
const KNOWN = new Set(['init', 'adopt', 'migrate', 'task', 'record', 'checkpoint', 'kickoff', 'run', 'recover', 'brief', 'context', 'next',
  'query', 'serve', 'dashboard', 'index', 'spec', 'plan', 'control', 'authorize', 'evaluate', 'learn', 'incident', 'agent', 'mcp',
  'status', 'trace', 'gate', 'workflow', 'cleanup', 'help']);
const REFUSED = /doesn't want to proceed|tool use was rejected|user rejected|Request interrupted/i;
// Records the host writes into the user channel. Anything else a person typed or pasted, including text that starts with a tag.
const MACHINE = /^\s*<(task-notification|local-command-|system-reminder|bash-(input|stdout|stderr)|user-prompt-submit-hook|heartbeat|external_|environment_context|user_instructions|turn_aborted)/;

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument: ${argv[i]}`);
    const next = argv[i + 1];
    options[argv[i].slice(2)] = !next || next.startsWith('--') ? true : argv[++i];
  }
  return options;
}

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

function readTranscript(path) {
  if (!path.endsWith('.zst')) return readFileSync(path, 'utf8');
  if (typeof zlib.zstdDecompressSync === 'function') return zlib.zstdDecompressSync(readFileSync(path)).toString('utf8');
  const result = spawnSync('zstd', ['-dc', path], { encoding: 'utf8', maxBuffer: 1 << 30 });
  return result.status === 0 ? result.stdout : null;
}

function blank(agent, path) {
  return { agent, session: null, path, cwd: null, first: null, last: null, human_turns: 0, interruptions: 0, refused_tool_calls: 0,
    tool_calls: 0, tool_errors: agent === 'claude' ? 0 : null, compactions: 0, genesis_commands: {}, approvals_run_by_agent: 0,
    papercuts: 0, checkpointed: false, pull_requests: [] };
}

// Every Genesis invocation in one shell command: which subcommands ran, and whether the agent itself recorded an approval.
function countGenesis(row, command) {
  if (!command || !command.includes('genesis')) return;
  for (const match of command.matchAll(COMMAND)) {
    if (!KNOWN.has(match[1])) continue;
    row.genesis_commands[match[1]] = (row.genesis_commands[match[1]] || 0) + 1;
    if (match[2] && ['control', 'spec', 'plan', 'learn'].includes(match[1])) row.approvals_run_by_agent += 1;
    if (match[1] === 'checkpoint' || match[1] === 'kickoff') row.checkpointed = true;
  }
  row.papercuts += [...command.matchAll(PAPERCUT)].length;
}

function stamp(row, at) {
  if (!at) return;
  row.first ||= at;
  row.last = at;
}

function scanClaude(path, text) {
  const row = blank('claude', path);
  row.session = basename(path).replace(/\.jsonl$/, '');
  for (const line of text.split('\n')) {
    if (!line) continue;
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    row.cwd ||= item.cwd || null;
    if (item.type === 'pr-link' && item.prUrl && !row.pull_requests.includes(item.prUrl)) row.pull_requests.push(item.prUrl);
    if (item.type === 'system' && item.subtype === 'compact_boundary') row.compactions += 1;
    if (item.isSidechain || !['user', 'assistant'].includes(item.type)) continue;
    stamp(row, item.timestamp);
    const content = item.message?.content;
    if (item.type === 'assistant') {
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type !== 'tool_use') continue;
        row.tool_calls += 1;
        if (block.name === 'Bash') countGenesis(row, block.input?.command);
      }
      continue;
    }
    if (item.isCompactSummary) { row.compactions += 1; continue; }
    let spoken = typeof content === 'string' ? content : '';
    for (const block of Array.isArray(content) ? content : []) {
      if (block.type === 'text') spoken += block.text || '';
      if (block.type !== 'tool_result' || !block.is_error) continue;
      if (REFUSED.test(String(JSON.stringify(block.content)).slice(0, 600))) row.refused_tool_calls += 1;
      else row.tool_errors += 1;
    }
    if (item.isMeta || !spoken.trim()) continue;
    if (spoken.includes('[Request interrupted by user')) { row.interruptions += 1; continue; }
    if (MACHINE.test(spoken)) continue;
    // A slash command with no arguments configures the session; with arguments it is a request.
    if (/^\s*<command-name>/.test(spoken) && !/<command-args>\s*[^<\s]/.test(spoken)) continue;
    row.human_turns += 1;
  }
  return row;
}

function scanCodex(path, text) {
  const row = blank('codex', path);
  row.session = (basename(path).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [basename(path)])[0];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const payload = item.payload && typeof item.payload === 'object' ? item.payload : {};
    if (item.type === 'session_meta') row.cwd ||= payload.cwd || null;
    if (item.type === 'compacted') row.compactions += 1;
    if (item.type !== 'response_item') continue;
    stamp(row, item.timestamp);
    if (payload.type === 'message' && payload.role === 'user') {
      const spoken = (payload.content || []).map(part => part?.text || '').join('');
      // Host-generated records (page state, heartbeats, environment context) arrive as tagged user messages.
      if (spoken.trim() && !MACHINE.test(spoken)) row.human_turns += 1;
    } else if (['function_call', 'custom_tool_call', 'local_shell_call'].includes(payload.type)) {
      row.tool_calls += 1;
      const raw = payload.arguments ?? payload.input ?? payload.action ?? '';
      countGenesis(row, (typeof raw === 'string' ? raw : JSON.stringify(raw)).replace(/\\"/g, '"').replace(/\\n/g, '\n'));
    }
  }
  return row;
}

function collect(options) {
  const rows = [];
  let unreadable = 0;
  const claude = options.claude || join(homedir(), '.claude', 'projects');
  // Subagent transcripts sit below a session directory; they are part of that session, not sessions of their own.
  for (const path of walk(claude, p => p.endsWith('.jsonl') && !p.includes(`${sep}subagents${sep}`))) {
    rows.push(scanClaude(path, readFileSync(path, 'utf8')));
  }
  const codex = options.codex || join(homedir(), '.codex', 'sessions');
  for (const path of walk(codex, p => p.endsWith('.jsonl') || p.endsWith('.jsonl.zst'))) {
    const text = readTranscript(path);
    if (text === null) unreadable += 1;
    else rows.push(scanCodex(path, text));
  }
  const since = options.since && options.since !== true ? options.since : null;
  const project = options.project && options.project !== true ? options.project : null;
  const kept = rows.filter(row => row.first && (!since || row.first.slice(0, 10) >= since) && (!project || (row.cwd || row.path).includes(project)))
    .sort((a, b) => a.first.localeCompare(b.first));
  return { rows: kept, unreadable };
}

function print(rows) {
  const columns = [['date', r => r.first.slice(0, 10)], ['agent', r => r.agent], ['session', r => r.session.slice(0, 8)],
    ['project', r => basename(r.cwd || '') || '?'], ['human', r => r.human_turns], ['stop', r => r.interruptions],
    ['refused', r => r.refused_tool_calls], ['tools', r => r.tool_calls], ['errors', r => r.tool_errors ?? '-'],
    ['genesis', r => Object.values(r.genesis_commands).reduce((a, b) => a + b, 0)], ['self-approve', r => r.approvals_run_by_agent],
    ['papercuts', r => r.papercuts], ['checkpoint', r => (r.checkpointed ? 'yes' : 'no')], ['prs', r => r.pull_requests.length]];
  const table = [columns.map(([name]) => name), ...rows.map(row => columns.map(([, value]) => String(value(row))))];
  const widths = columns.map((_, i) => Math.max(...table.map(line => line[i].length)));
  for (const line of table) console.log(line.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd());
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: node tools/session-audit.mjs [--claude DIR] [--codex DIR] [--since YYYY-MM-DD] [--project TEXT] [--json]

Reads local Claude Code and Codex transcripts and prints one row per session:
human turns, interruptions, refused tool calls, tool calls and errors, Genesis commands run,
approvals the agent recorded itself, papercuts filed, whether it checkpointed, and linked pull requests.
Defaults: ~/.claude/projects and ~/.codex/sessions. Output carries counts and identifiers only.`);
    return;
  }
  const { rows, unreadable } = collect(options);
  if (options.json) console.log(JSON.stringify(rows, null, 2));
  else print(rows);
  if (unreadable) console.error(`session-audit: skipped ${unreadable} compressed transcript(s); install zstd or use Node 22.15+ to read them`);
}

try { main(); } catch (error) { console.error(`session-audit: ${error.message}`); process.exitCode = 1; }
