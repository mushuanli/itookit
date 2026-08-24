/**
 * @file apps/tauri-app/src/main.ts
 *
 * Tauri-specific bootstrap:
 *  1. Resolve homeDir + rootDir via Tauri commands
 *       rootDir = resolved data root (settings.json#rootDir or <config>/data)
 *  2. Build backends:
 *       rootBackend  = LocalFSBackend at <rootDir>/        (all shared modules)
 *       homeBackend  = LocalFSBackend at <homeDir>         (local filesystem)
 *       meta sidecar = <rootDir>/meta/<path-derived-name>  (home + dynamic mounts)
 *  3. Hand off to app-shell (all common logic lives there)
 *  4. Wire tauri-only features: loading overlay, dynamic local mounts
 */

import { initApp, createWsMount, type AppUI } from '@itookit/app-shell';
import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import {
    createLLMFactory,
    createAgentEditorFactory,
    createFlowsEditorFactory,
    createSkillsEditorFactory,
    createAIContextMenuConfig,
    ProviderSettingsEditor,
    ConnectionSettingsEditor,
    MCPSettingsEditor,
    CostEditor,
    SystemPromptSettingsEditor,
} from '@itookit/llm-ui';
import { WORKSPACES } from './config/modules';
import { LocalMountService, MountEntry, MOUNT_EVENTS } from './services/local-mounts';
import { TauriSqlSidecarDb } from './db/tauri-sql-sidecar';
import { TauriFsOps } from './fs/tauri-fs-ops';
import { TauriLLMLogger } from './log/tauri-llm-logger';
import { TauriNativeShell } from './shell/tauri-native-shell';
import { TauriCodexTransport } from './shell/tauri-codex-transport';
import { TauriSkillToolHandlerFactory } from './kernel/tauri-skill-tools';
import { TauriSkillSource } from './kernel/tauri-skill-source';

import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import '@itookit/llm-ui/style.css';
import '@itookit/app-settings/style.css';
import './styles/index.css';

// ── Path helpers ───────────────────────────────────────────────────────────────

/**
 * Derive a stable sidecar directory path from an absolute filesystem path.
 * /Users/rain/Projects → <rootDir>/meta/Users_rain_Projects
 */
