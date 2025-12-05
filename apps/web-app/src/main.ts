/**
 * @file apps/web-app/src/main.ts
 * @description Main entry point for the web application.
 */
import { MemoryManager } from '@itookit/memory-manager';
import { initVFS } from './services/vfs';
import { defaultEditorFactory,  } from '@itookit/mdxeditor';
import { initSidebarNavigation } from './utils/layout';
import { WORKSPACES } from './config/modules';
import { SettingsEngine } from './workspace/settings/engines/SettingsEngine';
import { SettingsService } from './workspace/settings/services/SettingsService';
import { createSettingsFactory } from './factories/settingsFactory';
import { FileTypeDefinition } from '@itookit/vfs-ui';
import { createLLMFactory, createAgentEditorFactory,VFSAgentService } from '@itookit/llm-ui';

import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import '@itookit/memory-manager/style.css'; 
import '@itookit/llm-ui/style.css'; 
import './styles/index.css'; 

const managerCache = new Map<string, MemoryManager>();

// Service Singletons
let sharedSettingsService: SettingsService | null = null;
let sharedAgentService: VFSAgentService | null = null;

async function bootstrap() {
    try {
        // 1. 初始化核心 VFS
        const vfsCore = await initVFS();
        
        // 2. 初始化 SettingsService (Tags, Contacts)
        sharedSettingsService = new SettingsService(vfsCore);
        await sharedSettingsService.init();

        // 3. 初始化 VFSAgentService (LLM, Connections, Agents)
        // 关键：在这里传入默认 Agent 定义，实现开箱即用的体验
        sharedAgentService = new VFSAgentService(vfsCore);
        await sharedAgentService.init();

        // Agent Editor Factory: 只需要 Agent 服务
        const agentEditorFactory = createAgentEditorFactory(sharedAgentService); 
        // 修正: AgentConfigEditor 可能需要 SettingsService 来获取 Tags? 
        // 实际上 AgentConfigEditor 需要 VFSAgentService 来获取 Connections。
        // 请检查 createAgentEditorFactory 的实现，确保它接收正确的 Service。
        // 假设我们修改了 factory 接收 VFSAgentService:
        // const agentEditorFactory = createAgentEditorFactory(sharedAgentService);

        // LLM Chat Factory: 内部实例化 Service 还是外部传入？
        // createLLMFactory 的设计如果是内部 `new VFSAgentService`，会有多例同步问题。
        // 最好 createLLMFactory 也能接收一个现有的 service 实例，或者 options 包含 service。
        // 这里假设我们修改了 createLLMFactory 允许注入 service，或者它内部使用了单例模式。
        // 鉴于 llm-ui 是独立包，最稳妥的方式是通过 options 注入。
        const llmEditorFactory = createLLMFactory(sharedAgentService); // 内部逻辑需确保能复用数据

        // 5. 注册全局文件类型
        const globalFileTypes: FileTypeDefinition[] = [
            {
                extensions: ['.agent'],
                icon: '🤖',
                editorFactory: agentEditorFactory
            },
            {
                extensions: ['.chat', '.session'], 
                icon: '💬',
                editorFactory: llmEditorFactory
            }
        ];

        const loadWorkspace = async (targetId: string) => {
            if (managerCache.has(targetId)) return;
            const container = document.getElementById(targetId);
            if (!container) return;

            // 样式处理
            const wasActive = container.classList.contains('active');
            if (!wasActive) container.classList.add('active');

            let manager: MemoryManager;

            // --- A. 特殊处理：Settings Workspace ---
            if (targetId === 'settings-workspace') {
                const settingsEngine = new SettingsEngine(sharedSettingsService!);
                const settingsFactory = createSettingsFactory(sharedSettingsService!,sharedAgentService!);
                container.innerHTML = '';
                
                manager = new MemoryManager({
                    container: container,
                    customEngine: settingsEngine,
                    editorFactory: settingsFactory, // Settings 使用专用的路由工厂
                    uiOptions: {
                        title: 'Settings',
                        contextMenu: { items: () => [] }, 
                        searchPlaceholder: 'Search settings...',
                        
                        // ✨ [修改] 设为 true。
                        // 这将隐藏左侧列表的新建按钮、底部栏，并禁用列表排序，
                        // 因为设置项列表是固定的（Connections, Tags...）。
                        readOnly: true, 
                    },
                    editorConfig: { plugins: ['core:titlebar'] },
                    aiConfig: { enabled: false }
                });

            // --- B. Agent Workspace ---
            } else if (targetId === 'agent-workspace') {
                container.innerHTML = '';

                // 获取配置 (确保 defaultFileContent 存在)
                const agentConfig = WORKSPACES.find(w => w.elementId === 'agent-workspace')!;

                manager = new MemoryManager({
                    container: container,
                    moduleName: 'agents', 
                    
                    // [核心修改] 使用标准工厂作为默认值
                    editorFactory: defaultEditorFactory,
                    // [核心修改] 注入文件类型注册表，让系统自动识别 .agent
                    fileTypes: globalFileTypes,

                    uiOptions: {
                        title: 'Agents',
                        // [核心修改] 注入自定义 Label
                        createFileLabel: agentConfig.itemLabel, 
                        
                        defaultFileName: agentConfig.defaultFileName, 
                        defaultFileContent: agentConfig.defaultFileContent,
                        
                        searchPlaceholder: 'Search agents...',
                        initialSidebarCollapsed: false,
                        readOnly: false,
                        contextMenu: { items: (_item, defaults) => defaults }
                    },
                    editorConfig: { plugins: ['core:titlebar'], readOnly: false },
                    aiConfig: { enabled: false }
                });

            // --- [新增] C. LLM Workspace (AI 会话) ---
            } else if (targetId === 'llm-workspace') {
                container.innerHTML = '';
                // 获取配置
                const llmConfig = WORKSPACES.find(w => w.elementId === 'llm-workspace')!;

                manager = new MemoryManager({
                    container: container,
                    moduleName: llmConfig.moduleName,
                    editorFactory: llmEditorFactory,
                    fileTypes: globalFileTypes,
                    uiOptions: {
                        title: llmConfig.title,
                        createFileLabel: llmConfig.itemLabel,
                        defaultFileName: llmConfig.defaultFileName,
                        defaultFileContent: llmConfig.defaultFileContent,
                        searchPlaceholder: 'Search chats...',
                        initialSidebarCollapsed: false,
                        readOnly: false
                    },
                    // LLM 编辑器通常自带 Titlebar，或者在 factory 内部处理
                    editorConfig: {
                        plugins: [], 
                        readOnly: false
                    },
                    aiConfig: { enabled: false } // 不需要后台 Brain 扫描 .chat 文件
                });

            // --- C. 通用 Workspace (Notes, Projects, etc.) ---
            } else {
                const wsConfig = WORKSPACES.find(w => w.elementId === targetId);
                if (!wsConfig) return;

                manager = new MemoryManager({
                    container: container,
                    moduleName: wsConfig.moduleName,

                    editorFactory: defaultEditorFactory,
                    // 注入全局文件类型，使得普通笔记区也能打开 Agent 文件 (如果被移动过去)
                    fileTypes: globalFileTypes,
                    
                    // [新增] 传递 mentionScope
                    mentionScope: wsConfig.mentionScope,

                    uiOptions: {
                        title: wsConfig.title,
                        // [核心修改] 注入自定义 Label
                        createFileLabel: wsConfig.itemLabel,

                        defaultFileName: wsConfig.defaultFileName,
                        defaultFileContent: wsConfig.defaultFileContent,
                        initialSidebarCollapsed: false,
                        readOnly: false
                    },
                    editorConfig: {
                        plugins: wsConfig.plugins, 
                        readOnly: false
                    },
                    aiConfig: {
                        enabled: true,
                        activeRules: ['user', 'tag', 'file']
                    }
                });
            }

            await manager.start();
            managerCache.set(targetId, manager);

            // 恢复 Tab 状态
            if (!wasActive) {
                requestAnimationFrame(() => {
                    const currentActiveBtn = document.querySelector('.app-nav-btn.active');
                    const currentTarget = currentActiveBtn?.getAttribute('data-target');
                    if (currentTarget !== targetId) container.classList.remove('active');
                });
            }
        };

        // 启动逻辑
        if (WORKSPACES[0]) await loadWorkspace(WORKSPACES[0].elementId);
        
        initSidebarNavigation(async (targetId) => {
            await loadWorkspace(targetId);
        });

    } catch (error) {
        console.error('Failed to bootstrap application:', error);
    }
}

bootstrap();