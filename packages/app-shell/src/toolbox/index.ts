import { RemoteAgentDetailsEditor } from './RemoteAgentDetailsEditor';
import { createFileSystemView } from '@itookit/vfs-core';
import { listRemoteHarnessAgents } from '@itookit/app-core';
import { PiAgentMCPControls } from './pi-agent-controls';
import { MCPConfigurationControlsRegistry } from './mcp-controls';
import { PI_AGENT_EXTENSION, piAgentConfiguration } from '@itookit/app-core';
import { ToolboxResources, workspaceRoot, type ApplicationRuntime } from '@itookit/app-core';
import type { IFileSystem } from '@itookit/vfs-core';
import type { NavigationRequest } from '@itookit/common';
import type { EditorFactory } from '@itookit/ui-common';
import type { AppUI } from '../types';
import type { VFSNodeUI, UIPersistencePort } from '@itookit/vfs-ui';
import { ToolboxInventory } from '@itookit/app-core';
import { ToolboxWorkbench, type ToolboxPreferencesPort } from './ToolboxWorkbench';
import { ToolDetailsEditor } from './ToolDetailsEditor';
import { createWorkspaceModule, type WorkspaceModule } from '../workspaces/module';

interface Options {
    ocr?: import('../configuration/ocr-controls').OcrConfigurationControls;
    runtime: Pick<ApplicationRuntime, 'vfs' | 'agentService' | 'commandBus' | 'kernel' | 'flowEngine' | 'configuration' | 'projects'>;
    ui: Pick<AppUI, 'llmUiEditors' | 'createFlowContextMenu'>;
    sidebar: HTMLElement; editor: HTMLElement; skills: IFileSystem;
    factories: Record<'agents' | 'skills' | 'flows', EditorFactory>;
    navigate(request: NavigationRequest): Promise<void>; selected(path: string | null): void;
    uiPersistence?: UIPersistencePort;
    uiPreferences?: ToolboxPreferencesPort;
}
/** The toolbox owns its projection lifetime and editor wiring as one module. */
export async function createToolboxModule(options: Options): Promise<WorkspaceModule> {
    const { agentService, commandBus, kernel, vfs, flowEngine } = options.runtime;
    const inventory = new ToolboxInventory(() => agentService.getMCPServers(), kernel.toolCatalog, agentService, () => agentService.listSystemPrompts(), () => listRemoteHarnessAgents(options.runtime.projects?.remoteMounts));
    let agents: import('@itookit/vfs-core').FileSystemView | undefined;
    try {
        await inventory.init();
        agents = createFileSystemView({viewId: 'toolbox:agents', mounts: [
            {mountId: 'local', at: '/', fs: await vfs.openFileSystem(workspaceRoot('agents')), access: 'rw'},
            {mountId: 'remote', at: '/@remote', fs: inventory.remoteAgentSource, access: 'ro'}]});
        const resources = new ToolboxResources({ agents,
            skills: options.skills, flows: flowEngine.engine, ...inventory.sources }, agentService, commandBus, await vfs.openFileSystem('/etc'));
        const factories = configurationFactories(options, inventory, resources);
        const workbench = new ToolboxWorkbench({ ...options, inventory, resources, factories, configuration: options.runtime.configuration, projects: options.runtime.projects,
            flowMenu: options.ui.createFlowContextMenu<VFSNodeUI>({ commands: commandBus,
                navigate: id => options.navigate({ target: 'chat', resourceId: id }) }) });
        return createWorkspaceModule(workbench, async () => { try { await workbench.destroy(); } finally { try { await agents!.dispose(); } finally { await inventory.dispose(); } } });
    } catch (error) { try { await agents?.dispose(); } finally { await inventory.dispose(); } throw error; }
}
function configurationFactories(options: Options, inventory: ToolboxInventory, resources: ToolboxResources) {
    const { agentService } = options.runtime, editors = options.ui.llmUiEditors;
    const create = (Editor: new (element: HTMLElement, service: typeof agentService, options: import('@itookit/ui-common').EditorOptions) => import('@itookit/ui-common').IEditor): EditorFactory => async (element, config) => {
        const editor = new Editor(element, agentService, config); await editor.init(element); return editor;
    };
    return { ...options.factories, agents: async (element: HTMLElement, config: import('@itookit/ui-common').EditorOptions) => {
        if (config.target?.kind === 'file' && config.target.path.startsWith('/@remote/')) {
            const editor = new RemoteAgentDetailsEditor(element, inventory, config, options.runtime.projects); await editor.init(element); return editor;
        }
        return options.factories.agents(element, config);
    }, prompts: create(editors.SystemPromptSettingsEditor), providers: create(editors.ProviderSettingsEditor), connections: create(editors.ConnectionSettingsEditor),
        mcp: async (element: HTMLElement, config: import('@itookit/ui-common').EditorOptions) => {
            const editor = new editors.MCPSettingsEditor(element, agentService, config, options.runtime.projects?.remoteMounts
                ? new MCPConfigurationControlsRegistry().register(PI_AGENT_EXTENSION,new PiAgentMCPControls(options.runtime.projects.remoteMounts),
                    server => !!piAgentConfiguration(server)) : undefined); await editor.init(element); return editor;
        }, tools: async (element: HTMLElement, config: import('@itookit/ui-common').EditorOptions) => {
            const editor = new ToolDetailsEditor(element, inventory, config, resources); await editor.init(element); return editor;
        } };
}