function pathToMetaDir(rootDir: string, absPath: string): string {
    const name = absPath.replace(/^\/+/, '').replace(/\//g, '_');
    return `${rootDir}/meta/${name}`;
}

// ── Loading overlay ────────────────────────────────────────────────────────────

function showLoading(msg: string): void {
    let el = document.getElementById('__boot-overlay');
    if (!el) {
        el = document.createElement('div');
        el.id = '__boot-overlay';
        el.style.cssText = [
            'position:fixed;inset:0;z-index:9999',
            'background:var(--bg-secondary,#f1f5f9)',
            'display:flex;flex-direction:column;align-items:center;justify-content:center',
            'font-family:var(--font-primary,sans-serif);gap:12px',
        ].join(';');
        el.innerHTML = `
            <div style="width:36px;height:36px;border:3px solid #ddd;border-top-color:var(--primary-color,#5B66F5);border-radius:50%;animation:spin 0.8s linear infinite"></div>
            <div id="__boot-msg" style="font-size:13px;color:#6b7280"></div>
            <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
        document.body.appendChild(el);
    }
    const msgEl = document.getElementById('__boot-msg');
    if (msgEl) msgEl.textContent = msg;
}

function hideLoading(): void {
    document.getElementById('__boot-overlay')?.remove();
}

function showError(msg: string): void {
    const el = document.getElementById('__boot-overlay');
    if (el) {
        el.innerHTML = `
            <div style="font-size:28px">⚠️</div>
            <div style="font-size:14px;font-weight:600;color:#111">启动失败</div>
            <div style="font-size:12px;color:#ef4444;max-width:400px;text-align:center;word-break:break-all">${msg}</div>
            <button onclick="location.reload()" style="margin-top:8px;padding:6px 16px;border-radius:6px;border:none;background:var(--primary-color,#5B66F5);color:#fff;cursor:pointer;font-size:13px">重试</button>`;
    } else {
        alert(`启动失败: ${msg}`);
    }
}

// ── Tauri path resolution ──────────────────────────────────────────────────────

async function getHomeDir(): Promise<string> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<string>('get_home_dir');
    } catch {
        return (globalThis as unknown as { __CWD__?: string }).__CWD__ ?? '.';
    }
}

/**
 * Returns the resolved VFS root directory.
 * Config lives at ~/.config/mindos/settings.json; the data root comes from
 * settings.json#rootDir, the MINDOS_ROOT env var, or ~/.config/mindos/data.
 */
async function getRootDir(): Promise<string> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<string>('get_root_dir');
    } catch {
        // Fallback for plain Vite dev (no Tauri context)
        const home = (globalThis as { process?: { env?: { HOME?: string } } })
            .process?.env?.HOME ?? '.';
        return `${home}/.config/mindos/data`;
    }
}

async function openDirectoryDialog(): Promise<string | null> {
    try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const result = await open({ directory: true, multiple: false });
        return typeof result === 'string' ? result : null;
    } catch {
        return null;
    }
}

// ── Dynamic mount DOM helpers ──────────────────────────────────────────────────

function injectMountWorkspace(entry: MountEntry): void {
    if (document.getElementById(entry.id + '-workspace')) return;

    const panel = document.createElement('div');
    panel.id = entry.id + '-workspace';
    panel.className = 'workspace-view';
    document.querySelector('.main-content-area')!.appendChild(panel);

    const li = document.createElement('li');
    li.dataset.mountId = entry.id;
    li.innerHTML = `
        <a class="app-nav-btn"
           data-target="${entry.id}-workspace"
           data-module="${entry.id}"
           title="${entry.label}">
            <i class="fas fa-hard-drive"></i>
            <span class="nav-remove" data-unmount="${entry.id}" title="Unmount">×</span>
        </a>`;
    const anchor = document.getElementById('nav-mounts-anchor')!;
    anchor.parentElement!.insertBefore(li, anchor.nextSibling);
}

function removeMountWorkspace(id: string): void {
    document.getElementById(id + '-workspace')?.remove();
    document.querySelector(`[data-mount-id="${id}"]`)?.remove();
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
    const t0 = performance.now();
    let t = t0;
    const log = (label: string) => {
        const now = performance.now();
        console.log(`[Boot] ${label}: +${(now - t).toFixed(0)}ms (total ${(now - t0).toFixed(0)}ms)`);
        t = now;
        showLoading(label);
    };

    log('正在初始化…');

    // 1. Resolve paths
    //    homeDir   = working project directory (CWD or --home arg)
    //    rootDir   = resolved data root (settings.json#rootDir, never ~/.mindos)
    const [homeDir, rootDir] = await Promise.all([getHomeDir(), getRootDir()]);
    log(`路径解析 (home=${homeDir})`);

    const dirName = homeDir.split('/').filter(Boolean).pop() ?? homeDir;
    const navLabel = document.getElementById('nav-home-label');
    if (navLabel) navLabel.textContent = dirName;
    const navBtn = document.getElementById('nav-home-btn');
    if (navBtn) navBtn.title = homeDir;
    const badge = document.getElementById('home-dir-label');
    if (badge) { badge.textContent = dirName; badge.title = homeDir; }

    // 2. Build backends
    //
    //  rootBackend          : <rootDir>/  — system paths only (/etc/, /dev/)
    //                         SQLite: <rootDir>/_meta/
    //  per-module backends  : <rootDir>/module/<name>/  — one SQLite each
    //                         SQLite: <rootDir>/_db/<name>/
    //  homeBackend          : <homeDir>  — transparent local FS
    //                         SQLite: <rootDir>/meta/<path-derived>/
    //
    // Each module gets its own SQLite to eliminate cross-module DB locking.

    const openBackend = (rootDir: string, sidecarDir: string) =>
        openLocalFSBackend({
            rootDir, sidecarDir,
            createDb: (dbPath) => TauriSqlSidecarDb.open(dbPath),
            createFs: () => new TauriFsOps(),
        });

    // Collect module names that need their own backend (skip settings/home)
    const moduleNames = WORKSPACES
        .filter(ws => ws.type !== 'settings' && ws.moduleName !== 'home')
        .map(ws => ws.moduleName);

    console.log(`[Boot] 创建 ${moduleNames.length + 2} 个文件系统后端 (${moduleNames.concat('root', 'home').join(', ')})`);

    // Open all backends in parallel — different SQLite files, no contention
    const [rootBackend, homeBackend, ...moduleBackends] = await Promise.all([
        openBackend(rootDir, `${rootDir}/_meta`),
        openBackend(homeDir, pathToMetaDir(rootDir, homeDir)),
        ...moduleNames.map(name =>
            openBackend(`${rootDir}/module/${name}`, `${rootDir}/_db/${name}`)
        ),
    ]);
    log(`文件系统初始化 (${moduleNames.length + 2} backends)`);

    const moduleAdditionalMounts = moduleNames.map((name, i) => ({
        path: `/module/${name}`,
        backend: moduleBackends[i],
    }));

    // 3. Hand off to app-shell
    const nativeShell = await TauriNativeShell.create();
    const codexTransport = await TauriCodexTransport.create(homeDir).catch(error => {
        console.warn('[Boot] Codex app-server unavailable:', error);
        return undefined;
    });
    const ui: AppUI = {
        createChatEditor: createLLMFactory,
        createAgentEditor: createAgentEditorFactory,
        createFlowEditor: createFlowsEditorFactory,
        createSkillEditor: createSkillsEditorFactory,
        createAIContextMenu: createAIContextMenuConfig,
        llmUiEditors: {
            ProviderSettingsEditor,
            ConnectionSettingsEditor,
            MCPSettingsEditor,
            CostEditor,
            SystemPromptSettingsEditor,
        },
    };
    const app = await initApp({
        backend: rootBackend,
        additionalMounts: [
            ...moduleAdditionalMounts,
            { path: '/module/home', backend: homeBackend },
        ],
        workspaces: WORKSPACES,
        defaultSlug: 'files',
        routeAliases: { home: 'home-workspace' },
        onProgress: showLoading,
        llmLogger: new TauriLLMLogger(rootDir),
        codexTransport,
        kernelPlatform: {
            skillSource: new TauriSkillSource(new TauriFsOps(), homeDir),
            skillToolHandlerFactory: new TauriSkillToolHandlerFactory(nativeShell),
            async configure(kernel) {
                kernel.toolDriver.setNativeShell(nativeShell);
                await kernel.skillService.setCwd(homeDir);
            },
        },
        ui,
    });
    log('App 初始化完成');

    // 4. Local mount service (tauri-only dynamic mounts)
    const localMounts = new LocalMountService(app.vfs, rootDir);

    // Add mount button
    document.getElementById('btn-add-mount')!.addEventListener('click', async () => {
        const localPath = await openDirectoryDialog();
        if (!localPath) return;
        const label = localPath.split('/').filter(Boolean).pop() ?? 'Mount';
        const entry = await localMounts.mount(localPath, label);
        await app.navigate(entry.id);
    });

    // React to mount added (restore + user action)
    document.addEventListener(MOUNT_EVENTS.ADDED, (e) => {
        const entry = (e as CustomEvent<MountEntry>).detail;
        injectMountWorkspace(entry);
        app.addWorkspace(createWsMount(entry.id, entry.label));
    });

    // React to mount removed
    document.addEventListener(MOUNT_EVENTS.REMOVED, (e) => {
        const id = (e as CustomEvent<MountEntry>).detail.id;
        removeMountWorkspace(id);
    });

    // Dynamic nav delegation (unmount button + dynamic workspace nav)
    document.getElementById('main-nav-list')!.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const unmountId = target.dataset.unmount
            ?? target.closest('[data-unmount]')?.getAttribute('data-unmount');
        if (unmountId) {
            e.stopPropagation();
            localMounts.unmount(unmountId);
            return;
        }
        const btn = target.closest('.app-nav-btn[data-target]') as HTMLElement | null;
        if (btn?.dataset.target) {
            e.preventDefault();
            app.navigate(btn.dataset.target);
        }
    });

    // Restore persisted mounts
    const beforeRestore = performance.now();
    await localMounts.restoreMounts();
    console.log(`[Boot] 恢复挂载: +${(performance.now() - beforeRestore).toFixed(0)}ms`);

    hideLoading();
    console.log(`[Boot] 总启动耗时: ${(performance.now() - t0).toFixed(0)}ms`);
}

bootstrap().catch(err => {
    console.error('[Bootstrap] Fatal:', err);
    showError(err instanceof Error ? err.message : String(err));
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('[Unhandled rejection]', e.reason);
    if (document.getElementById('__boot-overlay')) showError(String(e.reason));
});
