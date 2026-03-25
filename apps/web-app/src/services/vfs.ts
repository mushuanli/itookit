/**
 * @file apps/web-app/src/services/vfs.ts
 */
import { createVFS } from '@itookit/vfslib';
import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import type { IVFSManager } from '@itookit/common';
import { WORKSPACES } from '../config/modules';

let vfsInstance: IVFSManager | null = null;

/**
 * 初始化 VFS
 */
export async function initVFS(): Promise<IVFSManager> {
    if (vfsInstance) return vfsInstance;

    console.log('Initializing VFS...');

    const { manager } = await createVFS({
        rootBackend: new IndexedDBBackend({ dbName: 'MindOS-v3' }),
        modules: WORKSPACES
            // 'settings' type uses a virtual engine with no VFS storage
            .filter(ws => ws.type !== 'settings')
            .map(ws => ({
                name: ws.moduleName,
                options: {
                    description: ws.title,
                    isProtected: ws.isProtected,
                    syncEnabled: ws.syncEnabled,
                    isSystem: ws.isSystem,
                },
            })),
    });

    vfsInstance = manager;
    console.log('VFS initialized.');
    return vfsInstance;
}

/**
 * 获取 VFS 実例（未初始化时抛出错误）
 */
export function getVFS(): IVFSManager {
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
        await vfsInstance.dispose();
        vfsInstance = null;
        console.log('VFS shutdown complete.');
    }
}
