import { FileTypeDefinition } from '@itookit/vfs-ui';
import { NavigationRequest, NAVIGATION_EVENTS, EditorFactory, MenuItem, formatDefaultFileTitle } from '@itookit/common';
import type { LLMSkill, SkillDefinition, SkillToolBinding, ToolVFSContext, IVFSManager, FSNode } from '@itookit/common';
import { createVFS } from '@itookit/vfslib';
import { createSettingsModule, createSettingsFactory } from '@itookit/app-settings';
import {
    createLLMFactory,
    createAgentEditorFactory,
    VFSAgentService,
    createAIContextMenuConfig,
} from '@itookit/llm-ui';
import { initializeLLMEngine, ChatEngine, chatFileParser } from '@itookit/llm-engine';
import type { SessionManager } from '@itookit/llm-engine';
import { MemoryManager } from '@itookit/memory-manager';
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

// ── HITL → vfs-ui bridge ───────────────────────────────────────────────────────
//
// When a background session's agent calls human_input, the SessionManager emits
// session_hitl_active / session_hitl_resolved RegistryEvents. This bridge
// translates those into VFSStore state so the session list renders an orange
// pulsing indicator on the waiting session's .chat file entry.

function setupHitlVfsBridge(sessionManager: SessionManager, manager: MemoryManager): () => void {
    // NOTE: This bridge is "eventual" — it only responds to events that fire
    // AFTER the workspace is loaded. Sessions that started waiting before the
    // workspace loaded won't be highlighted until the NEXT input request.
    // In practice this is not an issue because chat workspaces are loaded at
    // app startup, before any background session can trigger human_input.
    return sessionManager.onGlobalEvent((event) => {
        if (event.type === 'session_hitl_active') {
            const runtime = sessionManager.getSessionRuntime(event.payload.sessionId);
            if (runtime) {
                manager.setNodeWaitingInput(runtime.nodeId, true);
            }
        } else if (event.type === 'session_hitl_resolved') {
            const runtime = sessionManager.getSessionRuntime(event.payload.sessionId);
            if (runtime) {
                manager.setNodeWaitingInput(runtime.nodeId, false);
            }
        } else if (event.type === 'session_status_changed') {
            // Defensive cleanup: if the session is no longer running (aborted /
            // completed / failed), clear any lingering waiting-input indicator.
            // This covers abort() during HITL wait, which calls hitlQueue.abortAll()
            // but does NOT emit agent:human:resolved.
            const stopped = event.payload.status !== 'running' && event.payload.status !== 'queued';
            if (stopped) {
                const runtime = sessionManager.getSessionRuntime(event.payload.sessionId);
                if (runtime) {
                    manager.setNodeWaitingInput(runtime.nodeId, false);
                }
            }
        }
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
    /**
     * Resolve a user-facing path to a VFS node.
     *
     * Supported input formats (all used by MentionPlugin / resolveAtPath):
     *   ./t2.chat          → filename search
     *   t2.chat            → filename search
     *   /absolute/path     → filename = last segment, search by name
     *
     * The search checks all non-system modules (chats, minds, etc.).
     * Returns { moduleId, nodePath, nodeId } on success.
     */
    async function resolveToNode(path: string) {
        // Normalise: strip leading ./ and extract the basename for name-based search.
        const clean    = path.replace(/^\.\//, '');
        const filename = clean.split('/').pop() ?? clean;

        const result = await vfsManager.search({
            name:  { exact: filename },
            type:  'file',
            limit: 20,
        });

        // Prefer an exact path match; fall back to the first result.
        const node = result.nodes.find(
            (n: FSNode) => n.path === `/${clean}` || n.path === `/${filename}` || n.name === filename,
        ) ?? result.nodes[0];

        if (!node || !node.moduleId) {
            throw new Error(`VFS file not found: ${path}`);
        }
        return node;
    }

    return {
        async readFile(path: string): Promise<string> {
            const node = await resolveToNode(path);
            // vfs.read(moduleName, moduleRelativePath) → FileContent
            const raw = await vfsManager.read(node.moduleId!, node.path);
            return typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
        },

        async writeFile(path: string, content: string): Promise<void> {
            // Find the file to know its module; write via the module engine.
            const clean = path.replace(/^\.\//, '');
            const filename = clean.split('/').pop() ?? clean;
            const result = await vfsManager.search({ name: { exact: filename }, type: 'file', limit: 5 });
            if (result.nodes.length > 0 && result.nodes[0].moduleId) {
                const node = result.nodes[0];
                await vfsManager.write(node.moduleId!, node.path, content);
            } else {
                throw new Error(`VFS write failed: cannot locate module for "${path}". File must already exist.`);
            }
        },

        async listFiles(dir?: string): Promise<string[]> {
            const result = await vfsManager.search({ type: 'file', limit: 500 });
            return result.nodes
                .filter((n: FSNode) => n.type === 'file')
                .map((n: FSNode) => n.path)
                .filter((p: string) => !dir || p.includes(dir));
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
        triggerStrategy: s.triggerStrategy,
        autoLoad:    s.autoLoad ?? (s.triggerStrategy === 'reference'),
        priority:    s.priority ?? 50,
        globs:       s.globs ?? [],
        correctionLog: s.correctionLog ? { path: s.correctionLog, enabled: true } : undefined,
        disableModelInvocation: s.disableModelInvocation ?? false,
        source:      'vfs',
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
    const { backend, additionalMounts, defaultSlug, routeAliases = {}, onProgress, llmLogger } = options;
    const t0 = performance.now();
    let t = t0;
    const cleanupFns: Array<() => void> = [];
    const logStep = (label: string) => {
        const now = performance.now();
        console.log(`[Boot] ${label}: +${(now - t).toFixed(0)}ms (累计 ${(now - t0).toFixed(0)}ms)`);
        t = now;
        onProgress?.(label);
    };

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

    logStep('初始化文件系统…');
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

    // Helper to dump VFS I/O counters (for identifying redundant reads/writes)
    const logIO = (label: string) => {
        try {
            const s = (vfs as any)._engine?.ioStats;
            if (s) console.log(`[Boot]   ↳ IO after ${label}: stat=${s.stat} list=${s.list} read=${s.read} write=${s.write} mkdir=${s.mkdir} delete=${s.delete} rename=${s.rename}`);
            (vfs as any)._engine?.resetIOStats();
        } catch { /* ignore */ }
    };
    logIO('createVFS');

    // ── 2. LLM device driver ───────────────────────────────────────────────────

    logStep('加载 LLM 驱动…');
    const llmDriver = new LLMDeviceDriver(vfs, { llmLogger });
    let ts = performance.now();
    await llmDriver.init();
    console.log(`[Boot]   ↳ llmDriver.init: +${(performance.now() - ts).toFixed(0)}ms`);
    vfs.devices.register(llmDriver);
    ts = performance.now();
    await llmDriver.createDeviceNodes();
    console.log(`[Boot]   ↳ createDeviceNodes: +${(performance.now() - ts).toFixed(0)}ms`);
    setKernelDeviceManager(vfs.devices);
    vfs.devices.freeze();
    logIO('LLM driver');

    // ── 3. Core services ───────────────────────────────────────────────────────

    logStep('初始化核心服务…');
    const settingsModule = await createSettingsModule(vfs);
    const agentService   = new VFSAgentService(vfs, llmDriver);
    const sessionEngine  = new ChatEngine(vfs);

    // Harness: AgentLoopExecutor + built-in tools + skill service.
    // createHarness() reads the default LLM connection from llmDriver automatically.
    ts = performance.now();
    const harness = await createHarness({ llmDriver });
    console.log(`[Boot]   ↳ createHarness: +${(performance.now() - ts).toFixed(0)}ms`);

    // Inject VFS context so file tools work with the virtual filesystem in browser.
    // When node:fs is unavailable, tools fall back to ctx.vfs (ToolVFSContext).
    harness.toolDriver.setVFSContext(createVFSToolContext(vfs));

    // Bridge: sync VFS LLMSkills → harness SkillDefinition so /skills, /skill <id>,
    // and the skill picker panel all show the user's configured skills.
    ts = performance.now();
    await syncSkillsToHarness(llmDriver, harness);
    console.log(`[Boot]   ↳ syncSkillsToHarness: +${(performance.now() - ts).toFixed(0)}ms`);
    // Keep skills in sync when the user adds / edits / deletes skills in Settings.
    cleanupFns.push(
        llmDriver.onChange(() => { syncSkillsToHarness(llmDriver, harness).catch(() => {}); })
    );

    // Initialize file-system skill scope (Node.js / Tauri only; browser gracefully no-ops).
    // Scans _agent/skills/ directories from project root to CWD and registers FS skills.
    const cwd = typeof process !== 'undefined' && typeof process.cwd === 'function'
        ? process.cwd()
        : null;
    if (cwd) {
        ts = performance.now();
        await harness.skillService.setCwd(cwd).catch(() => {});
        console.log(`[Boot]   ↳ setCwd: +${(performance.now() - ts).toFixed(0)}ms`);
    }
    logIO('core services');

    logStep('初始化 LLM 引擎…');
    const { sessionManager } = await initializeLLMEngine({
        agentService,
        sessionEngine,
        maxConcurrent:       20,
        harnessRuntime:      harness.runtime,
        harnessSkillService: harness.skillService,
        harnessToolService:  harness.toolService,
    });

    const settingsFactory = createSettingsFactory(settingsModule.service, agentService, llmDriver);
    // Pass llmService only when the vision connection is actually configured —
    // this is the single place that knows both the harness and the connection list.
    const connections = await agentService.getConnections();
    const visionConnExists = connections.some(c => c.id === 'conn-volcengine-vision');
    const llmFactory = createLLMFactory(agentService, visionConnExists ? { llmService: harness.llmService } : undefined);
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
    const agentSearchFilter = (item: { metadata?: any; content?: any }, tokens: string[]) => {
        const corpus = [
            item.metadata?.title ?? '',
            item.content?.summary ?? '',
            item.content?.searchableText ?? '',
            (item.metadata?.custom?.ai_connectionLabel as string) ?? '',
        ].join(' ').toLowerCase();
        return tokens.every(t => corpus.includes(t));
    };

    const getFileTypeDef = (typeId: string): FileTypeDefinition | null => {
        const def = FILE_REGISTRY[typeId];
        if (!def) { console.warn(`[app-shell] Unknown file type: ${typeId}`); return null; }
        const factory = def.editorType !== 'standard' ? editorFactoryMap[def.editorType] : undefined;
        const parser  = def.id === 'chat' ? chatFileParser
                      : def.id === 'agent' ? agentFileParser
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

        const { moduleName, plugins, mentionScope, aiEnabled, supportedFileTypes, showFileExtensions, ...uiPassThrough } = wsConfig;

        const fileTypes: FileTypeDefinition[] = (supportedFileTypes ?? [])
            .map(id => getFileTypeDef(id))
            .filter((x): x is FileTypeDefinition => !!x);

        const primaryDef = supportedFileTypes?.[0] ? FILE_REGISTRY[supportedFileTypes[0]] : undefined;

        const aiContextMenu = (strategyType === 'chat' && !uiPassThrough.readOnly)
            ? createAIContextMenuConfig({ agentService, engine: sessionEngine })
            : null;

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
            // Agent workspace: include ai_connectionLabel in search corpus.
            ...(strategyType === 'agent' && {
                searchFilter: agentSearchFilter,
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
            showFileExtensions,
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

        // Bridge: session HITL status → vfs-ui session list highlight.
        // Calls manager.setNodeWaitingInput() which delegates to VFSUIShell internally,
        // keeping bootstrap decoupled from the concrete VFSUIShell type.
        cleanupFns.push(setupHitlVfsBridge(sessionManager, manager));

        if (initialResourceId && manager.getActiveSessionId() !== initialResourceId) {
            await manager.openFile(initialResourceId);
            // Only wait for editor mount if we actually opened a file —
            // otherwise no editor mounts and we'd hit the 15s timeout.
            if (onProgress) await waitForEditorMount(container);
        }

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
            const mgr = managerCache.get(workspaceId)!;
            const wasAlreadyOpen = mgr.getActiveSessionId() === resourceId;
            await mgr.openFile(resourceId);
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
                        const newId = await mgr.createAndOpenFile({
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

        destroy(): void {
            for (const fn of cleanupFns) {
                try { fn(); } catch { /* ignore */ }
            }
            cleanupFns.length = 0;
        },
    };
}
