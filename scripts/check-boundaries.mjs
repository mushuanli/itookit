#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import ts from 'typescript';

const application = new Set(['@itookit/app-core', '@itookit/app-shell', '@itookit/app-settings']);
const coreDependencies = new Set(['common', 'llm-context', 'vfs-core', 'durable-kernel', 'kernel-adapters',
    'llm-flow', 'llm-session', 'llm-tasks', 'tools', 'driver-llm'].map(name => '@itookit/' + name));
const browserGlobals = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'navigator',
    'Window', 'Document', 'Element', 'Node', 'MutationObserver', 'ResizeObserver']);

export function dependencyError(source, target) {
    if (source === target) return;
    if (source === '@itookit/common' && target.startsWith('@itookit/')) return 'common must not depend on capability packages';
    if (source === '@itookit/ui-common' && target.startsWith('@itookit/') && !['@itookit/common', '@itookit/vfs-core'].includes(target)) return 'shared UI must receive domain data through generic ports';
    if (source === '@itookit/kernel-adapters' && ['@itookit/llm-tasks', '@itookit/llm-flow', '@itookit/llm-session'].includes(target)) return 'adapters must not depend on execution or conversation layers';
    if (['@itookit/tools', '@itookit/device-tty', '@itookit/llm-tasks', '@itookit/llm-flow', '@itookit/llm-session'].includes(source) &&
        ['@itookit/common', '@itookit/llm-common'].includes(target)) return 'execution capabilities must use owned contracts and injected ports';
    if (source === '@itookit/driver-llm' && target !== '@itookit/llm-context') return 'driver-llm must receive host capabilities through its public ports';
    if (source === '@itookit/llm-context') return 'llm-context must receive I/O through its public ports';
    if (source === '@itookit/mdxeditor' && target.startsWith('@itookit/')) return 'mdxeditor must receive host capabilities through its public ports';
    if (source === '@itookit/vfs-ui' && target !== '@itookit/vfs-core') return 'vfs-ui must not depend on host packages; use its public ports';
    if (source === '@itookit/app-core' && !coreDependencies.has(target)) return 'app-core may only depend on its platform-neutral capabilities';
    if (source !== '@itookit/app-shell' && application.has(target)) return 'capability packages must not depend on application packages';
}

export function manifestDependencyError(source, target) {
    if (source === '@itookit/driver-llm') return 'driver-llm published manifest must have no runtime dependencies';
    return dependencyError(source, target);
}

function publicSubpath(pkg, subpath) {
    if (subpath === '.') return true;
    return Object.keys(pkg.exports ?? {}).some(key => {
        const [prefix, suffix] = key.split('*');
        return key.includes('*') ? subpath.startsWith(prefix) && subpath.endsWith(suffix) : key === subpath;
    });
}

function ownerOf(file, packages) {
    return packages.find(pkg => file === pkg.dir || file.startsWith(pkg.dir + sep));
}

export function importError(source, file, specifier, packages) {
    if (source.name === '@itookit/llm-ui' && !['src/index.ts', 'src/settings.ts'].some(path => file === resolve(source.dir, path))) {
        if (specifier.startsWith('@itookit/llm-settings-ui') || (specifier.startsWith('.') && resolve(file, '..', specifier).replace(/\.ts$/, '') === resolve(source.dir, 'src/settings')))
            return 'chat and shared UI must not load optional settings implementations';
    }
    if (source.name === '@itookit/llm-settings-ui' && specifier === '@itookit/kernel-adapters/llm')
        return 'settings UI must use config codecs, contracts or explicit host ports; not the management aggregate';
    if (source.name === '@itookit/llm-ui' && /\.flow(?:\?raw)?$/.test(specifier))
        return 'UI must receive Flow template catalogs from the host';
    if (source.name === '@itookit/llm-ui' && file !== resolve(source.dir, 'src/index.ts') && specifier === '@itookit/llm-session')
        return 'chat UI must use session contracts and injected views; globals belong to the compatibility entry';
    if (source.name === '@itookit/app-core' && (specifier.startsWith('node:') || builtinModules.includes(specifier))) return 'app-core must receive native capabilities through injected ports';
    if (specifier.startsWith('.')) {
        const target = ownerOf(resolve(file, '..', specifier), packages);
        return target && target !== source ? 'cross-package relative imports bypass public exports' : undefined;
    }
    if (['@itookit/app-core', '@itookit/driver-llm', '@itookit/llm-context'].includes(source.name) &&
        !specifier.startsWith('node:') && !builtinModules.includes(specifier)) {
        const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
        const error = dependencyError(source.name, name);
        if (error) return error;
    }
    const target = packages.find(pkg => specifier === pkg.name || specifier.startsWith(pkg.name + '/'));
    if (!target) return;
    if (target.host && !source.host) return 'packages must not depend on app hosts';
    const direction = source.host ? undefined : dependencyError(source.name, target.name);
    if (direction) return direction;
    const subpath = specifier === target.name ? '.' : '.' + specifier.slice(target.name.length);
    if (!publicSubpath(target, subpath)) return 'import must use a declared package export';
}

