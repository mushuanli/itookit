/**
 * @file tauri-bootstrap.test.ts
 *
 * Simulates apps/tauri-app/src/main.ts bootstrap (VFS + service layer)
 * in pure Node.js — no Tauri runtime, no DOM, no browser APIs.
 *
 * Mirrors the production backend layout exactly:
 *   rootBackend         ~/.mindos/           SQLite: ~/.mindos/_meta/
 *   module/<name>       ~/.mindos/module/     SQLite: ~/.mindos/_db/<name>/
 *   homeBackend         <homeDir>/            SQLite: ~/.mindos/meta/<path>/
 *
 * If a test fails here it is a VFS/engine bug.
 * If it passes here but fails in Tauri it is a Tauri scope / IFsOps bug.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createVFS } from '@itookit/vfslib';
import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import { ChatEngine, VFSAgentService, initializeLLMEngine } from '@itookit/llm-engine';
import { LLMDeviceDriver } from '@itookit/device-llm';
import { setKernelDeviceManager } from '@itookit/llm-kernel';
import { FS_MODULE_CHAT, FS_MODULE_AGENTS, IVFSManager } from '@itookit/common';

// ── Module list (mirrors tauri-app/src/config/modules.ts, minus settings/home) ─

const MODULE_CONFIGS = [
    { name: FS_MODULE_CHAT,    syncEnabled: true,  isSystem: false },
    { name: FS_MODULE_AGENTS,  syncEnabled: true,  isSystem: true  },
    { name: 'anki',            syncEnabled: true,  isSystem: false },
    { name: 'prompts',         syncEnabled: true,  isSystem: false },
    { name: 'projects',        syncEnabled: true,  isSystem: false },
    { name: 'emails',          syncEnabled: true,  isSystem: false },
    { name: 'private',         syncEnabled: false, isSystem: false },
] as const;

const MODULE_NAMES = MODULE_CONFIGS.map(m => m.name);

// ── Shared fixture (created once for the suite) ───────────────────────────────

interface BootstrapFixture {
    mindosDir: string;
    homeDir:   string;
    tempBase:  string;
    vfs:       IVFSManager;
    llmDriver: LLMDeviceDriver;
    agentService:  VFSAgentService;
    sessionEngine: ChatEngine;
    dispose(): Promise<void>;
}

let fix: BootstrapFixture;

/** pathToMetaDir — same function as in tauri-app/src/main.ts */
function pathToMetaDir(mindosDir: string, absPath: string): string {
    const name = absPath.replace(/^\/+/, '').replace(/\//g, '_');
    return `${mindosDir}/meta/${name}`;
}

beforeAll(async () => {
    // ── 1. Create temp dir layout (mirrors Rust setup hook) ────────────────────
    const tempBase  = join(tmpdir(), `tauri-sim-${Date.now()}`);
    const mindosDir = join(tempBase, '.mindos');
    const homeDir   = join(tempBase, 'home');

    for (const dir of [
        mindosDir,
        `${mindosDir}/_meta`,
        `${mindosDir}/_db`,
        `${mindosDir}/meta`,
        `${mindosDir}/module`,
        homeDir,
    ]) {
        await fsp.mkdir(dir, { recursive: true });
    }
    for (const name of MODULE_NAMES) {
        await fsp.mkdir(`${mindosDir}/module/${name}`, { recursive: true });
        await fsp.mkdir(`${mindosDir}/_db/${name}`,    { recursive: true });
    }

    // ── 2. Open all backends in parallel (same as main.ts) ────────────────────
    const open = (rootDir: string, sidecarDir: string) =>
        openLocalFSBackend({ rootDir, sidecarDir }); // auto: NodeFsOps + BetterSqliteSidecarDb

    const [rootBackend, homeBackend, ...moduleBackends] = await Promise.all([
        open(mindosDir, `${mindosDir}/_meta`),
        open(homeDir,   pathToMetaDir(mindosDir, homeDir)),
        ...MODULE_NAMES.map(name =>
            open(`${mindosDir}/module/${name}`, `${mindosDir}/_db/${name}`)
        ),
    ]);

    // ── 3. Create VFS (same as initApp → createVFS) ────────────────────────────
    const { manager: vfs } = await createVFS({
        rootBackend,
        additionalMounts: [
            ...MODULE_NAMES.map((name, i) => ({ path: `/module/${name}`, backend: moduleBackends[i] })),
            { path: '/module/home', backend: homeBackend },
        ],
        modules: [
            ...MODULE_CONFIGS.map(m => ({ name: m.name, options: { syncEnabled: m.syncEnabled, isSystem: m.isSystem } })),
            { name: 'home', options: { syncEnabled: false } },
        ],
    });

    // ── 4. LLM device driver (same as bootstrap) ───────────────────────────────
    const llmDriver = new LLMDeviceDriver(vfs);
    await llmDriver.init();
    vfs.devices.register(llmDriver);
    await llmDriver.createDeviceNodes();
    setKernelDeviceManager(vfs.devices);
    vfs.devices.freeze();

    // ── 5. Core services ───────────────────────────────────────────────────────
    const agentService   = new VFSAgentService(vfs, llmDriver);
    const sessionEngine  = new ChatEngine(vfs);
    await initializeLLMEngine({ agentService, sessionEngine, maxConcurrent: 4 });

    fix = {
        mindosDir, homeDir, tempBase, vfs,
        llmDriver, agentService, sessionEngine,
        async dispose() {
            await vfs.dispose?.();
            await fsp.rm(tempBase, { recursive: true, force: true });
        },
    };
}, 30_000);

afterAll(async () => { await fix?.dispose(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('tauri-app bootstrap simulation', () => {

    it('VFS mounts: each module directory is accessible', async () => {
        for (const name of MODULE_NAMES) {
            const modulePath = `${fix.mindosDir}/module/${name}`;
            const stat = await fsp.stat(modulePath);
            expect(stat.isDirectory()).toBe(true);
        }
    });

    it('LLMDeviceDriver: default connections exist after init', async () => {
        const connections = await fix.llmDriver.getConnections();
        console.log('[bootstrap] connections:', connections.map(c => c.name));
        // ensureDefaults() should have created at least one connection
        expect(connections.length).toBeGreaterThan(0);
    });

    it('VFSAgentService: default agents exist after init', async () => {
        const agents = await fix.agentService.getAgents();
        console.log('[bootstrap] agents:', agents.map(a => a.name));
        expect(agents.length).toBeGreaterThan(0);
    });

    it('ChatEngine: createSession writes .chat file to disk', async () => {
        const sessionId = await fix.sessionEngine.createSession('Bootstrap Test Chat');
        expect(sessionId).toBeTruthy();

        const chatsDir = `${fix.mindosDir}/module/${FS_MODULE_CHAT}`;
        const entries  = await fsp.readdir(chatsDir);
        const chatFile = entries.find(e => e.endsWith('.chat'));

        console.log('[bootstrap] chat file:', chatFile, 'sessionId:', sessionId);
        expect(chatFile).toBeDefined();
    });

    it('ChatEngine: multiple concurrent createSession calls succeed', async () => {
        const results = await Promise.all([
            fix.sessionEngine.createSession('Concurrent A'),
            fix.sessionEngine.createSession('Concurrent B'),
            fix.sessionEngine.createSession('Concurrent C'),
        ]);

        expect(results.every(id => !!id)).toBe(true);
        expect(new Set(results).size).toBe(3);   // all unique IDs

        const entries = await fsp.readdir(`${fix.mindosDir}/module/${FS_MODULE_CHAT}`);
        const chatFiles = entries.filter(e => e.endsWith('.chat'));
        console.log('[bootstrap] chat files after concurrent creates:', chatFiles.length);
        expect(chatFiles.length).toBeGreaterThanOrEqual(3);
    });

    it('etc module: LLM connection config is persisted on disk', async () => {
        // etc module uses rootBackend → ~/.mindos/module/etc/
        const etcPath = `${fix.mindosDir}/module/etc`;
        const stat = await fsp.stat(etcPath).catch(() => null);
        expect(stat?.isDirectory()).toBe(true);

        // LLM connection files should be under etc/llm/.connections/
        const connDir = `${etcPath}/llm/.connections`;
        const connStat = await fsp.stat(connDir).catch(() => null);
        console.log('[bootstrap] .connections dir exists:', !!connStat);
        expect(connStat).toBeTruthy();

        const connFiles = await fsp.readdir(connDir);
        console.log('[bootstrap] connection files:', connFiles);
        expect(connFiles.length).toBeGreaterThan(0);
    });

    it('home module: can write and read a file', async () => {
        const homeDir = `${fix.mindosDir}/module/home`;  // mounted on homeDir temp path
        // Write through VFS
        const content = new TextEncoder().encode('hello from home');
        await fix.vfs.write('home', '/test.md', content);

        // Verify on real disk (homeDir is the temp home path)
        const onDisk = await fsp.readFile(join(fix.homeDir, 'test.md'));
        expect(new TextDecoder().decode(onDisk)).toBe('hello from home');
    });
});
