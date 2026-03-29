/**
 * @file apps/tauri-app/src/main.ts
 *
 * Entry point for the Tauri desktop app.
 *
 * Bootstrap order:
 *  1. Resolve homeDir + appDataDir (from Tauri commands or env)
 *  2. Initialise VFS (FsBackend + LocalFSBackend for home)
 *  3. Initialise LLM engine stack
 *  4. Restore persisted local mounts → inject dynamic workspace tabs
 *  5. Bind routing and nav events
 *  6. Navigate to initial route
 */

import { MemoryManager } from '@itookit/memory-manager';
import { FileTypeDefinition } from '@itookit/vfs-ui';
import { NavigationRequest, NAVIGATION_EVENTS } from '@itookit/common';

import { createSettingsModule, createSettingsFactory } from '@itookit/app-settings';
import { createLLMFactory, createAgentEditorFactory, VFSAgentService, createAIContextMenuConfig } from '@itookit/llm-ui';
import { initializeLLMEngine, LLMSessionEngine, chatFileParser } from '@itookit/llm-engine';
import { LLMDeviceDriver } from '@itookit/device-llm';
import { setKernelDeviceManager } from '@itookit/llm-kernel';

import { StandardWorkspaceStrategy, SettingsWorkspaceStrategy, ChatWorkspaceStrategy } from './strategies';
import { WorkspaceStrategy } from './strategies/types';
import { FILE_REGISTRY, EditorTypeKey } from './config/file-registry';
import { WORKSPACES, WorkspaceConfig, MENTIONABLE_MODULES } from './config/modules';
import { initVFS } from './services/vfs';
import { LocalMountService, MountEntry, MOUNT_EVENTS } from './services/local-mounts';

import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import '@itookit/memory-manager/style.css';
import '@itookit/llm-ui/style.css';
import '@itookit/app-settings/style.css';
import './styles/index.css';

