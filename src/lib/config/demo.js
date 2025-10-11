// #config/demo.js

import { ConfigManager } from './ConfigManager.js';
import { EVENTS, getModuleEventName } from './shared/constants.js';

// ---- 1. 应用初始化 ----
// 在应用的生命周期中，这应该只被调用一次。
const configManager = ConfigManager.getInstance({
    adapterOptions: { prefix: 'my_llm_app_final_' }
});
console.log("应用核心服务已初始化。等待引导程序完成...");

// ---- 2. 模拟 UI 组件定义 ----

/**
 * 模拟一个全局的标签管理UI组件。
 * 它不关心任何特定的项目，只负责显示和修改全局标签。
 */
class GlobalTagManagerComponent {
    constructor() {
        console.log('[TagManager] 组件已实例化。');
        this.configManager = ConfigManager.getInstance();
        this.tagRepo = this.configManager.tags;
        this.eventManager = this.configManager.eventManager;
        this.unsubscribe = null;
    }

    /**
     * 模拟组件被挂载到DOM上。
     */
    async mount() {
        console.log('[TagManager] 正在挂载组件，等待初始数据...');
        // 确保首次加载完成
        const initialTags = await this.tagRepo.load(); 
        this.render(initialTags);

        // 订阅后续的全局标签更新
        this.unsubscribe = this.eventManager.subscribe(EVENTS.TAGS_UPDATED, (updatedTags) => {
            console.log('[TagManager] 收到标签更新通知，正在重新渲染...');
            this.render(updatedTags);
        });
    }

    /**
     * 模拟组件从DOM中卸载。
     */
    unmount() {
        if (this.unsubscribe) {
            this.unsubscribe();
            console.log('[TagManager] 已取消订阅事件。');
        }
        console.log('[TagManager] 组件已卸载。');
    }

    /**
     * 模拟将数据渲染到UI。
     * @param {string[]} tags
     */
    render(tags) {
        console.log('--- [UI RENDER] 全局标签 ---', tags.length > 0 ? tags : '[无标签]');
        // 在真实应用中，这里会更新DOM。
    }
    
    /**
     * 模拟用户在UI上点击“添加标签”按钮。
     * @param {string} tag 
     */
    async addTag(tag) {
        console.log(`[TagManager] 用户操作: 添加标签 "${tag}"`);
        await this.tagRepo.addTag(tag);
    }
}


/**
 * 模拟一个特定项目的编辑器UI组件。
 * 每个实例都与一个唯一的项目ID绑定，只关心该项目的文件模块数据。
 */
class ProjectEditorComponent {
    constructor(projectId) {
        console.log(`[ProjectEditor:${projectId}] 组件已实例化。`);
        this.projectId = projectId;
        this.configManager = ConfigManager.getInstance();
        this.moduleRepo = this.configManager.modules.get(this.projectId);
        this.eventManager = this.configManager.eventManager;
        this.unsubscribe = null;
    }

    /**
     * 模拟组件被挂载到DOM上。
     */
    async mount() {
        console.log(`[ProjectEditor:${this.projectId}] 正在挂载组件，等待初始数据...`);
        
        // 订阅 *本项目* 的数据更新事件
        const updateEventName = getModuleEventName('updated', this.projectId);
        this.unsubscribe = this.eventManager.subscribe(updateEventName, (updatedModules) => {
            console.log(`[ProjectEditor:${this.projectId}] 收到模块更新通知，正在重新渲染...`);
            this.render(updatedModules);
        });
        
        // 等待本项目数据加载完成
        const initialModules = await this.moduleRepo.load(); 
        this.render(initialModules);
    }

    /**
     * 模拟组件从DOM中卸载。
     */
    unmount() {
        if (this.unsubscribe) {
            this.unsubscribe();
            console.log(`[ProjectEditor:${this.projectId}] 已取消订阅事件。`);
        }
        // 关键：通知管理器可以清理这个实例了，释放内存。
        this.configManager.modules.dispose(this.projectId);
        console.log(`[ProjectEditor:${this.projectId}] 组件已卸载。`);
    }

