#!/usr/bin/env node
// Deterministic, read-only, zero-dependency source indexer.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

const argv = process.argv.slice(2), rootArg = argv[0];
const full = argv.includes('--full');
if (!rootArg) { console.error('usage: node graphizer.mjs <repo-root> [--out <path>] [--write] [--full]'); process.exit(1); }
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

// --- extraction, cached per file ------------------------------------------------
// Change is detected by size and mtime rather than by hashing, because hashing means reading
// every file, which is the thing incremental indexing exists to avoid. A file whose stat is
// unchanged is never opened; its previous extraction is reused verbatim.
const cachePath = join(outDir, 'cache.json');
const CACHE_VERSION = 1;
let cache = {};
// Strict JSON.parse, never the JSONC reader: this file is ours, it is megabytes, and that
// reader walks character by character building a string, which is quadratic at this size.
if (!full && existsSync(cachePath)) { try { const loaded = JSON.parse(readFileSync(cachePath, 'utf8')); if (loaded.version === CACHE_VERSION) cache = loaded.files || {}; } catch { cache = {}; } }
const nextCache = {};
let reused = 0, extracted = 0;

function extractJs(source) {
  const symbols = jsSymbols(source), lines = source.split('\n');
  const imports = [];
  let match; jsImport.lastIndex = 0;
  while ((match = jsImport.exec(source))) imports.push({ specifier: match[1], line: source.slice(0, match.index).split('\n').length });
  const bindings = [];
  importClause.lastIndex = 0;
  while ((match = importClause.exec(source))) for (const binding of bindingsOf(match[1])) bindings.push({ local: binding.local, imported: binding.imported, specifier: match[2] });
  // Call names are recorded unresolved: which definition a name refers to depends on the whole
  // file set, so resolution has to run globally even when extraction is reused.
  const calls = [];
  for (let index = 0; index < symbols.length; index++) {
    const symbol = symbols[index];
    const end = index + 1 < symbols.length ? symbols[index + 1].line - 1 : lines.length;
    const body = lines.slice(symbol.line - 1, end).join('\n');
    const names = [], seen = new Set();
    let call; callSite.lastIndex = 0;
    while ((call = callSite.exec(body))) {
      const name = call[1];
      if (CALL_KEYWORDS.has(name) || name === symbol.name || seen.has(name)) continue;
      seen.add(name); names.push(name);
    }
    const inherit = extendsSite.exec(lines[symbol.line - 1] || '');
    calls.push({ names, inherits: inherit ? inherit[1] : null });
  }
  return { symbols, imports, bindings, calls };
}

const pythonScript = `import ast,json,sys
r=[]
class Scan(ast.NodeVisitor):
 def __init__(self): self.imports=[]; self.symbols=[]; self.calls=[]; self.bindings=[]; self.scope=[]; self.current=None
 def visit_Import(self,n):
  for a in n.names:
   self.imports.append({'specifier':a.name,'line':n.lineno,'standard':a.name.split('.')[0] in sys.stdlib_module_names})
   self.bindings.append({'local':(a.asname or a.name).split('.')[0],'imported':'*','specifier':a.name})
 def visit_ImportFrom(self,n):
  spec='.'*n.level+(n.module or '')
  self.imports.append({'specifier':spec,'line':n.lineno,'standard':n.level==0 and (n.module or '').split('.')[0] in sys.stdlib_module_names})
  for a in n.names: self.bindings.append({'local':a.asname or a.name,'imported':a.name,'specifier':spec})
 def symbol(self,n,kind,inherits=None):
  q='.'.join(self.scope+[n.name]); i=len(self.symbols)
  self.symbols.append({'name':n.name,'qualifiedName':q,'kind':kind,'line':n.lineno}); self.calls.append({'names':[],'inherits':inherits})
  prev=self.current; self.current=i; self.scope.append(n.name); self.generic_visit(n); self.scope.pop(); self.current=prev
 def visit_Call(self,n):
  f=n.func; name=f.id if isinstance(f,ast.Name) else (f.attr if isinstance(f,ast.Attribute) else None)
  if name and self.current is not None:
   names=self.calls[self.current]['names']
   if name not in names: names.append(name)
  self.generic_visit(n)
 def visit_ClassDef(self,n):
  bases=[b.id for b in n.bases if isinstance(b,ast.Name)]
  self.symbol(n,'class',bases[0] if bases else None)
 def visit_FunctionDef(self,n): self.symbol(n,'function')
 def visit_AsyncFunctionDef(self,n): self.symbol(n,'function')
for p in json.load(sys.stdin):
 try:
  s=Scan(); s.visit(ast.parse(open(p,encoding='utf-8').read(),filename=p)); r.append({'path':p,'imports':s.imports,'symbols':s.symbols,'calls':s.calls,'bindings':s.bindings})
 except (OSError,SyntaxError) as e: r.append({'path':p,'error':str(e)})
print(json.dumps(r))`;