// ── Tauri API (available at runtime inside Tauri context) ──────────────────────
// Fallback to Node.js process for dev/test outside Tauri.
async function getTauriPaths(): Promise<{ homeDir: string; appDataDir: string }> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const [homeDir, appDataDir] = await Promise.all([
            invoke<string>('get_home_dir'),
            invoke<string>('get_app_data_dir'),
        ]);
        return { homeDir, appDataDir };
    } catch {
        // Running outside Tauri (e.g., plain Vite dev server for UI work)
        const cwd = (globalThis as unknown as { __CWD__?: string }).__CWD__ ?? '.';
        return { homeDir: cwd, appDataDir: cwd + '/.tauri-data' };
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

// ── Router ─────────────────────────────────────────────────────────────────────

const ROUTE_MAP: Record<string, string> = {
    'files':    'home-workspace',
    'chat':     'llm-workspace',
    'agents':   'agent-workspace',
    'prompts':  'prompt-workspace',
    'settings': 'settings-workspace',
    'home':     'home-workspace',
};

const REVERSE_ROUTE_MAP = Object.entries(ROUTE_MAP).reduce((acc, [slug, id]) => {
    if (!acc[id]) acc[id] = slug;
    return acc;
}, {} as Record<string, string>);

const managerCache = new Map<string, MemoryManager>();

function resolveTarget(target: string): string {
    if (ROUTE_MAP[target]) return ROUTE_MAP[target];
    if (document.getElementById(target)) return target;
    const ws = WORKSPACES.find(w => w.moduleName === target);
    if (ws) return ws.elementId;
    console.warn(`[Router] Unknown target: ${target}, falling back to files`);
    return 'home-workspace';
}

function parseHash(): { workspace: string; resource?: string } {
    const parts = location.hash.slice(2).split('/');
    const slug   = parts[0] || 'files';
    const resource = parts[1] ? decodeURIComponent(parts[1]) : undefined;
    return { workspace: resolveTarget(slug), resource: resource === 'new' ? undefined : resource };
}

function updateBrowserHistory(wsId: string, resourceId: string | null, mode: 'push' | 'replace' = 'push'): void {
    const slug = REVERSE_ROUTE_MAP[wsId] ?? wsId;
    const hash = resourceId ? `#/${slug}/${encodeURIComponent(resourceId)}` : `#/${slug}`;
    if (location.hash !== hash) {
        const state = { workspaceId: wsId, resourceId };
        mode === 'push' ? history.pushState(state, '', hash) : history.replaceState(state, '', hash);
    }
}

// ── Dynamic workspace management ───────────────────────────────────────────────

/**
 * Inject a nav button + workspace panel for a dynamic mount entry.
 * Called both for newly added mounts and for restored mounts on startup.
 */
function injectMountWorkspace(entry: MountEntry): void {
    if (document.getElementById(entry.id + '-workspace')) return; // idempotent

    // Workspace panel
    const panel = document.createElement('div');
    panel.id = entry.id + '-workspace';
    panel.className = 'workspace-view';
    document.querySelector('.main-content-area')!.appendChild(panel);

    // Nav button
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

    // Update routing maps
    ROUTE_MAP[entry.id]                  = entry.id + '-workspace';
    REVERSE_ROUTE_MAP[entry.id + '-workspace'] = entry.id;
}

function removeMountWorkspace(id: string): void {
    document.getElementById(id + '-workspace')?.remove();
    document.querySelector(`[data-mount-id="${id}"]`)?.remove();
    managerCache.delete(id + '-workspace');
    delete ROUTE_MAP[id];
    delete REVERSE_ROUTE_MAP[id + '-workspace'];
}

// ── Loading overlay helpers ────────────────────────────────────────────────────

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

// ── Editor mount detector ──────────────────────────────────────────────────────

/**
 * Resolves when an actual editor element appears inside the MemoryManager
 * container (i.e. when .mm-editor-area contains something other than the
 * placeholder).  Falls back to a 5 s timeout for workspaces with no files.
 */
function waitForEditorMount(container: HTMLElement): Promise<void> {
    return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
            observer.disconnect();
            console.warn('[waitForEditorMount] timeout — proceeding without editor');
            resolve();
        }, 5000);

        const check = () => {
            const area = container.querySelector('.mm-editor-area');
            if (!area) return;
            for (const child of Array.from(area.children)) {
                if (!(child as HTMLElement).classList.contains('mm-placeholder')) {
                    clearTimeout(timeout);
                    observer.disconnect();
                    resolve();
                    return;
                }
            }
        };

        const observer = new MutationObserver(check);
        observer.observe(container, { childList: true, subtree: true });
        check(); // editor might already be there on first-time open
    });
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