function moduleSpecifier(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return node.argument.literal;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) return node.arguments[0];
    if (ts.isExternalModuleReference(node)) return node.expression;
}

function browserReference(node) {
    if (!ts.isIdentifier(node)) return false;
    if (!browserGlobals.has(node.text) && !/^HTML\w*Element$/.test(node.text)) return false;
    const parent = node.parent;
    if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return parent.expression.getText() === 'globalThis';
    return true;
}

export function sourceErrors(source, file, text, packages) {
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const errors = [];
    const report = (node, message) => errors.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${message}`);
    const visit = node => {
        const specifier = moduleSpecifier(node);
        if (specifier && ts.isStringLiteralLike(specifier)) {
            const error = importError(source, file, specifier.text, packages);
            if (error) report(node, `${error} (${specifier.text})`);
            if (source.name === '@itookit/driver-llm' && specifier.text === '@itookit/llm-context' &&
                ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
                    (ts.isExportDeclaration(node) && !node.isTypeOnly))) {
                report(node, 'driver-llm may only use neutral message contracts through type imports');
            }
        }
        if (['@itookit/kernel-adapters', '@itookit/llm-session', '@itookit/llm-ui', '@itookit/llm-settings-ui'].includes(source.name) &&
            ts.isIdentifier(node) && node.text === 'DEFAULT_HARNESS_TOOL_IDS')
            report(node, 'MindOS default tool grants belong to the host; capabilities receive injected policy');
        if (source.name === '@itookit/app-core' && browserReference(node)) report(node, 'app-core must not reference DOM or browser storage');
        if (source.name === '@itookit/app-core' && file === resolve(source.dir, 'src/index.ts') &&
            ts.isExportDeclaration(node) && !node.exportClause) report(node, 'app-core public exports must be explicit');
        ts.forEachChild(node, visit);
    };
    visit(ast);
    return errors;
}

async function filesIn(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
    });
    const files = await Promise.all(entries.map(entry => entry.isDirectory() ? filesIn(resolve(dir, entry.name)) : resolve(dir, entry.name)));
    return files.flat().filter(file => /\.[cm]?[jt]sx?$/.test(file));
}

async function readPackages(root, group) {
    const entries = await readdir(resolve(root, group), { withFileTypes: true });
    const packages = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
        const dir = resolve(root, group, entry.name);
        // The historical demo lives under packages but is an executable Vite host.
        try { return { ...JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8')), dir, host: group === 'apps' || (group === 'packages' && entry.name === 'demo') }; }
        catch (error) { if (error.code === 'ENOENT') return; throw error; }
    }));
    return packages.filter(Boolean);
}

export async function checkBoundaries(root) {
    const packages = (await Promise.all(['packages', 'apps'].map(group => readPackages(root, group)))).flat();
    const errors = [];
    for (const pkg of packages) {
        for (const name of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
            const target = packages.find(candidate => candidate.name === name);
            if (pkg.host) continue;
            const error = target?.host ? 'packages must not depend on app hosts' : manifestDependencyError(pkg.name, name);
            if (error) errors.push(`${relative(root, pkg.dir)}/package.json: ${error} (${name})`);
        }
        for (const file of await filesIn(resolve(pkg.dir, 'src'))) {
            if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) continue;
            errors.push(...sourceErrors(pkg, file, await readFile(file, 'utf8'), packages));
        }
    }
    return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const errors = await checkBoundaries(root);
    if (errors.length) { process.stderr.write(errors.join('\n') + '\n'); process.exitCode = 1; }
    else process.stdout.write('Architecture boundaries passed (production sources and dependencies).\n');
}
