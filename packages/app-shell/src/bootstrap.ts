import { MemoryManager } from '@itookit/memory-manager';
import { FileTypeDefinition } from '@itookit/vfs-ui';
import { NavigationRequest, NAVIGATION_EVENTS, EditorFactory, MenuItem } from '@itookit/common';
import type { LLMSkill, SkillDefinition, SkillToolBinding, ToolVFSContext, IVFSManager } from '@itookit/common';
import { createVFS } from '@itookit/vfslib';
import { createSettingsModule, createSettingsFactory } from '@itookit/app-settings';
import {
    createLLMFactory,
    createAgentEditorFactory,
    VFSAgentService,
    createAIContextMenuConfig,
} from '@itookit/llm-ui';
import { initializeLLMEngine, LLMSessionEngine, chatFileParser } from '@itookit/llm-engine';
import { LLMDeviceDriver } from '@itookit/device-llm';
import { setKernelDeviceManager } from '@itookit/llm-kernel';
import { createHarness, type HarnessInstance } from '@itookit/llm-harness';
import { SkillsEngine } from '@itookit/app-settings';
import { createSkillsEditorFactory } from '@itookit/llm-ui';

import { AppOptions, AppHandle, WorkspaceConfig } from './types';
import {
    StandardWorkspaceStrategy,
    SettingsWorkspaceStrategy,
    ChatWorkspaceStrategy,
} from './strategies/index';
import { WorkspaceStrategy } from './strategies/types';
import { FILE_REGISTRY, EditorTypeKey } from './config/file-registry';

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

// ── VFS ToolContext adapter ────────────────────────────────────────────────────
//
// Provides ToolVFSContext so harness file tools (file_read, file_write,
// glob_search, grep_search) can access the virtual filesystem (IndexedDB)
// in browser environments instead of the unavailable node:fs/promises.
//
// Path convention: tools use paths relative to the injected cwd.
// The VFS manager resolves these against the CONFIG_MODULE ('etc') by default;
// for workspace-specific access the tool cwd should be set to the module path.

