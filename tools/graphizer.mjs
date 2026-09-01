#!/usr/bin/env node
// Deterministic, read-only, zero-dependency source indexer.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

const argv = process.argv.slice(2), rootArg = argv[0];
if (!rootArg) { console.error('usage: node graphizer.mjs <repo-root> [--out <path>] [--write]'); process.exit(1); }
const root = resolve(rootArg), write = argv.includes('--write'), outIndex = argv.indexOf('--out');
if (outIndex !== -1 && !argv[outIndex + 1]) { console.error('--out needs a path'); process.exit(1); }
const outPath = resolve(outIndex < 0 ? join(root, '.genesis', 'index', 'graph.json') : argv[outIndex + 1]), outDir = dirname(outPath);
const IGNORE = new Set(['.cache', '.genesis', '.git', '.next', '.turbo', '.venv', '__pycache__', 'build', 'coverage', 'dist', 'node_modules', 'out', 'target', 'venv']);
const CODE = new Set(['.cjs', '.js', '.jsx', '.mjs', '.py', '.ts', '.tsx']);
const JS_EXTENSIONS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
const NODE_BUILTINS = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const hash = value => createHash('sha256').update(value).digest('hex');
const posix = value => value.split(sep).join('/');
function walk(dir, files = []) { for (const name of readdirSync(dir).sort()) { if (IGNORE.has(name) || name.startsWith('.DS')) continue; const path = join(dir, name); let stat; try { stat = lstatSync(path); } catch { continue; } if (stat.isSymbolicLink()) continue; if (stat.isDirectory()) walk(path, files); else if (CODE.has(extname(name))) files.push(path); } return files; }
const files = walk(root), known = new Set(files), nodes = new Map(), edges = new Map(), warnings = [];
const fileId = path => `file:${posix(relative(root, path))}`;
const provenance = (extractor, source) => ({ extractor, source });
const addNode = node => nodes.set(node.id, node);
const addEdge = edge => { const id = `${edge.type}:${edge.source}->${edge.target}:${edge.specifier ?? ''}`; edges.set(id, { id, ...edge, contentHash: hash(id) }); };
for (const path of files) { const source = readFileSync(path, 'utf8'), rel = posix(relative(root, path)); addNode({ id: fileId(path), type: 'file', label: rel, path: rel, language: extname(path) === '.py' ? 'python' : 'javascript', confidence: 1, provenance: provenance('filesystem', rel), contentHash: hash(source) }); }

function packageName(specifier) { const parts = specifier.split('/'); return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]; }
function resolveJsImport(from, specifier) { if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null; const resolved = resolve(dirname(from), specifier), base = JS_EXTENSIONS.includes(extname(resolved)) ? resolved.slice(0, -extname(resolved).length) : resolved; for (const suffix of JS_EXTENSIONS) for (const candidate of [resolved + suffix, base + suffix, join(resolved, `index${suffix}`)]) if (known.has(candidate)) return candidate; }
function resolvePythonImport(from, specifier) { const match = specifier.match(/^(\.+)(.*)$/); let base = match ? dirname(from) : root, module = match ? match[2] : specifier; if (match) for (let i = 1; i < match[1].length; i++) base = dirname(base); const path = join(base, ...module.split('.').filter(Boolean)); for (const candidate of [`${path}.py`, join(path, '__init__.py')]) if (known.has(candidate)) return candidate; return match ? undefined : null; }
function addDependency(from, specifier, line, language, standard = false) {
  const target = language === 'javascript' ? resolveJsImport(from, specifier) : resolvePythonImport(from, specifier), source = fileId(from), rel = posix(relative(root, from)), extractor = `${language}-imports`;
  const confidence = language === 'python' ? 1 : .85;
  if (target) return addEdge({ type: 'imports', source, target: fileId(target), specifier, line, resolved: true, confidence, provenance: provenance(extractor, rel) });
  const name = packageName(specifier.replace(/^node:|^\.+/, ''));
  if (standard || (language === 'javascript' && NODE_BUILTINS.has(name))) { const id = `runtime:${language}:${name}`; addNode({ id, type: 'runtime', label: name, language, confidence, provenance: provenance('standard-library', rel), contentHash: hash(id) }); return addEdge({ type: 'imports', source, target: id, specifier, line, resolved: true, confidence, provenance: provenance(extractor, rel) }); }
  if (target === null) { const ecosystem = language === 'python' ? 'pypi' : 'npm', id = `package:${ecosystem}:${name}`; addNode({ id, type: 'package', label: name, ecosystem, confidence, provenance: provenance('import', rel), contentHash: hash(id) }); return addEdge({ type: 'imports', source, target: id, specifier, line, resolved: true, confidence, provenance: provenance(extractor, rel) }); }
  const id = `unresolved:${rel}:${specifier}`; addNode({ id, type: 'unresolved', label: specifier, confidence: .4, provenance: provenance('import', rel), contentHash: hash(id) }); addEdge({ type: 'imports', source, target: id, specifier, line, resolved: false, confidence: .4, provenance: provenance(extractor, rel) });
}

