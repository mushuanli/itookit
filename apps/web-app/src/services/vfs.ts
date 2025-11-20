/**
 * @file apps/web-app/src/services/vfs.ts
 */
import { createVFSCore, VFSCore } from '@itookit/vfs-core';
import { WORKSPACES } from '../config/modules';

let vfsInstance: VFSCore | null = null;

export async function initVFS(): Promise<VFSCore> {
    if (vfsInstance) return vfsInstance;

    // 1. 创建或打开数据库
    console.log('Initializing VFS...');
    vfsInstance = await createVFSCore('multi-workspace-app');

    // 2. 确保所有工作区对应的模块都已挂载
    for (const ws of WORKSPACES) {
        const exists = vfsInstance.getModule(ws.moduleName);
        if (!exists) {
            try {
                await vfsInstance.mount(ws.moduleName, ws.title);
                console.log(`Mounted module: ${ws.moduleName}`);
            } catch (e) {
                console.error(`Failed to mount ${ws.moduleName}`, e);
            }
        }
    }

    return vfsInstance;
}
