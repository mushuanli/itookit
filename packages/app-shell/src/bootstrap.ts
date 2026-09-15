import { showMemoryDialog } from './files/memory-dialog';
import { createApplicationRuntime, PrivilegedCommandService, workspaceRoot, type WorkspaceController } from '@itookit/app-core';
import { createSessionSkillControls } from '@itookit/kernel-adapters';
import { SessionWorkbench } from './core/SessionWorkbench';
import { FileTypeDefinition, type VFSNodeUI } from '@itookit/vfs-ui';
import {NavigationRequest, NAVIGATION_EVENTS, formatDefaultFileTitle, traceBoot} from '@itookit/common';
import { MenuItem } from '@itookit/ui-common';
import { EditorFactory } from '@itookit/ui-common';
import { createSettingsModule, createSettingsFactory } from '@itookit/app-settings';
import type { SessionManager } from '@itookit/llm-session';
import { Workbench } from './core/Workbench';
import { SkillsEngine } from '@itookit/app-settings';

import { AppOptions, AppHandle, WorkspaceConfig } from './types';
import { defaultEditorFactory } from '@itookit/mdxeditor';
import { FILE_REGISTRY, EditorTypeKey } from './config/file-registry';
import { themeService, ThemeMode } from './ThemeService';

/** Resolves when an actual editor mounts inside the container (not just placeholder). */
function waitForEditorMount(container: HTMLElement): Promise<void> {
    return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
            observer.disconnect();
            resolve();
        }, 15000);

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
        check();
    });
}

// ── HITL → vfs-ui bridge ───────────────────────────────────────────────────────
//
// When a background session's agent calls human_input, the SessionManager emits
// session_hitl_active / session_hitl_resolved RegistryEvents. This bridge
// translates those into VFSStore state so the session list renders an orange
// pulsing indicator on the waiting session's .chat file entry.

function setupHitlVfsBridge(sessionManager: SessionManager, manager: WorkspaceController): () => void {
    // NOTE: This bridge is "eventual" — it only responds to events that fire
    // AFTER the workspace is loaded. Sessions that started waiting before the
    // workspace loaded won't be highlighted until the NEXT input request.
    // In practice this is not an issue because chat workspaces are loaded at
    // app startup, before any background session can trigger human_input.
    return sessionManager.onGlobalEvent((event) => {
        if (event.type === 'session_hitl_active') {
            const runtime = sessionManager.getSessionRuntime(event.payload.sessionId);
            if (runtime) {
                manager.setWaitingInput(runtime.sessionId, true);
            }
        } else if (event.type === 'session_hitl_resolved') {
            const runtime = sessionManager.getSessionRuntime(event.payload.sessionId);
            if (runtime) {
                manager.setWaitingInput(runtime.sessionId, false);
            }
        } else if (event.type === 'session_status_changed') {
            // Defensive cleanup: if the session is no longer running (aborted /
            // completed / failed), clear any lingering waiting-input indicator.
            // This also clears stale waiting indicators when a Process is cancelled.
            const stopped = event.payload.status !== 'running' && event.payload.status !== 'queued';
            if (stopped) {
                const runtime = sessionManager.getSessionRuntime(event.payload.sessionId);
                if (runtime) {
                    manager.setWaitingInput(runtime.sessionId, false);
                }
            }
        }
    });
}

