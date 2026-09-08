#!/usr/bin/env node
// MCP server over stdio. Exposes the same query surface the CLI uses, so an agent pulls answers
// from the index on demand instead of receiving one fixed guess up front.
// Read-only by construction: it holds no write path to project state.
import { boundary, callees, callers, defines, impact, loadGraph, neighbours, path as shortestPath, resolveRef, search } from './query.mjs';
import { resolve } from 'node:path';

const repo = resolve(process.argv[2] || '.');
const PROTOCOL = '2024-11-05';

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const ref = { type: 'string', description: 'A node id, file path, bare symbol name, or path#name.' };
const limit = { type: 'integer', description: 'Maximum rows to return.' };

const TOOLS = [
  { name: 'search_symbols', description: 'Find symbols and files whose name contains the text. Start here when you know a name but not where it lives.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, limit }, required: ['text'] } },
  { name: 'get_definitions', description: 'List the symbols declared under a file or directory, with kinds and line numbers.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, limit }, required: ['path'] } },
  { name: 'get_callers', description: 'What calls this symbol. Results carry a tier: proven, or ambiguous with the candidates that were not ruled out.',
    inputSchema: { type: 'object', properties: { ref, limit }, required: ['ref'] } },
  { name: 'get_callees', description: 'What this symbol calls, with the same tiers.',
    inputSchema: { type: 'object', properties: { ref, limit }, required: ['ref'] } },
  { name: 'get_scope', description: 'What a file or directory depends on and what depends on it, with counts. Works on a directory, unlike the symbol tools.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, limit }, required: ['path'] } },
  { name: 'get_impact', description: 'Blast radius: everything that transitively imports this file, with hop distance. Ask before editing.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, hops: { type: 'integer' }, limit }, required: ['path'] } },
  { name: 'get_neighbours', description: 'What sits within N hops of a node, in either direction.',
    inputSchema: { type: 'object', properties: { ref, hops: { type: 'integer' }, limit }, required: ['ref'] } },
  { name: 'trace_path', description: 'Shortest dependency path between two nodes, returning the edges it used so the answer can be checked.',
    inputSchema: { type: 'object', properties: { from: ref, to: ref, hops: { type: 'integer' } }, required: ['from', 'to'] } },
];

function one(graph, value) {
  const found = resolveRef(graph, value);
  if (!found.length) throw new Error(`nothing matches "${value}"; try search_symbols first`);
  // Ambiguity is surfaced rather than hidden: the caller decides which one it meant.
  if (found.length > 1) return { node: found[0], ambiguous: found.map((n) => n.id) };
  return { node: found[0] };
}

function call(name, args) {
  const graph = loadGraph(repo);
  const options = { limit: args.limit, hops: args.hops };
  if (name === 'search_symbols') return search(graph, args.text, options);
  if (name === 'get_definitions') return defines(graph, args.path, options);
  if (name === 'get_scope') return boundary(graph, args.path, options);
  if (name === 'get_impact') return impact(graph, one(graph, args.path).node, options);
  if (name === 'trace_path') {
    const from = one(graph, args.from), to = one(graph, args.to);
    const steps = shortestPath(graph, from.node, to.node, options);
    return steps ? { from: from.node.id, to: to.node.id, steps } : { from: from.node.id, to: to.node.id, steps: null, note: 'no path within the hop limit' };
  }
  const target = one(graph, args.ref);
  const rows = name === 'get_callers' ? callers(graph, target.node, options)
    : name === 'get_callees' ? callees(graph, target.node, options)
    : neighbours(graph, target.node, options);
  return target.ambiguous ? { resolved: target.node.id, also_matched: target.ambiguous, results: rows } : rows;
}

function handle(request) {
  const { id, method, params = {} } = request;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return reply({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'genesis-index', version: '2.4.0' } });
  if (method === 'tools/list') return reply({ tools: TOOLS });
  if (method === 'tools/call') {
    try { return reply(text(call(params.name, params.arguments || {}))); }
    catch (error) { return reply({ ...text(error.message), isError: true }); }
  }
  if (method === 'ping') return reply({});
  if (method.startsWith('notifications/')) return null;
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method: ${method}` } };
}

// Newline-delimited JSON-RPC. Buffered by line, because a large tools/call result can arrive in
// several chunks and a partial parse would drop the request.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let cut;
  while ((cut = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, cut).trim();
    buffer = buffer.slice(cut + 1);
    if (!line) continue;
    let response;
    try { response = handle(JSON.parse(line)); }
    catch (error) { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message } }; }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
});
process.stdin.on('end', () => process.exit(0));
