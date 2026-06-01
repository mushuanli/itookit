// shell/Assembler.ts
/**
 * @file vfs-ui/shell/Assembler.ts
 * @desc Composition Root — 唯一允许引用所有具体类的地方。
 *       职责：创建实例、注入依赖、连接生命周期。
 *       不承担任何业务逻辑或公共 API。
 */
import type { IModuleFS } from '@itookit/common';
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
    service: VFSService;
    engineAdapter: EngineAdapter;
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
    engine: IModuleFS
): AssembledParts {
    // --- Services ---
    const scopeId = options.scopeId || engine.moduleId || 'default';
    const persistence = new StatePersistence(scopeId);
    const persisted = persistence.load();

    const store = new VFSStore({
        ...options.initialState,
        ...persisted,
        uiSettings: {
            ...DEFAULT_SETTINGS,
            ...options.defaultUiSettings,
            ...persisted.uiSettings,
            ...options.initialState?.uiSettings,
        },
        isSidebarCollapsed: options.initialSidebarCollapsed,
        readOnly: options.readOnly || false,
    });

    const registry = new FileTypeRegistry(
        options.defaultEditorFactory,
        options.customEditorResolver
    );
    options.fileTypes?.forEach(def => registry.register(def));

    const service = new VFSService({
        engine,
        defaultExtension: options.defaultExtension,
        newFileContent: options.fileCreation?.content,
    });

    const engineAdapter = new EngineAdapter(engine, store, registry, options.showFileExtensions ?? false);

    // --- Interaction ---
    const commandBus = new CommandBus();
    const eventBus = new EventBus();

    const handlers = [
        new FileCommandHandler(commandBus, store, service, {
            newFileContent: options.fileCreation?.content,
            defaultFileName: options.fileCreation?.startupFileName,
            defaultFileContent: options.fileCreation?.startupContent,
            readContent: async (id) => {
                const c = await engine.driver.readContent(id);
                return typeof c === 'string' ? c : c instanceof ArrayBuffer ? c : c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer;
            },
            getDuplicateTransformer: (ext) => registry.getDuplicateTransformer(ext),
        }),
        new NavigationCommandHandler(commandBus, store, eventBus),
        new UICommandHandler(commandBus, store),
        new SelectionCommandHandler(commandBus, store),
        new BulkCommandHandler(commandBus, store, service),
        new ImportCommandHandler(
            commandBus,
            store,
            service,
            () => engineAdapter.loadData()
        ),
        new ExportCommandHandler(commandBus, service, engine),
        new CustomMenuCommandHandler(commandBus, eventBus),
    ];

    // --- Lifecycle ---
    if (!options.readOnly) {
        persistence.connectAutoSave(store);
    }

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