const entries = new Map();      // rel -> { path, language, contentHash, symbols, imports, bindings, calls, error }
const stalePython = [];
for (const path of files) {
  const rel = posix(relative(root, path)), python = extname(path) === '.py';
  let stat; try { stat = statSync(path); } catch { continue; }
  const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`;
  const hit = cache[rel];
  if (hit && hit.stamp === stamp) { entries.set(rel, { ...hit.data, path, language: python ? 'python' : 'javascript', contentHash: hit.contentHash }); nextCache[rel] = hit; reused += 1; continue; }
  extracted += 1;
  if (python) { stalePython.push({ path, rel, stamp }); continue; }
  const source = readFileSync(path, 'utf8');
  const data = extractJs(source), contentHash = hash(source);
  entries.set(rel, { ...data, path, language: 'javascript', contentHash });
  nextCache[rel] = { stamp, contentHash, data };
}
if (stalePython.length) {
  const parsed = spawnSync('python3', ['-c', pythonScript], { input: JSON.stringify(stalePython.map(item => item.path)), encoding: 'utf8' });
  if (parsed.status !== 0) {
    // A missing or broken python3 costs symbols, not files. Every walked file still gets a node,
    // or the whole Python half of a repository silently disappears from the graph and from every
    // query built on it. Not cached, so the next run retries the extraction.
    warnings.push(`Python AST unavailable: ${(parsed.stderr || 'python3 failed').trim()}`);
    for (const item of stalePython) entries.set(item.rel, { symbols: [], imports: [], bindings: [], calls: [], path: item.path, language: 'python', contentHash: hash(readFileSync(item.path, 'utf8')) });
  }
  else {
    const results = new Map(JSON.parse(parsed.stdout).map(result => [result.path, result]));
    for (const item of stalePython) {
      const result = results.get(item.path) || {};
      const contentHash = hash(readFileSync(item.path, 'utf8'));
      const data = result.error ? { error: result.error, symbols: [], imports: [], bindings: [], calls: [] } : { symbols: result.symbols, imports: result.imports, bindings: result.bindings, calls: result.calls };
      entries.set(item.rel, { ...data, path: item.path, language: 'python', contentHash });
      nextCache[item.rel] = { stamp: item.stamp, contentHash, data };
    }
  }
}

// --- graph assembly, always over the whole file set ------------------------------
// Resolution is global even when extraction was reused: adding one file can resolve an import
// somewhere else, or turn a proven call into an ambiguous one.
const fileSymbols = new Map(), fileImports = new Map();
for (const [rel, entry] of entries) {
  addNode({ id: `file:${rel}`, type: 'file', label: rel, path: rel, language: entry.language, confidence: 1, extractor: 'filesystem', contentHash: entry.contentHash });
  if (entry.error) { warnings.push(`${rel}: ${entry.error}`); continue; }
  const python = entry.language === 'python';
  const extractor = python ? 'python-stdlib-ast' : 'conservative-js-symbols';
  const named = entry.symbols.map(symbol => ({ ...symbol, name: python ? symbol.qualifiedName : symbol.name }));
  fileSymbols.set(rel, named);
  for (const symbol of named) {
    const id = `symbol:${rel}#${symbol.kind}:${symbol.name}`;
    addNode({ id, type: 'symbol', kind: symbol.kind, name: symbol.name, label: symbol.name, path: rel, line: symbol.line, confidence: python ? 1 : .8, extractor, contentHash: hash(`${symbol.kind}:${symbol.name}`) });
    addEdge({ type: 'defines', source: `file:${rel}`, target: id, line: symbol.line, resolved: true, confidence: python ? 1 : .8, extractor });
  }
  for (const item of entry.imports) addDependency(entry.path, item.specifier, item.line, entry.language, item.standard);
  const imports = new Map();
  for (const binding of entry.bindings) {
    const target = python ? resolvePythonImport(entry.path, binding.specifier) : resolveJsImport(entry.path, binding.specifier);
    if (target) imports.set(binding.local, { file: posix(relative(root, target)), imported: binding.imported });
  }
  fileImports.set(rel, imports);
}

