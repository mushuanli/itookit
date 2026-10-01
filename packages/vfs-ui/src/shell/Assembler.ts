import { SourceAdapter } from '../browser/SourceAdapter';
// shell/Assembler.ts
/**
 * @file vfs-ui/shell/Assembler.ts
 * @desc Composition Root — 唯一允许引用所有具体类的地方。
 *       职责：创建实例、注入依赖、连接生命周期。
 *       不承担任何业务逻辑或公共 API。
 */
import type { IFileSystem } from '@itookit/vfs-core';
import type { IStatePort, ICommandPort, IEventPort, IFileTypePort } from '../contracts/ports';

import { VFSStore } from '../services/VFSStore';
import { VFSService } from '../services/VFSService';
import { FileTypeRegistry } from '../services/FileTypeRegistry';
import { EngineAdapter } from '../services/EngineAdapter';
import { createLocalStorageUIPersistence, readUISnapshot, uiSnapshot, type RestoredUISnapshot, type UIPersistencePort } from '../contracts/persistence';

import { CommandBus } from '../interaction/CommandBus';
import { EventBus } from '../interaction/EventBus';
import { FileCommandHandler } from '../interaction/handlers/FileCommandHandler';
import { NavigationCommandHandler } from '../interaction/handlers/NavigationCommandHandler';
import { UICommandHandler } from '../interaction/handlers/UICommandHandler';
import { SelectionCommandHandler } from '../interaction/handlers/SelectionCommandHandler';
import { BulkCommandHandler } from '../interaction/handlers/BulkCommandHandler';
import { ImportCommandHandler } from '../interaction/handlers/ImportCommandHandler';
import { ExportCommandHandler } from '../interaction/handlers/ExportCommandHandler';
import { CustomMenuCommandHandler } from '../interaction/handlers/CustomMenuCommandHandler';

import type { VFSUIShellOptions } from './VFSUIShell';

/**
 * 组装结果：所有通过接口暴露的已连接实例
 */
export interface AssembledParts {
    // 通过接口暴露 — Shell 只看到接口
    store: IStatePort;
    commandBus: ICommandPort;
    eventBus: IEventPort;
    fileTypePort: IFileTypePort;
    service?: VFSService;
    engineAdapter: EngineAdapter | SourceAdapter;
    /** Disconnect the persistence subscription; the port's own `destroy` is called by the shell. */
    disconnectPersistence: () => void;

    // Handler 析构列表
    destroyHandlers: () => void;
}

const DEFAULT_SETTINGS = {
    sortBy: 'title' as const,
    density: 'comfortable' as const,
    showSummary: true,
    showTags: true,
    showBadges: true,
};

/**
 * Persistence is off unless the host asks for it: `true` uses the bundled
 * localStorage adapter, an object is a host-owned port (VFS, Tauri store).
 */
function resolvePersistence(persistence: VFSUIShellOptions['persistence'], scopeId: string): UIPersistencePort | undefined {
    if (persistence === true) return createLocalStorageUIPersistence(scopeId);
    return persistence && typeof persistence === 'object' ? persistence : undefined;
}

/** A host port may throw or hand back junk; a broken record must not block the browser. */
function loadPersisted(port?: UIPersistencePort): RestoredUISnapshot {
    if (!port?.load) return {};
    try { return readUISnapshot(port.load()) ?? {}; }
    catch (error) { console.error('[vfs-ui] Failed to read persisted UI state:', error); return {}; }
}

/** Persist the projected snapshot after each real state change, not per field. */
function connectPersistence(store: IStatePort, port: UIPersistencePort): () => void {
    let previous = '';
    return store.subscribe(state => {
        let snapshot: ReturnType<typeof uiSnapshot>;
        try { snapshot = uiSnapshot(state); } catch { return; }
        const json = JSON.stringify(snapshot);
        if (json === previous) return;
        previous = json;
        try { port.save(snapshot); }
        catch (error) { console.error('[vfs-ui] Failed to persist UI state:', error); }
    });
}

