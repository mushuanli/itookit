/**
 * @file apps/web-app/src/main.ts
 * @description Main entry point for the web application.
 */
import { MemoryManager } from '@itookit/memory-manager';
import { initVFS } from './services/vfs';
import { defaultEditorFactory, createAgentEditorFactory } from './factories/editorFactory';
import { initSidebarNavigation } from './utils/layout';
import { WORKSPACES } from './config/modules';
import { SettingsEngine } from './workspace/settings/engines/SettingsEngine';
import { SettingsService } from './workspace/settings/services/SettingsService';
import { createSettingsFactory } from './factories/settingsFactory';
import { FileTypeDefinition } from '@itookit/vfs-ui';
import { createLLMFactory } from './factories/llmFactory';

import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import '@itookit/memory-manager/style.css'; 
// 如果有 llm-ui 的样式，也请引入
import '@itookit/llm-ui/style.css'; 
import './styles/index.css'; 

const managerCache = new Map<string, MemoryManager>();

// 全局单例 SettingsService
let sharedSettingsService: SettingsService | null = null;

async function bootstrap() {
    try {
        // 1. 初始化核心层 VFS
        const vfsCore = await initVFS();
        
        // 2. 优先初始化全局设置服务 (Connection, Tags 数据源)
        sharedSettingsService = new SettingsService(vfsCore);
        await sharedSettingsService.init();

        // 3. 准备 Agent 编辑器工厂 (依赖 SettingsService)
        const agentEditorFactory = createAgentEditorFactory(sharedSettingsService);
	const llmEditorFactory = createLLMFactory(sharedSettingsService); // 新增

        // 4. 定义全局通用的文件类型注册表
        // 这将告诉 vfs-ui：遇到 .agent 文件时，使用 agentEditorFactory 创建编辑器，图标显示为 🤖
        const globalFileTypes: FileTypeDefinition[] = [
            {
                extensions: ['.agent'],
                icon: '🤖',
                editorFactory: agentEditorFactory
            },
	    {
	        // 新增 .chat 文件的支持
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
                const settingsFactory = createSettingsFactory(sharedSettingsService!);
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
                    vfsCore: vfsCore,
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
                    vfsCore: vfsCore,
                    moduleName: llmConfig.moduleName, // 'chats'
                    
                    // [关键] 使用 LLM 专用工厂作为默认编辑器
                    editorFactory: llmEditorFactory,
                    fileTypes: globalFileTypes, // 允许打开其他类型

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
                    vfsCore: vfsCore,
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