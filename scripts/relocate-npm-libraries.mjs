#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, cpSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { libraries, root } from './npm-libraries.mjs';
import { pinLibraries } from './migrate-npm-libraries.mjs';

const destination = resolve(process.argv[2] ?? join(root, '../pair-x1'));
mkdirSync(destination, { recursive: true });
for (const library of libraries) {
    const source = join(root, 'packages', library.directory), target = join(destination, library.directory);
    if (existsSync(target)) throw new Error(`Destination already exists: ${target}`);
    execFileSync('git', ['clone', '--local', source, target], { stdio: 'inherit' });
    execFileSync('git', ['remote', 'set-url', 'origin', `git@github.com:mushuanli/${library.directory}.git`], { cwd: target });
    const sourceManifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    const manifest = pinLibraries(sourceManifest); manifest.version = library.version;
    writeFileSync(join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    // Preserve release-related changes made since the source checkout's last commit.
    if (library.directory === 'vfs-ui') cpSync(join(source, 'vite.config.ts'), join(target, 'vite.config.ts'));
    execFileSync('pnpm', ['install', '--ignore-scripts', '--lockfile-only'], { cwd: target, stdio: 'inherit' });
    process.stdout.write(`Ready: ${target}\n`);
}