export function assemble(
    options: VFSUIShellOptions,
    engine?: IFileSystem
): AssembledParts {
    // --- Services ---
    const scopeId = options.scopeId || engine?.viewId || 'default';
    const persistence = resolvePersistence(options.persistence, scopeId);
    const persisted = loadPersisted(persistence);
    const restoredExpansion = persisted.expandedFolderIds ?? options.initialState?.expandedFolderIds ?? [];

    const store = new VFSStore({
        ...options.initialState,
        // A restored snapshot always wins over the caller's default, including an
        // explicit `null` that clears the previous selection.
        ...(persisted.activeId !== undefined ? { activeId: persisted.activeId } : {}),
        ...(persisted.selectedItemIds ? { selectedItemIds: new Set(persisted.selectedItemIds) } : {}),
        ...(options.restoreExpandedDirectory
            ? { expandedFolderIds: new Set([...new Set(restoredExpansion)].filter(options.restoreExpandedDirectory)) }
            : persisted.expandedFolderIds ? { expandedFolderIds: new Set(persisted.expandedFolderIds) } : {}),
        uiSettings: {
            ...DEFAULT_SETTINGS,
            ...options.defaultUiSettings,
            ...persisted.uiSettings,
            ...options.initialState?.uiSettings,
        },
        isSidebarCollapsed: options.initialSidebarCollapsed ?? persisted.isSidebarCollapsed ?? options.initialState?.isSidebarCollapsed ?? false,
        readOnly: options.readOnly || false,
    });
    store.setIndependentExpansion(options.columns?.navigationCard);

    const registry = new FileTypeRegistry();
    options.fileTypes?.forEach(def => registry.register(def));

    const service = engine && new VFSService({
        engine,
        defaultExtension: options.defaultExtension,
        newFileContent: options.fileCreation?.content,
    });

    const engineAdapter = options.source ? new SourceAdapter(options.source, store, options.onError) : new EngineAdapter(engine!, store, registry, options.showFileExtensions ?? false, options.alwaysLoadedDirectories, options.hideGitignored ?? true);

    // Wire auto-expand: when a file is created inside an unexpanded directory,
    // trigger a full load so all siblings are visible (not just the new file).
    store.setOnExpandNeeded((folderId) => engineAdapter.expandDirectory(folderId));

    // --- Interaction ---
    const commandBus = new CommandBus();
    const eventBus = new EventBus();

    const handlers = [
        ...(service && engine ? [
        new FileCommandHandler(commandBus, store, service, {
            resolveParent: options.fileCreation?.resolveParent,
            newFileContent: options.fileCreation?.content,
            defaultFileName: options.fileCreation?.startupFileName,
            defaultFileContent: options.fileCreation?.startupContent,
            readContent: async (id) => {
                const c = await engine.driver.readContent(id);
                return typeof c === 'string' ? c : c instanceof ArrayBuffer ? c : c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer;
            },
            getDuplicateTransformer: (ext) => registry.getDuplicateTransformer(ext),
        }),
        new BulkCommandHandler(commandBus, store, service),
        new ImportCommandHandler(
            commandBus,
            store,
            service,
            () => engineAdapter.loadData(),
            options.fileCreation?.resolveParent,
        ),
        new ExportCommandHandler(commandBus, service, engine, { exportItem: options.exportItem }),
        ] : []),
        new UICommandHandler(commandBus, store, service, options.fileCreation?.resolveParent),
        new NavigationCommandHandler(commandBus, store, eventBus),
        new SelectionCommandHandler(commandBus, store),
        new CustomMenuCommandHandler(commandBus, eventBus),
    ];

    // --- Lifecycle ---
    const disconnectPersistence = persistence ? connectPersistence(store, persistence) : () => {};

    return {
        store,
        commandBus,
        eventBus,
        fileTypePort: registry,
        service,
        engineAdapter,
        disconnectPersistence,
        destroyHandlers: () => handlers.forEach(h => h.destroy()),
    };
}
