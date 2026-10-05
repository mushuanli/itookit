#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { libraries, root, versions } from './npm-libraries.mjs';

export function pinLibraries(manifest) {
    const result = structuredClone(manifest);
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
        if (!result[section]) continue;
        for (const name of Object.keys(result[section])) {
            if (versions.has(name)) result[section][name] = versions.get(name);
        }
    }
    return result;
}
function manifests() {
    const skipped = new Set(libraries.map(library => library.directory));
    const paths = [join(root, 'package.json')];
    for (const group of ['packages', 'apps']) {
        for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
            if (!entry.isDirectory() || (group === 'packages' && skipped.has(entry.name))) continue;
            paths.push(join(root, group, entry.name, 'package.json'));
        }
    }
    return paths;
}
function verifyPublished() {
    for (const library of libraries) {
        const version = execFileSync('npm', ['view', `${library.name}@${library.version}`, 'version', '--json'], { encoding: 'utf8' });
        const published = JSON.parse(version);
        if (!(Array.isArray(published) ? published : [published]).includes(library.version)) throw new Error(`Not available: ${library.name}@${library.version}`);
    }
}
function apply() {
    verifyPublished();
    for (const path of manifests()) {
        let original;
        try { original = readFileSync(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        const manifest = JSON.parse(original), pinned = pinLibraries(manifest);
        if (JSON.stringify(manifest) === JSON.stringify(pinned)) continue;
        writeFileSync(path, JSON.stringify(pinned, null, path === join(root, 'package.json') ? 4 : 2) + '\n');
    }
    const workspace = join(root, 'pnpm-workspace.yaml');
    let text = readFileSync(workspace, 'utf8');
    const exclusions = libraries.map(library => `  - '!packages/${library.directory}'`).filter(line => !text.includes(line));
    text = text.replace('  - apps/*', '  - apps/*\n' + exclusions.join('\n'));
    writeFileSync(workspace, text);
    process.stdout.write('Registry versions pinned; run pnpm install, then validate before removing source checkouts.\n');
}
if (process.argv[1]?.endsWith('/migrate-npm-libraries.mjs')) {
    if (process.argv[2] === 'apply') apply();
    else throw new Error('Usage: node scripts/migrate-npm-libraries.mjs apply');
}
