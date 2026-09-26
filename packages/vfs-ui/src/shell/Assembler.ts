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
import { StatePersistence } from '../services/StatePersistence';

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
    persistence: StatePersistence;

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

export function assemble(
    options: VFSUIShellOptions,
    engine?: IFileSystem
): AssembledParts {
    // --- Services ---
    const scopeId = options.scopeId || engine?.viewId || 'default';
    const persistence = new StatePersistence(scopeId, options.persistence !== false);
    const persisted = persistence.load();

    const store = new VFSStore({
        ...options.initialState,
        ...persisted,
        ...(options.restoreExpandedDirectory ? { expandedFolderIds: new Set(
            [...new Set(persisted.expandedFolderIds ?? options.initialState?.expandedFolderIds ?? [])]
                .filter(options.restoreExpandedDirectory),
        ) } : {}),
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

    const engineAdapter = options.source ? new SourceAdapter(options.source, store, options.onError) : new EngineAdapter(engine!, store, registry, options.showFileExtensions ?? false, options.alwaysLoadedDirectories);

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
    persistence.connectAutoSave(store);

    return {
        store,
        commandBus,
        eventBus,
        fileTypePort: registry,
        service,
        engineAdapter,
        persistence,
        destroyHandlers: () => handlers.forEach(h => h.destroy()),
    };
}
