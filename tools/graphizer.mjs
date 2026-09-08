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
const CONFIGS = new Set(['jsconfig.json', 'tsconfig.json']);
const JS_EXTENSIONS = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
const NODE_BUILTINS = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const hash = value => createHash('sha256').update(value).digest('hex');
const posix = value => value.split(sep).join('/');
function walk(dir, files = [], configs = []) { for (const name of readdirSync(dir).sort()) { if (IGNORE.has(name) || name.startsWith('.DS')) continue; const path = join(dir, name); let stat; try { stat = lstatSync(path); } catch { continue; } if (stat.isSymbolicLink()) continue; if (stat.isDirectory()) walk(path, files, configs); else if (CODE.has(extname(name))) files.push(path); else if (CONFIGS.has(name)) configs.push(path); } return { files, configs }; }
const { files, configs } = walk(root), known = new Set(files), nodes = new Map(), edges = new Map(), warnings = [];
const fileId = path => `file:${posix(relative(root, path))}`;
const addNode = node => nodes.set(node.id, node);
// Keyed by a derivable identity so edges dedupe and sort deterministically without storing it.
const addEdge = edge => edges.set(`${edge.type}:${edge.source}->${edge.target}:${edge.specifier ?? ''}`, edge);
for (const path of files) { const source = readFileSync(path, 'utf8'), rel = posix(relative(root, path)); addNode({ id: fileId(path), type: 'file', label: rel, path: rel, language: extname(path) === '.py' ? 'python' : 'javascript', confidence: 1, extractor: 'filesystem', contentHash: hash(source) }); }