async function bootstrap() {
    showLoading('正在初始化…');
    try {
        // ── 1. Resolve paths ──────────────────────────────────────────────────
        showLoading('获取路径…');
        const { homeDir, appDataDir } = await getTauriPaths();
        console.log('[Boot] homeDir:', homeDir, 'appDataDir:', appDataDir);

        // Update home directory labels in nav + badge
        const dirName = homeDir.split('/').filter(Boolean).pop() ?? homeDir;
        const navLabel = document.getElementById('nav-home-label');
        if (navLabel) navLabel.textContent = dirName;
        const navBtn = document.getElementById('nav-home-btn');
        if (navBtn) navBtn.title = homeDir;
        const badge = document.getElementById('home-dir-label');
        if (badge) { badge.textContent = dirName; badge.title = homeDir; }

        // ── 2. Initialise VFS ─────────────────────────────────────────────────
        showLoading('初始化文件系统…');
        const { manager: vfsCore } = await initVFS({ homeDir, appDataDir });
        console.log('[Boot] VFS ready');

        // ── 3. LLM device driver ──────────────────────────────────────────────
        showLoading('加载 LLM 驱动…');
        const llmDriver = new LLMDeviceDriver(vfsCore);
        await llmDriver.init();
        vfsCore.devices.register(llmDriver);
        await llmDriver.createDeviceNodes();
        setKernelDeviceManager(vfsCore.devices);
        console.log('[Boot] LLM driver ready');

        // ── 4. Core services ──────────────────────────────────────────────────
        showLoading('初始化核心服务…');
        const settingsModule = await createSettingsModule(vfsCore);
        const agentService   = new VFSAgentService(vfsCore, llmDriver);
        const sessionEngine  = new LLMSessionEngine(vfsCore);
        await initializeLLMEngine({ agentService, sessionEngine, maxConcurrent: 20 });
        console.log('[Boot] Core services ready');

        const settingsFactory = createSettingsFactory(settingsModule.service, agentService, llmDriver);
        const llmFactory      = createLLMFactory(agentService);
        const agentFactory    = createAgentEditorFactory(agentService);

        // ── 5. Local mount service ────────────────────────────────────────────
        const localMounts = new LocalMountService(vfsCore, appDataDir);

        // ── 6. Workspace strategies ───────────────────────────────────────────
        const strategies: Record<string, WorkspaceStrategy> = {
            'standard': new StandardWorkspaceStrategy(vfsCore),
            'agent':    new StandardWorkspaceStrategy(vfsCore),
            'settings': new SettingsWorkspaceStrategy(settingsFactory, settingsModule.engine),
            'chat':     new ChatWorkspaceStrategy(llmFactory, sessionEngine),
        };

        const standardFactory = strategies['standard'].getFactory();
        const editorFactoryMap: Record<EditorTypeKey, unknown> = {
            'standard': standardFactory,
            'agent':    agentFactory,
            'chat':     llmFactory,
        };

        // ── 7. File type resolver ─────────────────────────────────────────────
        const getFileTypeDefinition = (typeId: string): FileTypeDefinition | null => {
            const def = FILE_REGISTRY[typeId];
            if (!def) { console.warn(`[FileRegistry] Unknown type: ${typeId}`); return null; }
            const factory = def.editorType !== 'standard' ? editorFactoryMap[def.editorType] : undefined;
            const parser  = def.id === 'chat' ? chatFileParser : undefined;
            return {
                extensions:           [def.extension],
                icon:                 def.icon,
                editorFactory:        factory,
                contentParser:        parser,
                duplicateTransformer: def.duplicateTransformer,
            };
        };

        // ── 8. Workspace loader ───────────────────────────────────────────────
        const loadWorkspace = async (
            targetId: string,
            wsConfig: WorkspaceConfig,
            initialResourceId?: string,
        ): Promise<MemoryManager | undefined> => {
            if (managerCache.has(targetId)) return managerCache.get(targetId);

            const container = document.getElementById(targetId);
            if (!container || !wsConfig) return undefined;

            const strategyType = wsConfig.type ?? 'standard';
            const strategy     = strategies[strategyType] ?? strategies['standard'];

            const { moduleName, plugins, mentionScope, aiEnabled, supportedFileTypes, ...uiPassThrough } = wsConfig;

            const workspaceFileTypes: FileTypeDefinition[] = (supportedFileTypes ?? [])
                .map(id => getFileTypeDefinition(id))
                .filter((x): x is FileTypeDefinition => !!x);

            const primaryDef = supportedFileTypes?.[0] ? FILE_REGISTRY[supportedFileTypes[0]] : undefined;

            const aiContextMenu = (strategyType === 'chat' && !uiPassThrough.readOnly)
                ? createAIContextMenuConfig({ agentService, engine: sessionEngine })
                : null;

            const uiOptions = {
                ...uiPassThrough,
                createFileLabel:    primaryDef?.label        ?? 'File',
                defaultFileName:    primaryDef?.defaultFileName,
                defaultExtension:   primaryDef?.extension,
                defaultFileContent: primaryDef?.defaultContent,
                contextMenu: {
                    items: (item: unknown, defaults: unknown[]) => {
                        if (uiPassThrough.readOnly) return [];
                        if (aiContextMenu?.items) return aiContextMenu.items(item, defaults);
                        return defaults;
                    },
                },
            };

            const manager = new MemoryManager({
                container,
                customEngine:  strategy.getEngine?.(moduleName),
                moduleName,
                editorFactory: strategy.getFactory(),
                scopeId:       targetId,
                fileTypes:     workspaceFileTypes,
                uiOptions,
                editorConfig: {
                    plugins:      plugins ?? [],
                    readOnly:     false,
                    mentionScope: mentionScope?.[0] === '*' ? MENTIONABLE_MODULES : mentionScope,
                },
                aiConfig: { enabled: aiEnabled ?? true },
                onNavigate:      async (req: NavigationRequest) => handleNavigationRequest(req),
                onSessionChange: (sessionId) => updateBrowserHistory(targetId, sessionId, 'replace'),
            });

            // Pass no initialResourceId to manager.start() so vfsUI auto-selects the
            // first file on its own (one sessionSelected).  Passing an id here would
            // cause openFileInternal() to fire a second sessionSelected immediately,
            // creating the "Duplicate creation" race with LLMFactory.
            await manager.start();
            managerCache.set(targetId, manager);

            if (initialResourceId && manager.getActiveSessionId() !== initialResourceId) {
                await manager.openFile(initialResourceId);
            }

            // Wait until .mm-editor-area has a real editor mounted (not just placeholder).
            // MutationObserver is used instead of a fixed timeout so the loading overlay
            // disappears at the exact right moment — whether the editor is fast or slow.
            await waitForEditorMount(container);
            return manager;
        };

        // ── 9. Navigation ─────────────────────────────────────────────────────
        const performNavigation = async (workspaceId: string, resourceId?: string): Promise<void> => {
            document.querySelectorAll('.workspace-view').forEach(ws => {
                ws.classList.toggle('active', ws.id === workspaceId);
            });
            document.querySelectorAll('.app-nav-btn').forEach(btn => {
                btn.classList.toggle('active', (btn as HTMLElement).dataset.target === workspaceId);
            });

            const isFirstLoad = !managerCache.has(workspaceId);
            if (isFirstLoad) {
                // Find config — could be static or a dynamic mount workspace
                const staticWsConfig = WORKSPACES.find(w => w.elementId === workspaceId);
                if (staticWsConfig) {
                    await loadWorkspace(workspaceId, staticWsConfig, resourceId);
                } else {
                    // Dynamic mount workspace
                    const mountEntry = localMounts.listMounts()
                        .find(m => m.id + '-workspace' === workspaceId);
                    if (mountEntry) {
                        const dynamicConfig: WorkspaceConfig = {
                            elementId:          workspaceId,
                            moduleName:         mountEntry.id,
                            type:               'standard',
                            title:              mountEntry.label,
                            supportedFileTypes: ['markdown'],
                            syncEnabled:        false,
                            aiEnabled:          true,
                            mentionAble:        false,
                        };
                        await loadWorkspace(workspaceId, dynamicConfig, resourceId);
                    }
                }
            } else if (resourceId) {
                await managerCache.get(workspaceId)!.openFile(resourceId);
            }
        };

        const handleNavigationRequest = async (req: NavigationRequest): Promise<void> => {
            const targetWsId = resolveTarget(req.target);
            const action     = req.action ?? 'open';

            switch (action) {
                case 'create': {
                    if (req.state ?? req.create) {
                        sessionStorage.setItem('app_create_params', JSON.stringify({
                            target:    req.target,
                            state:     req.state,
                            create:    req.create,
                            agentId:   req.state?.agentId,
                            text:      req.state?.inputText,
                            title:     req.create?.title,
                            timestamp: Date.now(),
                        }));
                    }
                    updateBrowserHistory(targetWsId, null, 'push');
                    await performNavigation(targetWsId);
                    const mgr = managerCache.get(targetWsId);
                    if (mgr) {
                        const newId = await mgr.createAndOpenFile({
                            title:    req.create?.title,
                            content:  req.create?.content,
                            parentId: req.create?.parentId,
                        });
                        updateBrowserHistory(targetWsId, newId, 'replace');
                    }
                    break;
                }
                case 'reveal':
                    updateBrowserHistory(targetWsId, req.resourceId ?? null, 'replace');
                    await performNavigation(targetWsId);
                    break;
                case 'focus':
                    updateBrowserHistory(targetWsId, null, 'replace');
                    await performNavigation(targetWsId);
                    break;
                default: {
                    updateBrowserHistory(targetWsId, req.resourceId ?? null, 'push');
                    await performNavigation(targetWsId, req.resourceId);
                }
            }
        };

        // ── 10. Event bindings ────────────────────────────────────────────────

        // Static nav buttons
        document.querySelectorAll('.app-nav-btn[data-target]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = (e.currentTarget as HTMLElement).dataset.target;
                if (!targetId) return;
                const lastId = managerCache.get(targetId)?.getActiveSessionId() ?? null;
                updateBrowserHistory(targetId, lastId, 'push');
                performNavigation(targetId, lastId ?? undefined);
            });
        });

        // Dynamic nav buttons (event delegation on sidebar)
        document.getElementById('main-nav-list')!.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            // Unmount button
            const unmountId = target.dataset.unmount ?? target.closest('[data-unmount]')?.getAttribute('data-unmount');
            if (unmountId) {
                e.stopPropagation();
                localMounts.unmount(unmountId);
                return;
            }

            // Dynamic workspace nav click
            const btn = target.closest('.app-nav-btn[data-target]') as HTMLElement | null;
            if (btn?.dataset.target) {
                e.preventDefault();
                const targetId = btn.dataset.target;
                const lastId   = managerCache.get(targetId)?.getActiveSessionId() ?? null;
                updateBrowserHistory(targetId, lastId, 'push');
                performNavigation(targetId, lastId ?? undefined);
            }
        });

        // Add mount button
        document.getElementById('btn-add-mount')!.addEventListener('click', async () => {
            const localPath = await openDirectoryDialog();
            if (!localPath) return;
            const label = localPath.split('/').filter(Boolean).pop() ?? 'Mount';
            const entry = await localMounts.mount(localPath, label);
            // Navigate to the new workspace immediately
            updateBrowserHistory(entry.id + '-workspace', null, 'push');
            await performNavigation(entry.id + '-workspace');
        });

        // React to mount added (from restoreMounts or user action)
        document.addEventListener(MOUNT_EVENTS.ADDED, (e) => {
            injectMountWorkspace((e as CustomEvent<MountEntry>).detail);
            // Re-bind any freshly injected nav buttons
            document.querySelectorAll('.app-nav-btn[data-target]').forEach(btn => {
                if ((btn as HTMLElement).dataset.bound) return;
                (btn as HTMLElement).dataset.bound = '1';
                btn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    const tid = (ev.currentTarget as HTMLElement).dataset.target;
                    if (!tid) return;
                    const last = managerCache.get(tid)?.getActiveSessionId() ?? null;
                    updateBrowserHistory(tid, last, 'push');
                    performNavigation(tid, last ?? undefined);
                });
            });
        });

        // React to mount removed
        document.addEventListener(MOUNT_EVENTS.REMOVED, (e) => {
            const id = (e as CustomEvent<MountEntry>).detail.id;
            removeMountWorkspace(id);
            // Navigate back to home if removed workspace was active
            if (document.getElementById('home-workspace')?.classList.contains('active') === false) {
                performNavigation('home-workspace');
            }
        });

        // Global navigation events
        document.addEventListener(NAVIGATION_EVENTS.NAVIGATE, (e) => {
            const req = (e as CustomEvent).detail as NavigationRequest;
            if (req?.target) handleNavigationRequest(req);
        });

        // Browser back/forward
        window.addEventListener('popstate', (e) => {
            const state = e.state as { workspaceId: string; resourceId?: string } | null;
            if (state) performNavigation(state.workspaceId, state.resourceId);
            else { const r = parseHash(); performNavigation(r.workspace, r.resource); }
        });

        // ── 11. Restore persisted mounts ──────────────────────────────────────
        showLoading('恢复挂载目录…');
        await localMounts.restoreMounts();

        // ── 12. Initial navigation ─────────────────────────────────────────────
        showLoading('加载工作区…');
        const initialRoute = parseHash();
        await performNavigation(initialRoute.workspace, initialRoute.resource);
        updateBrowserHistory(initialRoute.workspace, initialRoute.resource ?? null, 'replace');

        hideLoading();
        console.log('[Boot] Ready');

    } catch (err) {
        console.error('[Bootstrap] Fatal error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        showError(msg);
    }
}

// Catch any unhandled async errors (silent failures in promise chains)
window.addEventListener('unhandledrejection', (e) => {
    console.error('[Unhandled rejection]', e.reason);
    // Show in UI only if boot overlay is still visible (nothing rendered yet)
    if (document.getElementById('__boot-overlay')) {
        showError(String(e.reason));
    }
});

bootstrap();