    /**
     * 模拟将文件树渲染到UI。
     * @param {import('./shared/types.js').ModuleFSTree} modules
     */
    render(modules) {
        console.log(`--- [UI RENDER] 项目 [${this.projectId}] 的文件模块 ---`);
        const printTree = (node, prefix = '') => {
            const name = node.path === '/' ? '/' : node.path.split('/').pop();
            const isLast = prefix.endsWith('└── ');
            const newPrefix = prefix.slice(0, -4) + (isLast ? '    ' : '│   ');
            console.log(`${prefix}${name}` + (node.type === 'file' ? ` (内容: '${node.content}')` : ''));
            if (node.children) {
                node.children.forEach((child, index) => {
                    printTree(child, newPrefix + (index === node.children.length - 1 ? '└── ' : '├── '));
                });
            }
        };
        printTree(modules, '');
        console.log(`--- [UI RENDER] 结束 ---`);
    }
    
    /**
     * 模拟用户在UI上创建一个新文件。
     * @param {string} fileName 
     * @param {string} content 
     */
    async addFile(fileName, content = '') {
        console.log(`[ProjectEditor:${this.projectId}] 用户操作: 在根目录添加文件 "${fileName}"`);
        const fileData = {
            path: fileName, // 仓库将根据父路径构建完整路径
            type: 'file',
            content: content,
            meta: {} // ctime 和 mtime 会被仓库自动添加
        };
        await this.moduleRepo.addModule('/', fileData);
    }
}

// ---- 3. 运行模拟场景 ----
async function runDemo() {
    console.log("应用引导完成，已准备就绪！开始运行演示场景...\n");
    // 实例化组件
    const tagComponent = new GlobalTagManagerComponent();
    const projectA = new ProjectEditorComponent('project-alpha');
    const projectB = new ProjectEditorComponent('project-beta');

    // 挂载组件（模拟组件被渲染到页面上）
    // 使用 Promise.all 并行挂载，模拟真实场景
    await Promise.all([
        tagComponent.mount(),
        projectA.mount(),
        projectB.mount()
    ]);

    console.log('\n==================================');
    console.log('====       执行用户操作         ====');
    console.log('==================================\n');

    // --- 场景1: 全局组件添加一个 tag ---
    // 预期行为: 只有 tagComponent 会收到通知并重新渲染。
    console.log('>>> 操作1: 添加一个全局标签 "review"');
    await tagComponent.addTag('review');
    console.log('--- 操作1 完成 ---\n');

    // --- 场景2: 项目 A 添加一个文件 ---
    // 预期行为: 只有 projectA 组件会收到通知并重新渲染。
    // projectB 和 tagComponent 不会受到任何影响。
    console.log(`>>> 操作2: 项目 [${projectA.projectId}] 添加文件 "index.js"...`);
    await projectA.addFile('index.js', 'console.log("Hello, Alpha!");');
    console.log('--- 操作2 完成 ---\n');

    // --- 场景3: 项目 B 添加一个文件 ---
    // 预期行为: 只有 projectB 组件会收到通知并重新渲染。
    console.log(`>>> 操作3: 项目 [${projectB.projectId}] 添加文件 "config.json"...`);
    await projectB.addFile('config.json', '{ "version": 1 }');
    console.log('--- 操作3 完成 ---\n');
    
    console.log('==================================');
    console.log('====        演示结束          ====');
    console.log('==================================\n');
    
    // 清理资源，模拟组件被销毁
    tagComponent.unmount();
    projectA.unmount();
    projectB.unmount();
}

// 关键: 监听 'app:ready' 事件，确保在所有全局配置加载完成后再执行应用逻辑。
configManager.eventManager.subscribe(EVENTS.APP_READY, runDemo);