// --- monorepo-aware resolution: JSONC configs, workspace packages, tsconfig path aliases ---
// Comment and trailing-comma stripping is string-aware; a naive regex corrupts values containing "//" or ", }".
function stripJsonc(text) {
  let out = '', quote = '', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quote) { out += ch; if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (ch === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (ch === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    if (ch === '}' || ch === ']') out = out.replace(/,\s*$/, '');
    out += ch;
  }
  return out;
}
const readJsonc = path => { try { return JSON.parse(stripJsonc(readFileSync(path, 'utf8'))); } catch { return null; } };
const tryCandidates = base => { const ext = extname(base), stem = ext && JS_EXTENSIONS.includes(ext) ? base.slice(0, -ext.length) : base; for (const suffix of JS_EXTENSIONS) for (const candidate of [base + suffix, stem + suffix, join(base, `index${suffix}`)]) if (known.has(candidate)) return candidate; };

// '*' matches one directory segment, which is all workspace globs use in practice.
function globDirs(pattern) {
  let dirs = [root];
  for (const part of pattern.split('/')) {
    const next = [];
    for (const dir of dirs) {
      if (part !== '*') { const path = join(dir, part); if (existsSync(path)) next.push(path); continue; }
      let entries = []; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) if (entry.isDirectory() && !IGNORE.has(entry.name)) next.push(join(dir, entry.name));
    }
    dirs = next;
  }
  return dirs;
}
function workspacePatterns() {
  const yaml = join(root, 'pnpm-workspace.yaml');
  if (existsSync(yaml)) {
    const found = []; let inPackages = false;
    for (const line of readFileSync(yaml, 'utf8').split('\n')) {
      if (/^packages:/.test(line)) { inPackages = true; continue; }
      if (!inPackages) continue;
      const item = line.match(/^\s+-\s*["']?([^"'#\s]+)/);
      if (item) found.push(item[1]); else if (/^\S/.test(line)) inPackages = false;
    }
    if (found.length) return found;
  }
  const pkg = readJsonc(join(root, 'package.json')), workspaces = pkg && (Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages);
  return Array.isArray(workspaces) ? workspaces : [];
}
const workspace = new Map();
for (const pattern of workspacePatterns()) for (const dir of globDirs(pattern)) { const pkg = readJsonc(join(dir, 'package.json')); if (pkg?.name) workspace.set(pkg.name, { dir, exports: pkg.exports }); }

// paths resolve against baseUrl when set, else against the directory of the config that declared them.
function loadTsconfig(path, seen = new Set()) {
  if (seen.has(path) || !existsSync(path)) return null;
  seen.add(path);
  const raw = readJsonc(path); if (!raw) return null;
  const here = dirname(path);
  let inherited = {};
  if (typeof raw.extends === 'string') {
    let target = raw.extends.startsWith('.') ? resolve(here, raw.extends) : null;
    if (!target) { const name = packageName(raw.extends), pkg = workspace.get(name); if (pkg) target = join(pkg.dir, raw.extends.slice(name.length) || '.'); }
    if (target) inherited = loadTsconfig(/\.json$/.test(target) ? target : `${target}.json`, seen) || {};
  }
  const options = raw.compilerOptions || {}, base = options.baseUrl ? resolve(here, options.baseUrl) : inherited.base;
  return { dir: here, base, paths: options.paths ?? inherited.paths, pathsBase: options.paths ? (base ?? here) : inherited.pathsBase };
}
const tsconfigs = configs.map(path => loadTsconfig(path)).filter(config => config?.paths).sort((a, b) => b.dir.length - a.dir.length);
const nearestTsconfig = from => tsconfigs.find(config => from === config.dir || from.startsWith(config.dir + sep));

function resolveAlias(from, specifier) {
  const config = nearestTsconfig(dirname(from));
  if (!config) return;
  for (const [pattern, targets] of Object.entries(config.paths)) {
    const star = pattern.indexOf('*');
    let tail = '';
    if (star === -1) { if (pattern !== specifier) continue; }
    else {
      const head = pattern.slice(0, star), rest = pattern.slice(star + 1);
      if (!specifier.startsWith(head) || !specifier.endsWith(rest) || specifier.length < head.length + rest.length) continue;
      tail = specifier.slice(head.length, specifier.length - rest.length);
    }
    for (const target of targets) { const hit = tryCandidates(resolve(config.pathsBase, target.replace('*', tail))); if (hit) return hit; }
  }
}
// Prefer the "types" condition: it points at source, while "default" points at unbuilt dist.
function resolveWorkspace(specifier) {
  const name = packageName(specifier), pkg = workspace.get(name);
  if (!pkg) return;
  const subpath = specifier.slice(name.length).replace(/^\//, '');
  if (pkg.exports && typeof pkg.exports === 'object') {
    const entry = pkg.exports[subpath ? `./${subpath}` : '.'];
    const file = typeof entry === 'string' ? entry : entry && (entry.types || entry.import || entry.default);
    if (typeof file === 'string') { const hit = tryCandidates(resolve(pkg.dir, file)); if (hit) return hit; }
  }
  return tryCandidates(join(pkg.dir, subpath || 'index')) ?? tryCandidates(join(pkg.dir, 'src', subpath || 'index'));
}

function packageName(specifier) { const parts = specifier.split('/'); return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]; }
// undefined means "looked like local source but was not found"; null means "external package".
function resolveJsImport(from, specifier) { if (specifier.startsWith('.') || specifier.startsWith('/')) return tryCandidates(resolve(dirname(from), specifier)); return resolveAlias(from, specifier) ?? resolveWorkspace(specifier) ?? null; }
function resolvePythonImport(from, specifier) { const match = specifier.match(/^(\.+)(.*)$/); let base = match ? dirname(from) : root, module = match ? match[2] : specifier; if (match) for (let i = 1; i < match[1].length; i++) base = dirname(base); const path = join(base, ...module.split('.').filter(Boolean)); for (const candidate of [`${path}.py`, join(path, '__init__.py')]) if (known.has(candidate)) return candidate; return match ? undefined : null; }
function addDependency(from, specifier, line, language, standard = false) {
  const target = language === 'javascript' ? resolveJsImport(from, specifier) : resolvePythonImport(from, specifier), source = fileId(from), rel = posix(relative(root, from)), extractor = `${language}-imports`;
  const confidence = .85;
  if (target) return addEdge({ type: 'imports', source, target: fileId(target), specifier, line, resolved: true, confidence, extractor: extractor });
  const name = packageName(specifier.replace(/^node:|^\.+/, ''));
  if (standard || (language === 'javascript' && NODE_BUILTINS.has(name))) { const id = `runtime:${language}:${name}`; addNode({ id, type: 'runtime', label: name, language, confidence, extractor: 'standard-library', contentHash: hash(id) }); return addEdge({ type: 'imports', source, target: id, specifier, line, resolved: true, confidence, extractor: extractor }); }
  if (target === null) { const ecosystem = language === 'python' ? 'pypi' : 'npm', id = `package:${ecosystem}:${name}`; addNode({ id, type: 'package', label: name, ecosystem, confidence, extractor: 'import', contentHash: hash(id) }); return addEdge({ type: 'imports', source, target: id, specifier, line, resolved: false, confidence: .5, extractor: extractor }); }
  const id = `unresolved:${rel}:${specifier}`; addNode({ id, type: 'unresolved', label: specifier, confidence: .4, extractor: 'import', contentHash: hash(id) }); addEdge({ type: 'imports', source, target: id, specifier, line, resolved: false, confidence: .4, extractor: extractor });
}

const jsImport = /^\s*(?:import\s+(?:[^'";]*?\s+from\s*)?|export\s+[^'";]*?\s+from\s*|(?:(?:const|let|var)\s+[\w${}, ]+\s*=\s*)?require\s*\(\s*)['"]([^'"]+)['"]/gm;
// Top-level declarations only: patterns anchor at column 0, so nested declarations are never claimed.
// Ordered — the first match wins, so arrow-valued bindings are reported as functions, not variables.
const NAME = '([A-Za-z_$][\\w$]*)', DECL = '^(?:export\\s+)?(?:declare\\s+)?';
const JS_PATTERNS = [
  ['function', new RegExp(`^export\\s+default\\s+(?:async\\s+)?function\\s*\\*?\\s*${NAME}`)],
  ['function', new RegExp(`${DECL}(?:async\\s+)?function\\s*\\*?\\s*${NAME}`)],
  ['class', new RegExp(`^(?:export\\s+(?:default\\s+)?)?(?:declare\\s+)?(?:abstract\\s+)?class\\s+${NAME}`)],
  ['interface', new RegExp(`${DECL}interface\\s+${NAME}`)],
  ['type', new RegExp(`${DECL}type\\s+${NAME}`)],
  ['enum', new RegExp(`${DECL}(?:const\\s+)?enum\\s+${NAME}`)],
  // `const x = (a) => ...` and `const x = async (\n` both name a function, not a value.
  ['function', new RegExp(`${DECL}(?:const|let|var)\\s+${NAME}\\s*(?::\\s*[^=]+?)?=\\s*(?:async\\s+)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*(?::[^=]*?)?=>`)],
  ['function', new RegExp(`${DECL}(?:const|let|var)\\s+${NAME}\\s*(?::[^=]+)?=\\s*(?:async\\s+)?\\(\\s*$`)],
  ['variable', new RegExp(`${DECL}(?:const|let|var)\\s+${NAME}`)],
];
function jsSymbols(source) {
  const found = [], lines = source.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line || /^\s/.test(line)) continue;
    for (const [kind, pattern] of JS_PATTERNS) { const match = pattern.exec(line); if (match) { found.push({ kind, name: match[1], line: index + 1 }); break; } }
  }
  return found;
}
// Import bindings: which local name refers to which exported name in which module. Needed to
// resolve a call to a symbol in another file rather than guessing by name alone.
const importClause = /^\s*import\s+([^'";]+?)\s+from\s*['"]([^'"]+)['"]/gm;
function bindingsOf(clause) {
  const found = [], named = clause.match(/\{([^}]*)\}/);
  if (named) for (const part of named[1].split(',')) {
    const match = part.trim().match(/^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
    if (match) found.push({ local: match[2] || match[1], imported: match[1] });
  }
  const star = clause.match(/\*\s*as\s+([A-Za-z_$][\w$]*)/);
  if (star) found.push({ local: star[1], imported: '*' });
  const rest = clause.replace(/\{[^}]*\}/g, '').replace(/\*\s*as\s+[A-Za-z_$][\w$]*/g, '').replace(/^\s*type\s+/, '').trim();
  const fallback = rest.match(/^([A-Za-z_$][\w$]*)/);
  if (fallback) found.push({ local: fallback[1], imported: 'default' });
  return found;
}

const CALL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'await', 'new', 'delete', 'void', 'yield', 'super', 'this', 'import', 'require', 'do', 'else', 'in', 'of', 'instanceof', 'case', 'throw']);
const callSite = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
const extendsSite = /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:abstract\s+)?class\s+[A-Za-z_$][\w$]*(?:<[^>]*>)?\s+extends\s+([A-Za-z_$][\w$]*)/;

const jsFiles = files.filter(file => extname(file) !== '.py');
const sources = new Map(), fileSymbols = new Map(), fileImports = new Map();
for (const path of jsFiles) {
  const source = readFileSync(path, 'utf8'), rel = posix(relative(root, path));
  sources.set(rel, source);
  let match; while ((match = jsImport.exec(source))) addDependency(path, match[1], source.slice(0, match.index).split('\n').length, 'javascript');
  const symbols = jsSymbols(source);
  fileSymbols.set(rel, symbols);
  for (const { kind, name, line } of symbols) {
    const id = `symbol:${rel}#${kind}:${name}`;
    addNode({ id, type: 'symbol', kind, name, label: name, path: rel, line, confidence: .8, extractor: 'conservative-js-symbols', contentHash: hash(`${kind}:${name}`) });
    addEdge({ type: 'defines', source: fileId(path), target: id, line, resolved: true, confidence: .8, extractor: 'conservative-js-symbols' });
  }
  const imports = new Map();
  while ((match = importClause.exec(source))) {
    const target = resolveJsImport(path, match[2]);
    if (!target) continue;
    const targetRel = posix(relative(root, target));
    for (const binding of bindingsOf(match[1])) imports.set(binding.local, { file: targetRel, imported: binding.imported });
  }
  fileImports.set(rel, imports);
}

// Three tiers of truth, borrowed from Benzi's description: a call resolved to one definition is
// proven; a call whose name matches several definitions keeps every candidate rather than being
// collapsed into a confident guess; a call that resolves to nothing is counted, never invented.
const byName = new Map();
for (const [rel, symbols] of fileSymbols) for (const symbol of symbols) {
  if (!byName.has(symbol.name)) byName.set(symbol.name, []);
  byName.get(symbol.name).push(`symbol:${rel}#${symbol.kind}:${symbol.name}`);
}
const symbolId = (rel, name) => { const found = (fileSymbols.get(rel) || []).find(s => s.name === name); return found ? `symbol:${rel}#${found.kind}:${found.name}` : null; };
let unresolvedCalls = 0;
for (const path of jsFiles) {
  const rel = posix(relative(root, path)), source = sources.get(rel), symbols = fileSymbols.get(rel);
  if (!symbols || !symbols.length) continue;
  const lines = source.split('\n'), imports = fileImports.get(rel);
  // Each top-level declaration owns the lines up to the next one, which is enough to attribute a
  // call to its enclosing symbol without building a scope tree.
  for (let index = 0; index < symbols.length; index++) {
    const symbol = symbols[index], from = `symbol:${rel}#${symbol.kind}:${symbol.name}`;
    const end = index + 1 < symbols.length ? symbols[index + 1].line - 1 : lines.length;
    const body = lines.slice(symbol.line - 1, end).join('\n');
    const inherit = extendsSite.exec(lines[symbol.line - 1] || '');
    if (inherit) {
      const parent = imports.has(inherit[1]) ? symbolId(imports.get(inherit[1]).file, inherit[1]) : symbolId(rel, inherit[1]);
      if (parent && parent !== from) addEdge({ type: 'inherits', source: from, target: parent, tier: 'proven', resolved: true, confidence: .8, extractor: 'conservative-js-calls' });
    }
    const seen = new Set();
    let call; callSite.lastIndex = 0;
    while ((call = callSite.exec(body))) {
      const name = call[1];
      if (CALL_KEYWORDS.has(name) || name === symbol.name || seen.has(name)) continue;
      seen.add(name);
      const local = symbolId(rel, name);
      if (local) { addEdge({ type: 'calls', source: from, target: local, tier: 'proven', resolved: true, confidence: .75, extractor: 'conservative-js-calls' }); continue; }
      const binding = imports.get(name);
      if (binding) {
        const target = symbolId(binding.file, binding.imported === 'default' || binding.imported === '*' ? name : binding.imported);
        if (target) { addEdge({ type: 'calls', source: from, target, tier: 'proven', resolved: true, confidence: .7, extractor: 'conservative-js-calls' }); continue; }
      }
      const matches = byName.get(name);
      if (matches && matches.length && matches.length <= 8) {
        addEdge({ type: 'calls', source: from, target: matches[0], tier: 'ambiguous', candidates: matches.slice(0, 8), resolved: false, confidence: .3, extractor: 'conservative-js-calls' });
        continue;
      }
      unresolvedCalls += 1;
    }
  }
}
sources.clear();

const pythonFiles = files.filter(file => extname(file) === '.py');
if (pythonFiles.length) {
  const script = `import ast,json,sys\nr=[]\nclass Scan(ast.NodeVisitor):\n def __init__(self): self.imports=[]; self.symbols=[]; self.scope=[]\n def visit_Import(self,n): self.imports += [{'specifier':a.name,'line':n.lineno,'standard':a.name.split('.')[0] in sys.stdlib_module_names} for a in n.names]\n def visit_ImportFrom(self,n): self.imports.append({'specifier':'.'*n.level+(n.module or ''),'line':n.lineno,'standard':n.level==0 and (n.module or '').split('.')[0] in sys.stdlib_module_names})\n def symbol(self,n,kind):\n  q='.'.join(self.scope+[n.name]); self.symbols.append({'name':n.name,'qualifiedName':q,'kind':kind,'line':n.lineno}); self.scope.append(n.name); self.generic_visit(n); self.scope.pop()\n def visit_ClassDef(self,n): self.symbol(n,'class')\n def visit_FunctionDef(self,n): self.symbol(n,'function')\n def visit_AsyncFunctionDef(self,n): self.symbol(n,'function')\nfor p in json.load(sys.stdin):\n try:\n  s=Scan(); s.visit(ast.parse(open(p,encoding='utf-8').read(),filename=p)); r.append({'path':p,'imports':s.imports,'symbols':s.symbols})\n except (OSError,SyntaxError) as e: r.append({'path':p,'error':str(e)})\nprint(json.dumps(r))`;
  const parsed = spawnSync('python3', ['-c', script], { input: JSON.stringify(pythonFiles), encoding: 'utf8' });
  if (parsed.status !== 0) warnings.push(`Python AST unavailable: ${(parsed.stderr || 'python3 failed').trim()}`);
  else for (const result of JSON.parse(parsed.stdout)) { if (result.error) { warnings.push(`${posix(relative(root, result.path))}: ${result.error}`); continue; } for (const item of result.imports) addDependency(result.path, item.specifier, item.line, 'python', item.standard); for (const item of result.symbols) { const rel = posix(relative(root, result.path)), id = `symbol:${rel}#${item.kind}:${item.qualifiedName}`; addNode({ id, type: 'symbol', ...item, label: item.qualifiedName, path: rel, confidence: 1, extractor: 'python-stdlib-ast', contentHash: hash(`${item.kind}:${item.qualifiedName}`) }); addEdge({ type: 'defines', source: fileId(result.path), target: id, line: item.line, resolved: true, confidence: 1, extractor: 'python-stdlib-ast' }); } }
}

const revisionResult = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const sortedNodes = [...nodes.values()].sort((a,b) => a.id.localeCompare(b.id)), sortedEdges = [...edges.entries()].sort((a,b) => a[0].localeCompare(b[0])).map(([, edge]) => edge);
const sourceHash = hash(sortedNodes.filter(n => n.type === 'file').map(n => `${n.id}:${n.contentHash}`).join('\n'));
const graph = { schemaVersion: 2, project: basename(root), revision: revisionResult.status === 0 ? revisionResult.stdout.trim() : null, sourceHash, provenance: { tool: 'genesis-graphizer', method: 'static-analysis', confidenceScale: '0..1' }, nodes: sortedNodes, edges: sortedEdges, warnings: warnings.sort(), stats: { unresolvedCalls } };
const json = `${JSON.stringify(graph, null, 2)}\n`, escDot = value => String(value).replaceAll('\\','\\\\').replaceAll('"','\\"');
const dot = `digraph genesis {\n  rankdir=LR;\n  node [shape=box,fontname="system-ui"];\n${sortedNodes.map(n => `  "${escDot(n.id)}" [label="${escDot(n.label)}",class="${n.type}"];`).join('\n')}\n${sortedEdges.map(e => `  "${escDot(e.source)}" -> "${escDot(e.target)}" [label="${e.type}"];`).join('\n')}\n}\n`;
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(graph.project)} code graph</title><style>body{font:14px system-ui;margin:2rem;color:#172033;background:#f7f8fa}header{display:flex;gap:1rem;align-items:baseline;flex-wrap:wrap}input{padding:.6rem;min-width:20rem}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(22rem,1fr));gap:1rem}.card{background:white;border:1px solid #d9deea;border-radius:10px;padding:1rem}.node{padding:.45rem;border-left:4px solid #748ffc;margin:.35rem 0;background:#f8f9ff}.package{border-color:#2f9e44}.unresolved{border-color:#e8590c}.symbol{border-color:#7950f2}small{color:#667085}code{word-break:break-all}</style><header><h1>${esc(graph.project)}</h1><small>${sortedNodes.length} nodes · ${sortedEdges.length} edges · ${sourceHash.slice(0,12)}</small><input id="q" type="search" placeholder="Filter paths, symbols, packages" aria-label="Filter graph"></header><section><div class="card"><h2>Nodes</h2>${sortedNodes.map(n => `<div class="node ${n.type}" data-search="${esc(`${n.id} ${n.label}`.toLowerCase())}"><strong>${esc(n.label)}</strong> <small>${n.type} · ${n.confidence}</small><br><code>${esc(n.id)}</code></div>`).join('')}</div><div class="card"><h2>Relationships</h2>${sortedEdges.map(e => `<div class="node" data-search="${esc(`${e.source} ${e.target} ${e.specifier ?? ''}`.toLowerCase())}"><code>${esc(e.source)}</code> → <code>${esc(e.target)}</code><br><small>${e.type}${e.specifier ? ` · ${esc(e.specifier)}` : ''}</small></div>`).join('')}</div></section><script>q.oninput=()=>document.querySelectorAll('[data-search]').forEach(e=>e.hidden=!e.dataset.search.includes(q.value.toLowerCase()))</script></html>\n`;
function writeChanged(path, content) { if (existsSync(path) && readFileSync(path,'utf8') === content) return false; writeFileSync(path,content); return true; }
const placeholder = existsSync(outPath) && readFileSync(outPath,'utf8').includes('{{');
if (write || placeholder) { mkdirSync(outDir,{recursive:true}); const changed = [writeChanged(outPath,json),writeChanged(join(outDir,'graph.dot'),dot),writeChanged(join(outDir,'graph.html'),html)].filter(Boolean).length; console.error(`${changed ? 'wrote' : 'unchanged'} ${sortedNodes.length} nodes, ${sortedEdges.length} edges -> ${posix(relative(root,outDir)) || '.'}`); }
else { process.stdout.write(json); console.error(`dry run: ${sortedNodes.length} nodes, ${sortedEdges.length} edges; pass --write to save`); }
