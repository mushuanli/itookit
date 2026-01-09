// @file packages/vfs/src/presets/minimal.ts

import { VFSInstance, createVFS } from '../VFSFactory';
import { 
  IPlugin,
  MemoryAdapter, 
  StorageManager,
  CollectionSchema 
} from '../../core';
import { VFS } from '../VFS';

/**
 * 最小预设配置
 */
export interface MinimalPresetOptions {
  /** 初始数据 */
  initialData?: Record<string, unknown[]>;
  /** 额外的 Schema */
  extraSchemas?: CollectionSchema[];
  /** 额外插件 */
  extraPlugins?: IPlugin[];
}

/**
 * 创建最小化 VFS（用于测试）
 */
export async function createMinimalVFS(
  options: MinimalPresetOptions = {}
): Promise<VFSInstance> {
  const { 
    initialData, 
    extraSchemas = [],
    extraPlugins = [] 
  } = options;

  // 注册内存适配器
  StorageManager.registerAdapter('memory', (_, schemas) => {
    const adapter = new MemoryAdapter(schemas);
    return adapter;
  });

  // 注册额外的 Schema
  for (const schema of extraSchemas) {
    StorageManager.registerDefaultSchema(schema);
  }

  // 明确声明插件类型
  const plugins: IPlugin[] = [...extraPlugins];

  const instance = await createVFS({
    storage: {
      type: 'memory',
      config: {}
    },
    plugins
  });

  // 如果有初始数据，加载到内存适配器
  if (initialData) {
    const storage = (instance.kernel as any).storage as MemoryAdapter;
    if (storage && typeof storage.load === 'function') {
      storage.load(initialData);
    }
  }

  return instance;
}

/**
 * 创建最小化 VFS 并包装为高层 API
 */
export async function createMinimalVFSWithAPI(
  options: MinimalPresetOptions = {}
): Promise<VFS> {
  const instance = await createMinimalVFS(options);
  return new VFS(instance);
}

export default createMinimalVFS;
