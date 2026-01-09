// @file packages/vfs/src/VFSFactory.ts

import {
  VFSKernel,
  StorageManager,
  PluginManager,
  IPlugin,
  EventBus,
  CollectionSchema
} from '../core';

/**
 * VFS 配置选项
 */
export interface VFSOptions {
  /** 存储类型及配置 */
  storage: {
    type: string;
    config: Record<string, unknown>;
  };
  /** 要加载的插件列表 */
  plugins?: IPlugin[];
  /** 额外的 Schema 定义 */
  extraSchemas?: CollectionSchema[];
  /** 默认模块名称 */
  defaultModule?: string;
}

/**
 * VFS 实例
 */
export interface VFSInstance {
  /** VFS 内核 */
  kernel: VFSKernel;
  /** 插件管理器 */
  plugins: PluginManager;
  /** 事件总线 */
  events: EventBus;

  /**
   * 获取插件
   * @param id 插件 ID
   */
  getPlugin<T extends IPlugin>(id: string): T | undefined;

  /**
   * 关闭实例
   */
  shutdown(): Promise<void>;
}

/**
 * 创建 VFS 实例
 */
export async function createVFS(options: VFSOptions): Promise<VFSInstance> {
  // 1. 注册核心 Schema（已在 StorageManager 静态代码中完成）
  
  // 2. 注册额外的 Schema
  if (options.extraSchemas) {
    for (const schema of options.extraSchemas) {
      StorageManager.registerDefaultSchema(schema);
    }
  }

  // 2. ✅ 收集所有插件的 Schema（关键修复！）
  const plugins: IPlugin[] = options.plugins ?? [];
  for (const plugin of plugins) {
    if (typeof (plugin as any).getSchemas === 'function') {
      const pluginSchemas = (plugin as any).getSchemas() as CollectionSchema[];
      for (const schema of pluginSchemas) {
        StorageManager.registerDefaultSchema(schema);
      }
    }
  }

  // 3. 获取所有 Schema 并计算版本
  const allSchemas = StorageManager.getDefaultSchemas();
  
  // ✅ 版本号 = Schema 数量（每新增一个 Schema，版本号自动 +1）
  // 这确保新增插件时会触发 onupgradeneeded
  const autoVersion = allSchemas.length;
  
  // 合并用户指定的版本（取较大值）
  const userVersion = (options.storage.config.version as number) || 1;
  const finalVersion = Math.max(autoVersion, userVersion);

  console.log(`[VFS] Schema count: ${allSchemas.length}, DB version: ${finalVersion}`);

  // 4. 创建存储适配器（传入所有 Schema）
  const storage = StorageManager.createAdapter(
    options.storage.type,
    { ...options.storage.config, version: finalVersion }
  );

  // 5. 创建事件总线
  const events = new EventBus();

  // 6. 创建内核
  const kernel = new VFSKernel({ storage, eventBus: events });
  await kernel.initialize();

  // 7. 创建插件管理器并注册插件
  const pluginManager = new PluginManager(kernel);
  for (const plugin of plugins) {
    pluginManager.register(plugin);
  }

  // 8. 激活所有插件
  await pluginManager.activateAll();

  return {
    kernel,
    plugins: pluginManager,
    events,

    getPlugin<T extends IPlugin>(id: string): T | undefined {
      return pluginManager.getPlugin<T>(id);
    },

    async shutdown(): Promise<void> {
      await pluginManager.uninstallAll();
      await kernel.shutdown();
    }
  };
}

/**
 * 创建 VFS 实例的简化版本
 */
export async function createSimpleVFS(
  storageType: string,
  storageConfig: Record<string, unknown> = {}
): Promise<VFSInstance> {
  return createVFS({
    storage: {
      type: storageType,
      config: storageConfig
    },
    plugins: []
  });
}
