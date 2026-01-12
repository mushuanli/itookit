/**
 * @file apps/web-app/src/services/vfs.ts
 */
import { 
  VFS, 
  createBrowserVFSWithAPI,
  StorageManager,
  IndexedDBAdapter 
} from '@itookit/vfs';
import { WORKSPACES } from '../config/modules';

let vfsInstance: VFS | null = null;

/**
 * 从 WORKSPACES 配置中提取启用同步的模块名列表
 */
function getSyncableModules(): string[] {
    return WORKSPACES
        .filter(ws => ws.syncEnabled)
        .map(ws => ws.moduleName);
}

/**
 * 初始化 VFS
 * 使用浏览器预设，自动配置 IndexedDB 存储和标准插件
 */
export async function initVFS(): Promise<VFS> {
    if (vfsInstance) return vfsInstance;

    // 1. 创建或打开数据库
    console.log('Initializing VFS...');

    // ✅ 手动注册 IndexedDB 适配器（在创建 VFS 之前）
    StorageManager.registerAdapter('indexeddb', (config, schemas) => {
      return new IndexedDBAdapter(
        (config.dbName as string) ?? 'vfs_database',
        (config.version as number) ?? 1,
        schemas
      );
    });

    // ✅ 提取可同步的模块名列表
    const syncableModules = getSyncableModules();
    console.log('Syncable modules:', syncableModules);

    const vfs = await createBrowserVFSWithAPI({
        dbName: 'MindOS',
        dbVersion:7,
        defaultModule: WORKSPACES[0]?.moduleName || 'default',
        enableTags: true,
        enableAssets: true,
        syncableModules  // ✅ 传入可同步模块列表
    });

    // 2. 确保所有工作区对应的模块都已挂载
    for (const ws of WORKSPACES) {
        const exists = vfs.getModule(ws.moduleName);
        if (!exists) {
            try {
                await vfs.mount(ws.moduleName, {
                    description: ws.title,
                    isProtected: ws.isProtected,
                    syncEnabled: ws.syncEnabled  // ✅ 传入同步状态
                });
                console.log(`Mounted module: ${ws.moduleName} (Protected: ${!!ws.isProtected})`);
            } catch (e) {
                console.error(`Failed to mount ${ws.moduleName}`, e);
            }
        }
    }

    // ✅ 最后赋值给模块变量
    vfsInstance = vfs;
    return vfsInstance;
}

/**
 * 获取 VFS 实例
 * 如果未初始化则抛出错误
 */
export function getVFS(): VFS {
    if (!vfsInstance) {
        throw new Error('VFS not initialized. Call initVFS() first.');
    }
    return vfsInstance;
}

/**
 * 关闭 VFS
 */
export async function shutdownVFS(): Promise<void> {
    if (vfsInstance) {
        await vfsInstance.shutdown();
        vfsInstance = null;
        console.log('VFS shutdown complete.');
    }
}
