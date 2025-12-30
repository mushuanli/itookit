// file: vfs-core/middleware/SidecarMiddleware.ts
import { IVFSMiddleware } from '../core/types';
import { VNode, VNodeType, Transaction } from '../store/types';
import { VFSStorage } from '../store/VFSStorage';

/**
 * 伴生目录同步中间件
 * 负责在文件移动/重命名时，自动搬运其关联的隐藏资源目录 (.filename)
 */
export class SidecarMiddleware implements IVFSMiddleware {
  name = 'SidecarMiddleware';
  // 优先级设为较高，确保在核心移动逻辑之后尽快执行
  priority = 100; 

  private storage: VFSStorage | null = null;

  initialize(storage: VFSStorage) {
    this.storage = storage;
  }

  // 仅关注文件类型的移动
  canHandle(vnode: VNode): boolean {
    return vnode.type === VNodeType.FILE;
  }

  /**
   * 移动后钩子
   * @param vnode 主节点 (已更新路径)
   * @param oldPath 主节点旧路径 (System Path)
   * @param newPath 主节点新路径 (System Path)
   * @param transaction 当前事务
   */
  async onAfterMove(
    vnode: VNode, 
    oldPath: string, 
    newPath: string, 
    transaction: Transaction
  ): Promise<void> {
    if (!this.storage) return;

    // 1. 计算旧的伴生目录路径
    // 规则: /module/A/B.md -> /module/A/.B.md
    const oldParentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const oldFilename = oldPath.substring(oldPath.lastIndexOf('/') + 1);
    const oldSidecarPath = `${oldParentPath}/.${oldFilename}`;

    // 2. 检查旧伴生目录是否存在
    const sidecarNodeId = await this.storage.getNodeIdByPath(oldSidecarPath, transaction);
    
    if (sidecarNodeId) {
      const sidecarNode = await this.storage.loadVNode(sidecarNodeId, transaction);
      if (!sidecarNode) return;

      // 3. 计算新的伴生目录路径
      // 规则: /module/X/Y.md -> /module/X/.Y.md
      const newParentPath = newPath.substring(0, newPath.lastIndexOf('/'));
      const newFilename = newPath.substring(newPath.lastIndexOf('/') + 1);
      const newSidecarPath = `${newParentPath}/.${newFilename}`;

      // 防御性检查：目标路径是否已有目录？
      const collisionId = await this.storage.getNodeIdByPath(newSidecarPath, transaction);
      if (collisionId) {
        console.warn(`[SidecarMiddleware] Target sidecar path exists: ${newSidecarPath}. Skipping sync.`);
        return; 
      }

      // 保存旧路径用于递归更新子节点
      const sidecarOldPath = sidecarNode.path;

      // 4. 更新伴生目录节点
      sidecarNode.name = `.${newFilename}`;
      sidecarNode.parentId = vnode.parentId; // 跟随主文件的新父级
      sidecarNode.path = newSidecarPath;
      sidecarNode.modifiedAt = Date.now();
      
      // 处理跨模块移动
      const newModuleId = vnode.moduleId!;
      if (sidecarNode.moduleId !== newModuleId) {
          sidecarNode.moduleId = newModuleId;
          // SRS 等关联数据更新通常由底层 batchMove 处理，但这里是隐式联动，需确保存储层处理
          // 或者手动调用 storage.srsStore.updateModuleIdForNode
      }

      await this.storage.saveVNode(sidecarNode, transaction);

      // 5. 递归更新伴生目录下的所有子资源路径
      // 这一步至关重要，否则目录里的图片路径会断裂
      await this._updateDescendants(
          sidecarNode, 
          sidecarOldPath, 
          newSidecarPath, 
          newModuleId, 
          transaction
      );
    }
  }

  /**
   * 递归更新子节点路径
   */
  private async _updateDescendants(
    parent: VNode, 
    oldBasePath: string, 
    newBasePath: string, 
    moduleId: string, 
    tx: Transaction
  ) {
    const children = await this.storage!.getChildren(parent.nodeId, tx);
    
    for (const child of children) {
       // 路径替换前缀
       if (child.path.startsWith(oldBasePath)) {
           child.path = newBasePath + child.path.substring(oldBasePath.length);
       }
       
       child.moduleId = moduleId;
       await this.storage!.saveVNode(child, tx);
       
       if (child.type === VNodeType.DIRECTORY) {
           await this._updateDescendants(child, oldBasePath, newBasePath, moduleId, tx);
       }
    }
  }
}
