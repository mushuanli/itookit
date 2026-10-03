#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../packages/kernel-adapters/dist/', import.meta.url));

/** Follow emitted local modules; external package imports remain visible for boundary checks. */
function graph(entry) {
    const modules = new Map();
    function visit(file) {
        if (modules.has(file)) return;
        const source = readFileSync(file, 'utf8');
        modules.set(file, source);
        for (const match of source.matchAll(/(?:from\s*|import\s*|require\()["'](\.\.?\/[^"']+)["']/g))
            visit(resolve(dirname(file), match[1]));
    }
    visit(resolve(dist, entry));
    return modules;
}

for (const format of ['js', 'cjs']) {
    const codec = graph(`llm-config.${format}`);
    assert.doesNotMatch([...codec.values()].join('\n'), /LLMDeviceDriver|HostMCPTransport|LLM_PROVIDERS|@itookit\/vfs-core|@modelcontextprotocol/,
        `${format}: config entry must not load management runtime or product catalogs`);
    const core = graph(`llm-core.${format}`);
    assert.doesNotMatch([...core.values()].join('\n'), /LLM_PROVIDERS|DEFAULT_AGENTS|MODEL_PRICING/,
        `${format}: core entry must not load product catalogs`);
    const host = graph(`llm-mcp-host.${format}`);
    const registry = [...host.entries()].filter(([, source]) => source.includes('var hostFactory'));
    assert.equal(registry.length, 1, `${format}: host bridge must have one registry`);
    assert.ok(graph(`llm.${format}`).has(registry[0][0]),
        `${format}: compatibility driver and host entry must share the legacy registry`);
    assert.doesNotMatch([...core.values()].join('\n'), /hostFactory|registerMCPStdioHost|snapshotMCPStdioHost/,
        `${format}: core must not load the legacy host registry`);
}
process.stdout.write('LLM ESM/CJS entry boundaries and instance MCP isolation passed.\n');
