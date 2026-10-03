import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../packages/llm-ui/', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const removed = ['driver-llm', 'tools', 'kernel-adapters', 'llm-tasks'].map(name => '@itookit/' + name);

function graph(entry, declarations = false) {
    const seen = new Map();
    function visit(file) {
        if (seen.has(file)) return;
        const source = readFileSync(file, 'utf8'); seen.set(file, source);
        for (const match of source.matchAll(/(?:from\s*|import\s*|import\()["'](\.[^"']+)["']/g)) {
            let next = resolve(dirname(file), match[1]);
            if (declarations) next = next.replace(/\.js$/, '.d.ts');
            if (existsSync(next)) visit(next);
        }
    }
    visit(resolve(root, 'dist', entry)); return [...seen.values()].join('\n');
}

for (const name of removed) assert.ok(!manifest.dependencies[name], `${name} must remain a development contract dependency`);
for (const entry of ['llm-ui.js', 'chat.js', 'startup.js']) {
    const source = graph(entry);
    assert.doesNotMatch(source, /getSessionManager|legacySessionView|@itookit\/llm-settings-ui|AgentConfigEditor/, `${entry}: default UI must not load compatibility or settings`);
    for (const name of removed) assert.ok(!source.includes(name), `${entry}: removed dependency ${name} leaked into JavaScript`);
}
for (const entry of ['index.d.ts', 'chat.d.ts', 'startup.d.ts', 'settings.d.ts', 'legacy.d.ts']) {
    const source = graph(entry, true);
    for (const name of removed) assert.ok(!source.includes(name), `${entry}: removed dependency ${name} leaked into declarations`);
}
process.stdout.write('LLM UI default entries and embedded contract declarations passed.\n');