export async function initApp(options: AppOptions): Promise<AppHandle> {
    const { defaultSlug, routeAliases = {}, onProgress } = options;
    const t0 = performance.now();
    let t = t0;
    const cleanupFns: Array<() => void | Promise<void>> = [];
    const sourceCleanupFns: Array<() => void | Promise<void>> = [];
    try {
    const logStep = (label: string) => {
        const now = performance.now();
        console.log(`[Boot] ${label}: +${(now - t).toFixed(0)}ms (累计 ${(now - t0).toFixed(0)}ms)`);
        t = now;
        onProgress?.(label);
    };

    // Mutable workspaces list — addWorkspace() appends here at runtime
    const workspaces: WorkspaceConfig[] = [...options.workspaces];

    const mentionableModules = (): string[] =>
        workspaces.filter(ws => ws.mentionAble === true).map(ws => ws.workspaceName);

    // ── Build route maps from workspace configs ────────────────────────────────

    // slug → elementId
    const routeMap: Record<string, string> = { ...routeAliases };
    // elementId → canonical slug (first mapping wins)
    const reverseRouteMap: Record<string, string> = {};

    const registerWorkspaceRoute = (ws: WorkspaceConfig) => {
        routeMap[ws.slug] = ws.elementId;
        if (!reverseRouteMap[ws.elementId]) reverseRouteMap[ws.elementId] = ws.slug;
    };

    workspaces.forEach(registerWorkspaceRoute);

    const resolvedDefault = defaultSlug ?? workspaces[0]?.slug ?? '';

    if (!options.runtime && !options.backend) throw new Error('AppOptions.backend or AppOptions.runtime is required');
    const ownsRuntime = !options.runtime;
    const runtime = options.runtime ?? await createApplicationRuntime({ ...options, backend: options.backend! });
    if (ownsRuntime) cleanupFns.push(() => runtime.dispose());
    const { vfs, llmDriver, agentService, sessionRepository, flowEngine, sessionFiles, directoryMounts,
        kernel, sessionManager, commandBus } = runtime;
    const kernelCore = kernel.kernel;
    await themeService.init(await vfs.openFileSystem('/etc'));
    cleanupFns.push(() => themeService.destroy());
    logStep('初始化界面服务…');
    const settingsSources = await Promise.all(workspaces.filter(workspace => !['settings', 'skills'].includes(workspace.type ?? '')).map(async workspace => ({
        name: workspace.workspaceName, description: workspace.title,
        fs: workspace.files?.fs ?? await vfs.openFileSystem(workspaceRoot(workspace.workspaceName)),
        syncEnabled: workspace.syncEnabled && !workspace.isSystem,
    })));
    const settingsModule = await traceBoot('createSettingsModule', () => createSettingsModule(vfs, settingsSources));
    cleanupFns.push(() => settingsModule.service.dispose());

    const settingsFactory = createSettingsFactory(
        settingsModule.service,
        agentService,
        llmDriver,
        options.ui.llmUiEditors,
        options.ui.restoreFlowLibrary ? () => options.ui.restoreFlowLibrary!(commandBus) : undefined,
    );
    // Pass llmService only when the vision connection is actually configured —
    // this is the single place that knows both the kernel and the connection list.
    const connections = await agentService.getConnections();
    const visionConnExists = connections.some(c => c.id === 'conn-volcengine-vision');
    const privilegedCommands = new PrivilegedCommandService(kernel.kernel, agentService);
    const sessionSkills = createSessionSkillControls(kernel.kernel, kernel.sessions);
    const llmFactory = options.ui.createChatEditor(
        agentService,
        visionConnExists
            ? {
                sessionRepository,
                llmService: kernel.llmService,
                commandBus,
                kernel: kernel.kernel,
                privilegedCommands, sessionSkills,
            }
            : { sessionRepository, commandBus, kernel: kernel.kernel, privilegedCommands, sessionSkills },
    );
    const agentFactory = options.ui.createAgentEditor(agentService);

    // Skills workspace: VFSUIShell list (SkillsEngine) + form editor (SkillSettingsEditor)
    const skillsEngine  = new SkillsEngine(agentService);
    const skillsFactory = options.ui.createSkillEditor(agentService);

    await options.ui.installFlowLibrary?.(commandBus);

    // Workflows workspace: standalone design surface over the flows VFS module.
    const flowsFactory = options.ui.createFlowEditor({
        commands: commandBus,
        listConnections: async () => {
            const available = await agentService.getConnections();
            return available.map(connection => ({ id: connection.id, name: connection.name }));
        },
        listAgents: async () => (await agentService.getAgents()).map(agent => ({ id: agent.id, name: agent.name, description: agent.description })),
        listSystemPrompts: async () => (await agentService.listSystemPrompts()).map(prompt => ({ id: prompt.id, name: prompt.name, description: prompt.description })),
        listTools: async () => kernel.toolCatalog.getToolDefinitions().map(definition => {
            const id = definition.function?.name ?? definition.name ?? '';
            const rawDescription = definition.function?.description ?? definition.description;
            const description = typeof rawDescription === 'string' ? rawDescription : undefined;
            return { id, name: id, ...(description ? { description } : {}) };
        }).filter(tool => Boolean(tool.id)),
        listSkills: async () => (await agentService.getSkills()).map(skill => ({ id: skill.id, name: skill.name, description: skill.description })),
    });

    // ── 4. Workspace strategies ────────────────────────────────────────────────

    const factories: Record<string, EditorFactory> = {
        standard: defaultEditorFactory, agent: defaultEditorFactory,
        settings: settingsFactory, chat: llmFactory, skills: skillsFactory, flows: flowsFactory,
    };
    const workspaceFiles = new Map<string, import('@itookit/vfs-core').FileSystemContext>();
    for (const workspace of options.workspaces) {
        const fs = workspace.files?.fs ?? (workspace.type === 'settings' ? settingsModule.engine
            : workspace.type === 'skills' ? skillsEngine
            : workspace.type === 'flows' ? flowEngine.engine
            : await vfs.openFileSystem(workspaceRoot(workspace.workspaceName)));
        workspaceFiles.set(workspace.elementId, workspace.files ?? { fs, cwd: '/' });
    }

    const editorFactoryMap: Record<EditorTypeKey, EditorFactory | undefined> = {
        standard: defaultEditorFactory,
        agent:    agentFactory as EditorFactory,
        flow:     flowsFactory as EditorFactory,
    };

    // ── 5. File type resolver ──────────────────────────────────────────────────

    // contentParser for .agent files — embeds connectionId in searchableText
    // so all agents (even unopened) are searchable by connection/provider ID.
    const agentFileParser = (content: string) => {
        try {
            const def = JSON.parse(content);
            const parts = [def.name, def.description, def.config?.connectionId].filter(Boolean);
            return { summary: '', searchableText: parts.join(' '), headings: [] };
        } catch {
            return { summary: '', searchableText: '', headings: [] };
        }
    };

    // searchFilter for agent workspace — extends default corpus with ai_connectionLabel
    // so searching by human-readable provider/connection name works for opened agents.
    const agentSearchFilter = (item: VFSNodeUI, tokens: string[]) => {
        const connectionLabel = item.metadata.custom.ai_connectionLabel;
        const corpus = [
            item.metadata?.title ?? '',
            item.content?.summary ?? '',
            item.content?.searchableText ?? '',
            typeof connectionLabel === 'string' ? connectionLabel : '',
        ].join(' ').toLowerCase();
        return tokens.every(t => corpus.includes(t));
    };

    const getFileTypeDef = (typeId: string): FileTypeDefinition | null => {
        const def = FILE_REGISTRY[typeId];
        if (!def) { console.warn(`[app-shell] Unknown file type: ${typeId}`); return null; }
        const factory = def.editorType !== 'standard' ? editorFactoryMap[def.editorType] : undefined;
        const parser  = def.id === 'agent' ? agentFileParser
                      : undefined;
        return {
            extensions:           [def.extension],
            icon:                 def.icon,
            editorFactory:        factory,
            contentParser:        parser,
            duplicateTransformer: def.duplicateTransformer,
        };
    };

    // ── 6. Manager cache + workspace loader ────────────────────────────────────

    const managerCache = new Map<string, WorkspaceController>();
    // Deduplicate concurrent loads: if the same workspace is loading, reuse the promise.
    const pendingLoads = new Map<string, Promise<WorkspaceController | undefined>>();

    const doLoadWorkspace = async (
        wsConfig: WorkspaceConfig,
        initialResourceId?: string,
    ): Promise<WorkspaceController | undefined> => {
        const { elementId } = wsConfig;

        const container = document.getElementById(elementId);
        if (!container) {
            console.warn(`[Shell] doLoadWorkspace: container #${elementId} not found in DOM`);
            return undefined;
        }

        container.innerHTML = '';

        // Create layout DOM (previously in memory-manager's Layout.ts).
        // Workbench no longer owns DOM — consumers create their own containers.
        const layoutEl = document.createElement('div');
        layoutEl.className = 'mm-layout';

        const sidebarEl = document.createElement('div');
        sidebarEl.className = 'mm-sidebar';

        const editorEl = document.createElement('div');
        editorEl.className = 'mm-editor-area';

        layoutEl.appendChild(sidebarEl);
        layoutEl.appendChild(editorEl);
        container.appendChild(layoutEl);

        const strategyType = wsConfig.type ?? 'standard';
        const factory = factories[strategyType] ?? defaultEditorFactory;
        const files = workspaceFiles.get(elementId);
        if (!files) throw new Error(`Workspace files not configured: ${elementId}`);

        if (strategyType === 'chat') {
            const sessionWorkspace = new SessionWorkbench(sidebarEl, editorEl, sessionRepository, sessionFiles, factory, (id, mode = 'replace') => updateHistory(elementId, id, mode), { toggleSidebar: collapsed => { sidebarEl.classList.toggle('is-collapsed', collapsed ?? !sidebarEl.classList.contains('is-collapsed')); }, navigate: handleNavigationRequest }, kernelCore, defaultEditorFactory, directoryMounts, sessionSkills, async (sessionId, signal) => {
                await showMemoryDialog(sessionManager.memory.forSession(sessionId), await sessionManager.getAvailableAgents(), signal);
            }, { fs: flowEngine.engine, menu: options.ui.createFlowContextMenu<VFSNodeUI>({ commands: commandBus,
                navigate: sessionId => handleNavigationRequest({ target: 'chat', resourceId: sessionId }) }) });
            cleanupFns.push(() => sessionWorkspace.destroy());
            await sessionWorkspace.start(); managerCache.set(elementId, sessionWorkspace);
            cleanupFns.push(setupHitlVfsBridge(sessionManager, sessionWorkspace));
            if (initialResourceId) await sessionWorkspace.openResource(initialResourceId);
            return sessionWorkspace;
        }

        const { workspaceName: _workspaceName, plugins, mentionScope, aiEnabled, supportedFileTypes, showFileExtensions, ...uiPassThrough } = wsConfig;

        const fileTypes: FileTypeDefinition[] = (supportedFileTypes ?? [])
            .map(id => getFileTypeDef(id))
            .filter((x): x is FileTypeDefinition => !!x);

        const primaryDef = supportedFileTypes?.[0] ? FILE_REGISTRY[supportedFileTypes[0]] : undefined;

        const flowContextMenu = options.ui.createFlowContextMenu<VFSNodeUI>({
            commands: commandBus,
            navigate: sessionId => handleNavigationRequest({ target: 'chat', resourceId: sessionId }),
        });
        const uiOptions = {
            ...uiPassThrough,
            defaultExtension: primaryDef?.extension,
            fileCreation: {
                ...uiPassThrough.fileCreation,
                label:           uiPassThrough.fileCreation?.label           ?? primaryDef?.label           ?? 'File',
                title:           uiPassThrough.fileCreation?.title           ?? formatDefaultFileTitle(),
                content:         uiPassThrough.fileCreation?.content,
                startupFileName: uiPassThrough.fileCreation?.startupFileName ?? primaryDef?.defaultFileName,
                startupContent:  uiPassThrough.fileCreation?.startupContent  ?? primaryDef?.defaultContent,
            },
            contextMenu: {
                items: (_item: VFSNodeUI, defaults: MenuItem<VFSNodeUI>[]) => {
                    if (uiPassThrough.readOnly) return [];
                    if (strategyType === 'flows') return flowContextMenu.items?.(_item, defaults) ?? defaults;
                    return defaults;
                },
            },
            // Skills workspace: summary=skill ID, tags="disabled" pill, dot=enabled.
            ...(strategyType === 'skills' && {
                defaultUiSettings: { showSummary: true, showTags: true, showBadges: false },
            }),
            // Agent workspace: include ai_connectionLabel in search corpus.
            ...(strategyType === 'agent' && {
                searchFilter: agentSearchFilter,
            }),
        };

        const manager = new Workbench({
            sidebarContainer: sidebarEl,
            editorContainer: editorEl,
            files,
            editorFactory: factory,
            scopeId:       elementId,
            fileTypes,
            uiOptions,
            showFileExtensions,
            editorConfig: {
                plugins:      plugins ?? [],
                readOnly:     false,
                mentionScope: mentionScope?.[0] === '*' ? mentionableModules() : mentionScope,
            },
            aiConfig: { enabled: aiEnabled ?? true },
            onNavigate:      async (req: NavigationRequest) => handleNavigationRequest(req),
            onSessionChange: (sessionId) => updateHistory(elementId, sessionId, 'replace'),
            onSidebarToggle: (collapsed) => {
                if (collapsed) {
                    sidebarEl.classList.add('is-collapsed');
                } else {
                    sidebarEl.classList.remove('is-collapsed');
                }
                setTimeout(() => window.dispatchEvent(new Event('resize')), 310);
            },
        });

        const controller: WorkspaceController = {
            start: () => manager.start(), destroy: () => manager.destroy(),
            openResource: id => manager.openFile(id), createResource: options => manager.createAndOpenFile(options),
            getActiveResourceId: () => manager.getActiveFilePath(), setWaitingInput: (id, waiting) => manager.setNodeWaitingInput(id, waiting),
        };
        // Start without resourceId to avoid double sessionSelected race with LLMFactory.
        cleanupFns.push(() => manager.destroy());
        await manager.start();
        managerCache.set(elementId, controller);

        // Bridge: session HITL status → vfs-ui session list highlight.
        // Calls manager.setWaitingInput() which delegates to VFSUIShell internally,
        // keeping bootstrap decoupled from the concrete VFSUIShell type.
        cleanupFns.push(setupHitlVfsBridge(sessionManager, controller));

        if (initialResourceId && manager.getActiveFilePath() !== initialResourceId) {
            await manager.openFile(initialResourceId);
            // Only wait for editor mount if we actually opened a file —
            // otherwise no editor mounts and we'd hit the 15s timeout.
            if (onProgress) await waitForEditorMount(container);
        }

        return controller;
    };

    /** Deduplicated workspace loader: concurrent calls for the same elementId share one promise. */
    const loadWorkspace = (
        wsConfig: WorkspaceConfig,
        initialResourceId?: string,
    ): Promise<WorkspaceController | undefined> => {
        const { elementId } = wsConfig;
        console.log(`[Shell] loadWorkspace: ${elementId} cached=${managerCache.has(elementId)} pending=${pendingLoads.has(elementId)}`);
        if (managerCache.has(elementId)) return Promise.resolve(managerCache.get(elementId));
        if (!pendingLoads.has(elementId)) {
            const p = doLoadWorkspace(wsConfig, initialResourceId)
                .finally(() => pendingLoads.delete(elementId));
            pendingLoads.set(elementId, p);
        }
        return pendingLoads.get(elementId)!;
    };

    // ── 7. Routing helpers ─────────────────────────────────────────────────────

    const resolveTarget = (target: string): string => {
        if (routeMap[target]) return routeMap[target];
        if (document.getElementById(target)) return target;
        const ws = workspaces.find(w => w.workspaceName === target);
        if (ws) return ws.elementId;
        return routeMap[resolvedDefault] ?? workspaces[0]?.elementId ?? '';
    };

    const updateHistory = (wsId: string, resourceId: string | null, mode: 'push' | 'replace'): void => {
        const slug = reverseRouteMap[wsId] ?? wsId;
        const hash = resourceId ? `#/${slug}/${encodeURIComponent(resourceId)}` : `#/${slug}`;
        if (location.hash !== hash) {
            const state = { workspaceId: wsId, resourceId };
            mode === 'push'
                ? history.pushState(state, '', hash)
                : history.replaceState(state, '', hash);
        }
    };

    const performNavigation = async (workspaceId: string, resourceId?: string): Promise<void> => {
        console.log(`[Shell] performNavigation: ${workspaceId} resourceId=${resourceId ?? '—'} cached=${managerCache.has(workspaceId)}`);
        document.querySelectorAll('.workspace-view').forEach(ws => {
            ws.classList.toggle('active', ws.id === workspaceId);
        });
        document.querySelectorAll('.app-nav-btn').forEach(btn => {
            btn.classList.toggle('active', (btn as HTMLElement).dataset.target === workspaceId);
        });

        if (!managerCache.has(workspaceId)) {
            const wsConfig = workspaces.find(w => w.elementId === workspaceId);
            if (wsConfig) await loadWorkspace(wsConfig, resourceId);
        } else if (resourceId) {
            const mgr = managerCache.get(workspaceId)!;
            const wasAlreadyOpen = mgr.getActiveResourceId() === resourceId;
            await mgr.openResource(resourceId);
            // If the file was already open, render() was skipped → dispatch anchor manually
            if (wasAlreadyOpen) {
                const raw = sessionStorage.getItem('settings_anchor');
                if (raw) {
                    try {
                        const { anchor } = JSON.parse(raw) as { anchor: string };
                        sessionStorage.removeItem('settings_anchor');
                        document.getElementById(workspaceId)?.dispatchEvent(
                            new CustomEvent('consume-anchor', { detail: { anchor } }),
                        );
                    } catch {
                        sessionStorage.removeItem('settings_anchor');
                    }
                }
            }
        }
    };

    const handleNavigationRequest = async (req: NavigationRequest): Promise<void> => {
        const targetWsId = resolveTarget(req.target);
        const action = req.action ?? 'open';
        console.log(`[Shell] handleNavigationRequest: action=${action} target=${req.target} → wsId=${targetWsId}`);

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
                updateHistory(targetWsId, null, 'push');
                await performNavigation(targetWsId);
                const mgr = managerCache.get(targetWsId);
                console.log(`[Shell] create: mgr found=${!!mgr} wsId=${targetWsId}`);
                if (mgr) {
                    try {
                        const newId = await mgr.createResource({
                            title:    req.create?.title,
                            content:  req.create?.content,
                            parentPath: req.create?.parentPath,
                        });
                        console.log(`[Shell] createAndOpenFile ok: newId=${newId}`);
                        updateHistory(targetWsId, newId, 'replace');
                    } catch (err) {
                        console.error('[Shell] createAndOpenFile failed:', err);
                    }
                } else {
                    console.warn(`[Shell] create skipped: no manager for wsId=${targetWsId}`);
                }
                break;
            }
            case 'reveal':
                updateHistory(targetWsId, req.resourceId ?? null, 'replace');
                await performNavigation(targetWsId);
                break;
            case 'focus':
                updateHistory(targetWsId, null, 'replace');
                await performNavigation(targetWsId);
                break;
            default: {
                if (req.state?.anchor) {
                    sessionStorage.setItem('settings_anchor', JSON.stringify({
                        target: req.target,
                        anchor: req.state.anchor,
                        timestamp: Date.now(),
                    }));
                }
                updateHistory(targetWsId, req.resourceId ?? null, 'push');
                await performNavigation(targetWsId, req.resourceId);
            }
        }
    };

    // ── 8. Event bindings ──────────────────────────────────────────────────────

    // Navigation listeners are global and outlive workspace managers. Keep them
    // on an AbortController so destroy() and startup failure can unregister them.
    const navigationAbort = new AbortController();
    cleanupFns.push(() => navigationAbort.abort());
    const navigationSignal = navigationAbort.signal;

    document.querySelectorAll('.app-nav-btn[data-target]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); // prevent bubbling to delegated handler in app-specific main.ts
            const targetId = (e.currentTarget as HTMLElement).dataset.target;
            if (!targetId) return;
            const lastId = managerCache.get(targetId)?.getActiveResourceId() ?? null;
            updateHistory(targetId, lastId, 'push');
            performNavigation(targetId, lastId ?? undefined);
        }, { signal: navigationSignal });
    });

    document.addEventListener(NAVIGATION_EVENTS.NAVIGATE, (e) => {
        const req = (e as CustomEvent).detail as NavigationRequest;
        if (req?.target) handleNavigationRequest(req);
    }, { signal: navigationSignal });

    window.addEventListener('popstate', (e) => {
        const state = e.state as { workspaceId: string; resourceId?: string } | null;
        if (state) {
            performNavigation(state.workspaceId, state.resourceId);
        } else {
            const parts = location.hash.slice(2).split('/');
            const slug  = parts[0] || resolvedDefault;
            const resource = parts[1] ? decodeURIComponent(parts[1]) : undefined;
            performNavigation(resolveTarget(slug), resource === 'new' ? undefined : resource);
        }
    }, { signal: navigationSignal });

    // ── 9. Initial navigation ──────────────────────────────────────────────────

    onProgress?.('加载工作区…');
    const parts    = location.hash.slice(2).split('/');
    const initSlug = parts[0] || resolvedDefault;
    const initId   = parts[1] ? decodeURIComponent(parts[1]) : undefined;
    const initWs   = resolveTarget(initSlug);

    await performNavigation(initWs, initId === 'new' ? undefined : initId);
    updateHistory(initWs, initId ?? null, 'replace');

    // ── AppHandle ──────────────────────────────────────────────────────────────

    return {
        vfs,
        sessionFiles,
        runtime,

        async navigate(slug: string, resourceId?: string): Promise<void> {
            const wsId = resolveTarget(slug);
            updateHistory(wsId, resourceId ?? null, 'push');
            await performNavigation(wsId, resourceId);
        },

        async setTheme(mode: ThemeMode): Promise<void> {
            await themeService.setMode(mode);
        },

        addWorkspace(config: WorkspaceConfig): void {
            if (!config.files) throw new Error('Dynamic workspace requires a file context');
            workspaceFiles.set(config.elementId, config.files);
            workspaces.push(config);
            registerWorkspaceRoute(config);
        },

        async removeWorkspace(elementId: string): Promise<void> {
            const index = workspaces.findIndex(ws => ws.elementId === elementId);
            if (index < 0) return;
            await managerCache.get(elementId)?.destroy();
            managerCache.delete(elementId); workspaceFiles.delete(elementId);
            workspaces.splice(index, 1);
            for (const [slug, id] of Object.entries(routeMap)) if (id === elementId) delete routeMap[slug];
            delete reverseRouteMap[elementId];
        },
        onDestroy(cleanup: () => void | Promise<void>, phase: 'consumers' | 'sources' = 'consumers'): void {
            (phase === 'sources' ? sourceCleanupFns : cleanupFns).push(cleanup);
        },

        async destroy(): Promise<void> {
            for (const fn of [...cleanupFns].reverse().concat([...sourceCleanupFns].reverse())) {
                try { await fn(); } catch (error) { console.error('[App] Cleanup failed', error); }
            }
            cleanupFns.length = 0; sourceCleanupFns.length = 0;
        },
    };
    } catch (error) {
        for (const close of [...cleanupFns].reverse().concat([...sourceCleanupFns].reverse())) {
            try { await close(); } catch (cleanupError) { console.error('[App] Startup cleanup failed', cleanupError); }
        }
        throw error;
    }
}