// Three tiers of truth, borrowed from Benzi's description: a call resolved to one definition is
// proven; a call whose name matches several definitions keeps every candidate rather than being
// collapsed into a confident guess; a call that resolves to nothing is counted, never invented.
// Indexed per language: a JavaScript call must never resolve to a Python definition that happens
// to share a name.
const byLanguage = { javascript: new Map(), python: new Map() };
for (const [rel, symbols] of fileSymbols) {
  const index = byLanguage[entries.get(rel).language];
  for (const symbol of symbols) {
    // Python symbols are stored qualified (Class.method); index the bare name too, since that is
    // what a call site actually writes.
    for (const key of new Set([symbol.name, symbol.name.split('.').pop()])) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(`symbol:${rel}#${symbol.kind}:${symbol.name}`);
    }
  }
}
const symbolId = (rel, name) => {
  const symbols = fileSymbols.get(rel) || [];
  const found = symbols.find(s => s.name === name) || symbols.find(s => s.name.split('.').pop() === name);
  return found ? `symbol:${rel}#${found.kind}:${found.name}` : null;
};
const callExtractor = language => language === 'python' ? 'python-stdlib-ast-calls' : 'conservative-js-calls';
let unresolvedCalls = 0;
for (const [rel, entry] of entries) {
  if (!entry.calls || !entry.calls.length) continue;
  const symbols = fileSymbols.get(rel) || [], imports = fileImports.get(rel) || new Map();
  const byName = byLanguage[entry.language], confident = entry.language === 'python' ? 1 : .75;
  for (let index = 0; index < entry.calls.length; index++) {
    const symbol = symbols[index];
    if (!symbol) continue;
    const from = `symbol:${rel}#${symbol.kind}:${symbol.name}`, site = entry.calls[index];
    if (site.inherits) {
      const binding = imports.get(site.inherits);
      const parent = binding ? symbolId(binding.file, site.inherits) : symbolId(rel, site.inherits);
      if (parent && parent !== from) addEdge({ type: 'inherits', source: from, target: parent, tier: 'proven', resolved: true, confidence: entry.language === 'python' ? 1 : .8, extractor: callExtractor(entry.language) });
    }
    for (const name of site.names) {
      const local = symbolId(rel, name);
      if (local) { addEdge({ type: 'calls', source: from, target: local, tier: 'proven', resolved: true, confidence: confident, extractor: callExtractor(entry.language) }); continue; }
      const binding = imports.get(name);
      if (binding) {
        const target = symbolId(binding.file, binding.imported === 'default' || binding.imported === '*' ? name : binding.imported);
        if (target) { addEdge({ type: 'calls', source: from, target, tier: 'proven', resolved: true, confidence: .7, extractor: callExtractor(entry.language) }); continue; }
      }
      const matches = byName.get(name);
      if (matches && matches.length && matches.length <= 8) { addEdge({ type: 'calls', source: from, target: matches[0], tier: 'ambiguous', candidates: matches.slice(0, 8), resolved: false, confidence: .3, extractor: callExtractor(entry.language) }); continue; }
      unresolvedCalls += 1;
    }
  }
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
if (write || placeholder) { mkdirSync(outDir,{recursive:true}); writeChanged(cachePath, JSON.stringify({ version: CACHE_VERSION, files: nextCache })); const changed = [writeChanged(outPath,json),writeChanged(join(outDir,'graph.dot'),dot),writeChanged(join(outDir,'graph.html'),html)].filter(Boolean).length; console.error(`${changed ? 'wrote' : 'unchanged'} ${sortedNodes.length} nodes, ${sortedEdges.length} edges (${extracted} extracted, ${reused} reused) -> ${posix(relative(root,outDir)) || '.'}`); }
else { process.stdout.write(json); console.error(`dry run: ${sortedNodes.length} nodes, ${sortedEdges.length} edges; pass --write to save`); }
