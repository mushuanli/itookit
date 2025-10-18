// #config/demo.js

/**
 * @file demo.js
 * @description 演示如何使用重构后的 ConfigManager 和服务容器架构。
 */

import { ConfigManager } from './ConfigManager.js';

async function runDemo() {
    console.log("========== 运行新架构演示 ==========");

    // 1. 初始化 (在应用入口处执行一次)
    console.log("\n[步骤 1] 初始化 ConfigManager...");
    const manager = ConfigManager.getInstance({
        adapterOptions: { prefix: 'refactored_app_demo_' }
    });
    // 显式启动应用，这将预加载 eager 服务并发布 app:ready 事件
    await manager.bootstrap();
    console.log("ConfigManager 初始化并启动完成。");

    // 2. 使用全局服务 (新旧 API 对比)
    console.log("\n[步骤 2] 测试全局服务...");
    // 旧 API (仍然可用)
    const tags_old = manager.tags;
    // 新 API (推荐)
    const tags_new = manager.getService('tagRepository');
    console.log("  - 通过旧 API 获取的 tags 与新 API 是否相同?", tags_old === tags_new); // 应为 true

    // 使用服务
    await tags_new.addTag("架构评审");
    await tags_new.addTag("依赖注入");
    console.log("  - 当前所有标签:", tags_new.getAll());

    // 3. 使用模块化服务，并验证隔离性
    console.log("\n[步骤 3] 测试模块化服务和工作区隔离...");

    // 获取项目 A 的工作区上下文
    console.log("  - 获取 'project-alpha' 工作区...");
    const projectA = manager.getWorkspace('project-alpha');
    const moduleRepoA = projectA.module; // 使用便捷访问器
    const srsServiceA = projectA.srs;

    // 获取项目 B 的工作区上下文
    console.log("  - 获取 'project-beta' 工作区...");
    const projectB = manager.getWorkspace('project-beta');
    const moduleRepoB = projectB.module;

    // 验证不同工作区的服务实例是不同的
    console.log("  - 项目A和项目B的 ModuleRepository 是否为同一实例?", moduleRepoA === moduleRepoB); // 应为 false

    // 在各自的工作区内操作数据
    await moduleRepoA.addModule(null, { path: 'README.md', type: 'file', content: '这是项目A' });
    await moduleRepoB.addModule(null, { path: 'main.js', type: 'file', content: 'console.log("项目B")' });

    const modulesA = await moduleRepoA.getModules();
    const modulesB = await moduleRepoB.getModules();
    console.log("  - 项目A的模块:", modulesA.children.map(c => c.path));
    console.log("  - 项目B的模块:", modulesB.children.map(c => c.path));
    
    // 使用项目 A 的 SRS 服务，它将操作项目 A 的 SRS 数据
    await srsServiceA.gradeCard('card-A1', 'good', 'doc-A1');
    console.log("  - 已调用项目 A 的 SRS 服务。");

    // 4. 动态添加插件
    console.log("\n[步骤 4] 测试动态插件...");
    
    // 定义一个简单的日志插件
    class LoggerPlugin {
        install(container) {
            console.log("  - 'LoggerPlugin' 正在安装...");
            container.register('logger', () => ({
                log: (msg) => console.log(`[自定义日志] ${msg}`)
            }));
        }
    }
    // 在运行时使用插件
    manager.use(new LoggerPlugin());
    
    // 立刻获取并使用新注册的服务
    const logger = manager.getService('logger');
    logger.log("动态插件工作正常！");
    
    console.log("\n========== 演示结束 ==========");
}

// 运行演示
runDemo().catch(console.error);