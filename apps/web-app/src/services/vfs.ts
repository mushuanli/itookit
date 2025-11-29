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
    vfsInstance = await createVFSCore('MindOS');

    // 2. 确保所有工作区对应的模块都已挂载
    for (const ws of WORKSPACES) {
        const exists = vfsInstance.getModule(ws.moduleName);
        if (!exists) {
            try {
                // [修改] 传递对象参数
                await vfsInstance.mount(ws.moduleName, {
                    description: ws.title,
                    isProtected: ws.isProtected
                });
                console.log(`Mounted module: ${ws.moduleName} (Protected: ${!!ws.isProtected})`);
            } catch (e) {
                console.error(`Failed to mount ${ws.moduleName}`, e);
            }
        } else {
            // [可选] 如果模块已存在，检查是否需要更新属性
            // vfsInstance.updateModule(ws.moduleName, { isProtected: ws.isProtected });
        }
    }

    return vfsInstance;
}