function createVFSToolContext(vfsManager: IVFSManager): ToolVFSContext {
    // Use the global VFS manager's search and I/O to fulfil tool requests.
    return {
        async readFile(path: string): Promise<string> {
            const nodeId = await vfsManager.resolvePath(path);
            if (!nodeId) throw new Error(`VFS file not found: ${path}`);
            const raw = await vfsManager.readContent(nodeId);
            return typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
        },

        async writeFile(path: string, content: string): Promise<void> {
            await vfsManager.write(path, content);
        },

        async listFiles(dir?: string): Promise<string[]> {
            const query = dir ? `type:file` : `type:file`;
            const results = await vfsManager.search({ text: '', filters: query ? [query] : [] }).catch(() => []);
            // Return relative paths within the requested dir
            return results
                .map((n) => n.path ?? '')
                .filter((p) => !dir || p.startsWith(dir))
                .map((p) => dir ? p.slice(dir.length).replace(/^\//, '') : p);
        },
    };
}

// ── LLMSkill → SkillDefinition bridge ─────────────────────────────────────────
//
// Two independent skill stores exist:
//   - LLMSkill   (device-llm / VFS)          — user-configured, persisted
//   - SkillDefinition (harness SkillDeviceDriver) — runtime, in-memory
//
// This bridge ensures the harness skill picker always reflects the VFS skills.

function llmSkillToSkillDef(s: LLMSkill): SkillDefinition {
    // For http / shell type skills, build a SkillToolBinding so the harness
    // can register and invoke the tool when the skill is loaded.
    const hasTool = (s.type === 'http' || s.type === 'shell') && s.parameters;
    const tools: SkillToolBinding[] = hasTool ? [{
        toolId: `${s.id}__tool`,
        definition: {
            name: `${s.id}__tool`,
            description: s.description ?? s.name,
            parameters: s.parameters as Record<string, unknown>,
        },
        executionType: s.type as 'http' | 'shell',
        command: s.command,
        sideEffect: s.type === 'http' ? 'external' : 'local',
        timeoutMs: 30_000,
    }] : [];

    return {
        id:          s.id,
        name:        s.name,
        description: s.description ?? '',
        type:        s.type as SkillDefinition['type'],
        enabled:     s.enabled,
        icon:        s.icon,
        instructions: s.instructions ?? '',
        tools,
        triggerPatterns: [],
        autoLoad:    false,
        priority:    50,
        endpoint:    s.endpoint,
        method:      s.method,
        headers:     s.headers,
        parameters:  s.parameters as Record<string, unknown> | undefined,
        metadata:    s.metadata,
        createdAt:   s.createdAt,
        modifiedAt:  s.modifiedAt,
    };
}

async function syncSkillsToHarness(
    llmDriver: LLMDeviceDriver,
    harness: HarnessInstance,
): Promise<void> {
    const llmSkills = await llmDriver.getSkills();
    // Snapshot current harness skill IDs to detect deletions.
    const harnessIds = new Set(harness.skillService.getSkillNames());

    for (const s of llmSkills) {
        await harness.skillService.saveSkill(llmSkillToSkillDef(s));
        harnessIds.delete(s.id);
    }

    // Remove skills that were deleted from VFS.
    for (const id of harnessIds) {
        await harness.skillService.deleteSkill(id);
    }
}

export async function initApp(options: AppOptions): Promise<AppHandle> {
    const { backend, additionalMounts, defaultSlug, routeAliases = {}, onProgress } = options;

    // Mutable workspaces list — addWorkspace() appends here at runtime
    const workspaces: WorkspaceConfig[] = [...options.workspaces];

    const mentionableModules = (): string[] =>
        workspaces.filter(ws => ws.mentionAble === true).map(ws => ws.moduleName);

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

    // ── 1. VFS ─────────────────────────────────────────────────────────────────

    onProgress?.('初始化文件系统…');
    const { manager: vfs } = await createVFS({
        rootBackend: backend,
        additionalMounts,
        modules: workspaces
            .filter(ws => ws.type !== 'settings')
            .map(ws => ({
                name: ws.moduleName,
                options: {
                    description: ws.title,
                    isProtected: ws.isProtected,
                    syncEnabled: ws.syncEnabled,
                    isSystem: ws.isSystem,
                },
            })),
    });

    // ── 2. LLM device driver ───────────────────────────────────────────────────

    onProgress?.('加载 LLM 驱动…');
    const llmDriver = new LLMDeviceDriver(vfs);
    await llmDriver.init();
    vfs.devices.register(llmDriver);
    await llmDriver.createDeviceNodes();
    setKernelDeviceManager(vfs.devices);

    // ── 3. Core services ───────────────────────────────────────────────────────

    onProgress?.('初始化核心服务…');
    const settingsModule = await createSettingsModule(vfs);
    const agentService   = new VFSAgentService(vfs, llmDriver);
    const sessionEngine  = new LLMSessionEngine(vfs);

    // Harness: AgentLoopExecutor + built-in tools + skill service.
    // createHarness() reads the default LLM connection from llmDriver automatically.
    const harness = await createHarness({ llmDriver });

    // Inject VFS context so file tools work with the virtual filesystem in browser.
    // When node:fs is unavailable, tools fall back to ctx.vfs (ToolVFSContext).
    harness.toolDriver.setVFSContext(createVFSToolContext(vfs));

    // Bridge: sync VFS LLMSkills → harness SkillDefinition so /skills, /skill <id>,
    // and the skill picker panel all show the user's configured skills.
    await syncSkillsToHarness(llmDriver, harness);
    // Keep skills in sync when the user adds / edits / deletes skills in Settings.
    llmDriver.onChange(() => { syncSkillsToHarness(llmDriver, harness).catch(() => {}); });

    await initializeLLMEngine({
        agentService,
        sessionEngine,
        maxConcurrent:       20,
        harnessRuntime:      harness.runtime,
        harnessSkillService: harness.skillService,
        harnessToolService:  harness.toolService,
    });

    const settingsFactory = createSettingsFactory(settingsModule.service, agentService, llmDriver);
    const llmFactory      = createLLMFactory(agentService);
    const agentFactory    = createAgentEditorFactory(agentService);

    // Skills workspace: VFSUIShell list (SkillsEngine) + form editor (SkillSettingsEditor)
    const skillsEngine  = new SkillsEngine(agentService);
    const skillsFactory = createSkillsEditorFactory(agentService);

    // ── 4. Workspace strategies ────────────────────────────────────────────────

    const strategies: Record<string, WorkspaceStrategy> = {
        standard: new StandardWorkspaceStrategy(vfs),
        agent:    new StandardWorkspaceStrategy(vfs),
        settings: new SettingsWorkspaceStrategy(settingsFactory, settingsModule.engine),
        chat:     new ChatWorkspaceStrategy(llmFactory, sessionEngine),
        skills:   new SettingsWorkspaceStrategy(skillsFactory, skillsEngine),  // reuse the same strategy pattern
    };

    const editorFactoryMap: Record<EditorTypeKey, EditorFactory | undefined> = {
        standard: strategies.standard.getFactory(),
        agent:    agentFactory as EditorFactory,
        chat:     llmFactory as EditorFactory,
    };

    // ── 5. File type resolver ──────────────────────────────────────────────────

    const getFileTypeDef = (typeId: string): FileTypeDefinition | null => {
        const def = FILE_REGISTRY[typeId];
        if (!def) { console.warn(`[app-shell] Unknown file type: ${typeId}`); return null; }
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

    // ── 6. Manager cache + workspace loader ────────────────────────────────────

    const managerCache = new Map<string, MemoryManager>();
    // Deduplicate concurrent loads: if the same workspace is loading, reuse the promise.
    const pendingLoads = new Map<string, Promise<MemoryManager | undefined>>();

    const doLoadWorkspace = async (
        wsConfig: WorkspaceConfig,
        initialResourceId?: string,
    ): Promise<MemoryManager | undefined> => {
        const { elementId } = wsConfig;

        const container = document.getElementById(elementId);
        if (!container) {
            console.warn(`[Shell] doLoadWorkspace: container #${elementId} not found in DOM`);
            return undefined;
        }

        const strategyType = wsConfig.type ?? 'standard';
        const strategy = strategies[strategyType] ?? strategies.standard;

        const { moduleName, plugins, mentionScope, aiEnabled, supportedFileTypes, ...uiPassThrough } = wsConfig;

        const fileTypes: FileTypeDefinition[] = (supportedFileTypes ?? [])
            .map(id => getFileTypeDef(id))
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
                items: (_item: object, defaults: MenuItem[]) => {
                    if (uiPassThrough.readOnly) return [];
                    if (aiContextMenu?.items) return aiContextMenu.items(_item, defaults);
                    return defaults;
                },
            },
            // Skills workspace: summary=skill ID, tags="disabled" pill, dot=enabled.
            ...(strategyType === 'skills' && {
                defaultUiSettings: { showSummary: true, showTags: true, showBadges: false },
            }),
        };

        const manager = new MemoryManager({
            container,
            customEngine:  strategy.getEngine?.(moduleName),
            moduleName,
            editorFactory: strategy.getFactory(),
            scopeId:       elementId,
            fileTypes,
            uiOptions,
            editorConfig: {
                plugins:      plugins ?? [],
                readOnly:     false,
                mentionScope: mentionScope?.[0] === '*' ? mentionableModules() : mentionScope,
            },
            aiConfig: { enabled: aiEnabled ?? true },
            onNavigate:      async (req: NavigationRequest) => handleNavigationRequest(req),
            onSessionChange: (sessionId) => updateHistory(elementId, sessionId, 'replace'),
        });

        // Start without resourceId to avoid double sessionSelected race with LLMFactory.
        await manager.start();
        managerCache.set(elementId, manager);

        if (initialResourceId && manager.getActiveSessionId() !== initialResourceId) {
            await manager.openFile(initialResourceId);
        }

        // If a loading overlay is in use, wait until the editor is actually visible
        // before letting the caller dismiss the overlay.
        if (onProgress) await waitForEditorMount(container);

        return manager;
    };

    /** Deduplicated workspace loader: concurrent calls for the same elementId share one promise. */
    const loadWorkspace = (
        wsConfig: WorkspaceConfig,
        initialResourceId?: string,
    ): Promise<MemoryManager | undefined> => {
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
        const ws = workspaces.find(w => w.moduleName === target);
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
            await managerCache.get(workspaceId)!.openFile(resourceId);
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
                        const newId = await mgr.createAndOpenFile({
                            title:    req.create?.title,
                            content:  req.create?.content,
                            parentId: req.create?.parentId,
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
                updateHistory(targetWsId, req.resourceId ?? null, 'push');
                await performNavigation(targetWsId, req.resourceId);
            }
        }
    };

    // ── 8. Event bindings ──────────────────────────────────────────────────────

    document.querySelectorAll('.app-nav-btn[data-target]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); // prevent bubbling to delegated handler in app-specific main.ts
            const targetId = (e.currentTarget as HTMLElement).dataset.target;
            if (!targetId) return;
            const lastId = managerCache.get(targetId)?.getActiveSessionId() ?? null;
            updateHistory(targetId, lastId, 'push');
            performNavigation(targetId, lastId ?? undefined);
        });
    });

    document.addEventListener(NAVIGATION_EVENTS.NAVIGATE, (e) => {
        const req = (e as CustomEvent).detail as NavigationRequest;
        if (req?.target) handleNavigationRequest(req);
    });

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
    });

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

        async navigate(slug: string, resourceId?: string): Promise<void> {
            const wsId = resolveTarget(slug);
            updateHistory(wsId, resourceId ?? null, 'push');
            await performNavigation(wsId, resourceId);
        },

        addWorkspace(config: WorkspaceConfig): void {
            workspaces.push(config);
            registerWorkspaceRoute(config);
        },
    };
}