const jsImport = /^\s*(?:import\s+(?:[^'";]*?\s+from\s*)?|export\s+[^'";]*?\s+from\s*|(?:(?:const|let|var)\s+[\w${}, ]+\s*=\s*)?require\s*\(\s*)['"]([^'"]+)['"]/gm;
const jsSymbol = /(?:^|\n)\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(class|function)\s+([A-Za-z_$][\w$]*)|(?:^|\n)\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
for (const path of files.filter(file => extname(file) !== '.py')) { const source = readFileSync(path, 'utf8'); let match; while ((match = jsImport.exec(source))) addDependency(path, match[1], source.slice(0, match.index).split('\n').length, 'javascript'); while ((match = jsSymbol.exec(source))) { const kind = match[1] || 'variable', name = match[2] || match[3], line = source.slice(0, match.index).split('\n').length, rel = posix(relative(root, path)), id = `symbol:${rel}#${kind}:${name}`; addNode({ id, type: 'symbol', kind, name, label: name, path: rel, line, confidence: .8, provenance: provenance('conservative-js-symbols', rel), contentHash: hash(`${kind}:${name}`) }); addEdge({ type: 'defines', source: fileId(path), target: id, line, resolved: true, confidence: .8, provenance: provenance('conservative-js-symbols', rel) }); } }

const pythonFiles = files.filter(file => extname(file) === '.py');
if (pythonFiles.length) {
  const script = `import ast,json,sys\nr=[]\nclass Scan(ast.NodeVisitor):\n def __init__(self): self.imports=[]; self.symbols=[]; self.scope=[]\n def visit_Import(self,n): self.imports += [{'specifier':a.name,'line':n.lineno,'standard':a.name.split('.')[0] in sys.stdlib_module_names} for a in n.names]\n def visit_ImportFrom(self,n): self.imports.append({'specifier':'.'*n.level+(n.module or ''),'line':n.lineno,'standard':n.level==0 and (n.module or '').split('.')[0] in sys.stdlib_module_names})\n def symbol(self,n,kind):\n  q='.'.join(self.scope+[n.name]); self.symbols.append({'name':n.name,'qualifiedName':q,'kind':kind,'line':n.lineno}); self.scope.append(n.name); self.generic_visit(n); self.scope.pop()\n def visit_ClassDef(self,n): self.symbol(n,'class')\n def visit_FunctionDef(self,n): self.symbol(n,'function')\n def visit_AsyncFunctionDef(self,n): self.symbol(n,'function')\nfor p in json.load(sys.stdin):\n try:\n  s=Scan(); s.visit(ast.parse(open(p,encoding='utf-8').read(),filename=p)); r.append({'path':p,'imports':s.imports,'symbols':s.symbols})\n except (OSError,SyntaxError) as e: r.append({'path':p,'error':str(e)})\nprint(json.dumps(r))`;
  const parsed = spawnSync('python3', ['-c', script], { input: JSON.stringify(pythonFiles), encoding: 'utf8' });
  if (parsed.status !== 0) warnings.push(`Python AST unavailable: ${(parsed.stderr || 'python3 failed').trim()}`);
  else for (const result of JSON.parse(parsed.stdout)) { if (result.error) { warnings.push(`${posix(relative(root, result.path))}: ${result.error}`); continue; } for (const item of result.imports) addDependency(result.path, item.specifier, item.line, 'python', item.standard); for (const item of result.symbols) { const rel = posix(relative(root, result.path)), id = `symbol:${rel}#${item.kind}:${item.qualifiedName}`; addNode({ id, type: 'symbol', ...item, label: item.qualifiedName, path: rel, confidence: 1, provenance: provenance('python-stdlib-ast', rel), contentHash: hash(`${item.kind}:${item.qualifiedName}`) }); addEdge({ type: 'defines', source: fileId(result.path), target: id, line: item.line, resolved: true, confidence: 1, provenance: provenance('python-stdlib-ast', rel) }); } }
}

const revisionResult = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const sortedNodes = [...nodes.values()].sort((a,b) => a.id.localeCompare(b.id)), sortedEdges = [...edges.values()].sort((a,b) => a.id.localeCompare(b.id));
const sourceHash = hash(sortedNodes.filter(n => n.type === 'file').map(n => `${n.id}:${n.contentHash}`).join('\n'));
const graph = { schemaVersion: 1, project: basename(root), revision: revisionResult.status === 0 ? revisionResult.stdout.trim() : null, sourceHash, provenance: { tool: 'genesis-graphizer', method: 'static-analysis', confidenceScale: '0..1' }, nodes: sortedNodes, edges: sortedEdges, warnings: warnings.sort() };
const json = `${JSON.stringify(graph, null, 2)}\n`, escDot = value => String(value).replaceAll('\\','\\\\').replaceAll('"','\\"');
const dot = `digraph genesis {\n  rankdir=LR;\n  node [shape=box,fontname="system-ui"];\n${sortedNodes.map(n => `  "${escDot(n.id)}" [label="${escDot(n.label)}",class="${n.type}"];`).join('\n')}\n${sortedEdges.map(e => `  "${escDot(e.source)}" -> "${escDot(e.target)}" [label="${e.type}"];`).join('\n')}\n}\n`;
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(graph.project)} code graph</title><style>body{font:14px system-ui;margin:2rem;color:#172033;background:#f7f8fa}header{display:flex;gap:1rem;align-items:baseline;flex-wrap:wrap}input{padding:.6rem;min-width:20rem}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(22rem,1fr));gap:1rem}.card{background:white;border:1px solid #d9deea;border-radius:10px;padding:1rem}.node{padding:.45rem;border-left:4px solid #748ffc;margin:.35rem 0;background:#f8f9ff}.package{border-color:#2f9e44}.unresolved{border-color:#e8590c}.symbol{border-color:#7950f2}small{color:#667085}code{word-break:break-all}</style><header><h1>${esc(graph.project)}</h1><small>${sortedNodes.length} nodes · ${sortedEdges.length} edges · ${sourceHash.slice(0,12)}</small><input id="q" type="search" placeholder="Filter paths, symbols, packages" aria-label="Filter graph"></header><section><div class="card"><h2>Nodes</h2>${sortedNodes.map(n => `<div class="node ${n.type}" data-search="${esc(`${n.id} ${n.label}`.toLowerCase())}"><strong>${esc(n.label)}</strong> <small>${n.type} · ${n.confidence}</small><br><code>${esc(n.id)}</code></div>`).join('')}</div><div class="card"><h2>Relationships</h2>${sortedEdges.map(e => `<div class="node" data-search="${esc(`${e.source} ${e.target} ${e.specifier ?? ''}`.toLowerCase())}"><code>${esc(e.source)}</code> → <code>${esc(e.target)}</code><br><small>${e.type}${e.specifier ? ` · ${esc(e.specifier)}` : ''}</small></div>`).join('')}</div></section><script>q.oninput=()=>document.querySelectorAll('[data-search]').forEach(e=>e.hidden=!e.dataset.search.includes(q.value.toLowerCase()))</script></html>\n`;
function writeChanged(path, content) { if (existsSync(path) && readFileSync(path,'utf8') === content) return false; writeFileSync(path,content); return true; }
const placeholder = existsSync(outPath) && readFileSync(outPath,'utf8').includes('{{');
if (write || placeholder) { mkdirSync(outDir,{recursive:true}); const changed = [writeChanged(outPath,json),writeChanged(join(outDir,'graph.dot'),dot),writeChanged(join(outDir,'graph.html'),html)].filter(Boolean).length; console.error(`${changed ? 'wrote' : 'unchanged'} ${sortedNodes.length} nodes, ${sortedEdges.length} edges -> ${posix(relative(root,outDir)) || '.'}`); }
else { process.stdout.write(json); console.error(`dry run: ${sortedNodes.length} nodes, ${sortedEdges.length} edges; pass --write to save`); }
