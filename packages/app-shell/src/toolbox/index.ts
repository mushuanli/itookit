import { ToolboxResources, workspaceRoot, type ApplicationRuntime } from '@itookit/app-core';
import type { IFileSystem } from '@itookit/vfs-core';
import type { NavigationRequest } from '@itookit/common';
import type { EditorFactory } from '@itookit/ui-common';
import type { AppUI } from '../types';
import type { VFSNodeUI } from '@itookit/vfs-ui';
import { ToolboxInventory } from '@itookit/app-core';
import { ToolboxWorkbench } from './ToolboxWorkbench';
import { ToolDetailsEditor } from './ToolDetailsEditor';
import { createWorkspaceModule, type WorkspaceModule } from '../workspaces/module';

interface Options {
    runtime: Pick<ApplicationRuntime, 'vfs' | 'agentService' | 'commandBus' | 'kernel' | 'flowEngine' | 'configuration'>;
    ui: Pick<AppUI, 'llmUiEditors' | 'createFlowContextMenu'>;
    sidebar: HTMLElement; editor: HTMLElement; skills: IFileSystem;
    factories: Record<'agents' | 'skills' | 'flows', EditorFactory>;
    navigate(request: NavigationRequest): Promise<void>; selected(path: string | null): void;
}
/** The toolbox owns its projection lifetime and editor wiring as one module. */
export async function createToolboxModule(options: Options): Promise<WorkspaceModule> {
    const { agentService, commandBus, kernel, vfs, flowEngine } = options.runtime;
    const inventory = new ToolboxInventory(() => agentService.getMCPServers(), kernel.toolCatalog, agentService);
    try {
        await inventory.init();
        const resources = new ToolboxResources({ agents: await vfs.openFileSystem(workspaceRoot('agents')),
            skills: options.skills, flows: flowEngine.engine, ...inventory.sources }, agentService, commandBus, await vfs.openFileSystem('/etc'));
        const factories = configurationFactories(options, inventory, resources);
        const workbench = new ToolboxWorkbench({ ...options, inventory, resources, factories, configuration: options.runtime.configuration,
            flowMenu: options.ui.createFlowContextMenu<VFSNodeUI>({ commands: commandBus,
                navigate: id => options.navigate({ target: 'chat', resourceId: id }) }) });
        return createWorkspaceModule(workbench, async () => { try { await workbench.destroy(); } finally { await inventory.dispose(); } });
    } catch (error) { await inventory.dispose(); throw error; }
}
function configurationFactories(options: Options, inventory: ToolboxInventory, resources: ToolboxResources) {
    const { agentService } = options.runtime, editors = options.ui.llmUiEditors;
    const create = (Editor: typeof editors.ProviderSettingsEditor): EditorFactory => async (element, config) => {
        const editor = new Editor(element, agentService, config); await editor.init(element); return editor;
    };
    return { ...options.factories, providers: create(editors.ProviderSettingsEditor), connections: create(editors.ConnectionSettingsEditor),
        mcp: async (element: HTMLElement, config: import('@itookit/ui-common').EditorOptions) => {
            const editor = new editors.MCPSettingsEditor(element, agentService, config); await editor.init(element); return editor;
        }, tools: async (element: HTMLElement, config: import('@itookit/ui-common').EditorOptions) => {
            const editor = new ToolDetailsEditor(element, inventory, config, resources); await editor.init(element); return editor;
        } };
}
