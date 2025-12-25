/**
 * @file vfs/middleware/ResourceBundleMiddleware.ts
 * @description 资源包管理中间件
 * 负责维护 filename.ext <-> .filename.ext/ 的强绑定关系。
 * 当主文件被移动、复制或删除时，自动对伴生资源目录执行相同的操作。
 */

import { VNode, VNodeType, Transaction } from '../store/types';
import { IVFSMiddleware } from '../core/types';
import { VFSStorage } from '../store/VFSStorage';
import { ContentStore } from '../store/ContentStore';

export class ResourceBundleMiddleware implements IVFSMiddleware {
  name = 'resource-bundle';
  priority = 100; // 高优先级
  private storage!: VFSStorage;

  initialize(storage: VFSStorage) {
    this.storage = storage;
  }

  /**
   * 1. 删除拦截：级联删除伴生目录
   */
  async onAfterDelete(vnode: VNode, transaction: Transaction): Promise<void> {
    // 只处理文件，不处理目录
    if (vnode.type !== VNodeType.FILE) return;

    const sidecarPath = this.getSidecarSystemPath(vnode);
    const sidecarId = await this.storage.inodeStore.getIdByPath(sidecarPath, transaction);

    if (sidecarId) {
      console.log(`[Bundle] Cascade deleting sidecar: ${sidecarPath}`);
      await this.recursiveDeleteStoreLevel(sidecarId, transaction);
    }
  }

  /**
   * 2. 移动拦截：同步移动伴生目录
   * 注意：不再需要重写 Markdown 内容，因为系统现在使用 @asset/ 抽象路径。
   */
  async onAfterMove(vnode: VNode, oldPath: string, newPath: string, transaction: Transaction): Promise<void> {
    if (vnode.type !== VNodeType.FILE) return;

    const oldName = this.getBasename(oldPath);
    const newName = vnode.name;
    
    // 构造旧的和新的伴生目录名
    const oldSidecarName = `.${oldName}`;
    const newSidecarName = `.${newName}`;

    const oldParentPath = this.getParentPath(oldPath);
    const newParentPath = this.getParentPath(newPath);

    const oldSidecarPath = this.joinPath(oldParentPath, oldSidecarName);
    const newSidecarPath = this.joinPath(newParentPath, newSidecarName);

    // 检查旧伴生目录是否存在
    const sidecarId = await this.storage.inodeStore.getIdByPath(oldSidecarPath, transaction);
    
    if (sidecarId) {
      const sidecarNode = await this.storage.inodeStore.loadVNode(sidecarId, transaction);
      if (sidecarNode) {
        // 更新伴生目录自身的元数据
        sidecarNode.parentId = vnode.parentId;
        sidecarNode.name = newSidecarName;
        sidecarNode.path = newSidecarPath;
        sidecarNode.moduleId = vnode.moduleId; // 确保跨模块移动时 ModuleID 同步更新
        sidecarNode.modifiedAt = Date.now();
        
        await this.storage.inodeStore.save(sidecarNode, transaction);

        // 递归更新所有子节点的路径和 ModuleID
        await this.updateDescendantsPath(sidecarNode, oldSidecarPath, newSidecarPath, vnode.moduleId!, transaction);
        
        console.log(`[Bundle] Moved sidecar: ${oldSidecarPath} -> ${newSidecarPath}`);
      }
    }
  }

  /**
   * 3. 复制拦截：递归复制伴生目录
   */
  async onAfterCopy(sourceNode: VNode, targetNode: VNode, transaction: Transaction): Promise<void> {
    if (sourceNode.type !== VNodeType.FILE) return;

    const sourceSidecarPath = this.getSidecarSystemPath(sourceNode, this.getParentPath(sourceNode.path));
    // 目标伴生目录路径
    const targetSidecarName = `.${targetNode.name}`;
    const targetParentPath = this.getParentPath(targetNode.path);
    const targetSidecarPath = this.joinPath(targetParentPath, targetSidecarName);

    // 检查源是否存在
    const sidecarId = await this.storage.inodeStore.getIdByPath(sourceSidecarPath, transaction);
    if (!sidecarId) return;

    // 检查目标是否已存在（防止覆盖，虽然 copy 操作本身应该保证 target 是新的）
    const targetExist = await this.storage.inodeStore.getIdByPath(targetSidecarPath, transaction);
    if (targetExist) return;

    try {
        const sourceSidecarNode = await this.storage.inodeStore.loadVNode(sidecarId, transaction);
        if (sourceSidecarNode) {
            await this.recursiveCopyStoreLevel(
                sourceSidecarNode,
                (newNode) => {
                    newNode.name = targetSidecarName;
                    newNode.parentId = targetNode.parentId;
                    newNode.path = targetSidecarPath;
                    newNode.moduleId = targetNode.moduleId;
                },
                transaction
            );
            console.log(`[Bundle] Copied sidecar: ${targetSidecarPath}`);
        }
    } catch (e) {
        console.error(`[Bundle] Failed to copy sidecar resources`, e);
        // 抛出异常以回滚整个 Copy 事务，保证操作原子性
        throw e; 
    }
  }

  // --- Helper Methods ---

  private getSidecarSystemPath(vnode: VNode, parentPathOverride?: string): string {
    const parent = parentPathOverride || this.getParentPath(vnode.path);
    return this.joinPath(parent, `.${vnode.name}`);
  }

  private joinPath(parent: string, child: string): string {
      return parent === '/' ? `/${child}` : `${parent}/${child}`;
  }

  private getParentPath(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash <= 0 ? '/' : path.substring(0, lastSlash);
  }

  private getBasename(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    return path.substring(lastSlash + 1);
  }

  private generateId(): string {
      return `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // 递归删除 (存储层操作)
  private async recursiveDeleteStoreLevel(nodeId: string, tx: Transaction) {
      // 1. 获取子节点
      const children = await this.storage.inodeStore.getChildren(nodeId, tx);
      for (const child of children) {
          await this.recursiveDeleteStoreLevel(child.nodeId, tx);
      }
      // 2. 删除内容和节点
      const node = await this.storage.inodeStore.loadVNode(nodeId, tx);
      if (node) {
          if (node.contentRef) {
              await this.storage.contentStore.deleteContent(node.contentRef, tx);
          }
          // 清理标签
          await this.storage.nodeTagStore.removeAllForNode(nodeId, tx); 
          // 清理 SRS
          await this.storage.srsStore.deleteForNode(nodeId, tx);
          
          await this.storage.inodeStore.deleteVNode(nodeId, tx);
      }
  }

  // 递归更新路径 (存储层操作)
  private async updateDescendantsPath(parent: VNode, oldPrefix: string, newPrefix: string, moduleId: string, tx: Transaction) {
      const children = await this.storage.inodeStore.getChildren(parent.nodeId, tx);
      for (const child of children) {
          let childNewPath = child.path;
          if (child.path.startsWith(oldPrefix)) {
             childNewPath = newPrefix + child.path.substring(oldPrefix.length);
          }
          child.path = childNewPath;
          child.moduleId = moduleId;
          
          await this.storage.inodeStore.save(child, tx);
          
          if (child.type === VNodeType.DIRECTORY) {
              await this.updateDescendantsPath(child, oldPrefix, newPrefix, moduleId, tx);
          }
      }
  }

  // 递归复制 (存储层操作)
  private async recursiveCopyStoreLevel(
      sourceNode: VNode, 
      modifier: (newNode: VNode) => void, 
      tx: Transaction
  ): Promise<void> {
      // Clone Data
      const newNodeData = sourceNode.toJSON();
      newNodeData.nodeId = this.generateId();
      newNodeData.createdAt = Date.now();
      newNodeData.modifiedAt = Date.now();
      
      // Copy Content
      if (sourceNode.type === VNodeType.FILE && sourceNode.contentRef) {
           const contentStore = tx.getStore(this.storage.contentStore.storeName);
           const req = contentStore.get(sourceNode.contentRef);
           
           // 等待内容读取 (Promise wrap)
           const contentData = await new Promise<any>((resolve, reject) => {
               req.onsuccess = () => resolve(req.result);
               req.onerror = () => reject(req.error);
           });

           if (contentData) {
               newNodeData.contentRef = ContentStore.createContentRef(newNodeData.nodeId);
               
               // 创建新内容记录
               const newContentData = {
                   ...contentData,
                   contentRef: newNodeData.contentRef,
                   nodeId: newNodeData.nodeId,
                   createdAt: Date.now()
               };
               
               // 写入新内容
               contentStore.put(newContentData);
           }
      }

      const newNode = VNode.fromJSON(newNodeData);
      modifier(newNode); // Apply path/parent changes
      
      await this.storage.inodeStore.save(newNode, tx);

      // Copy Children
      if (sourceNode.type === VNodeType.DIRECTORY) {
          const children = await this.storage.inodeStore.getChildren(sourceNode.nodeId, tx);
          for (const child of children) {
              await this.recursiveCopyStoreLevel(child, (newChild) => {
                  newChild.parentId = newNode.nodeId;
                  const parentPath = newNode.path;
                  newChild.path = parentPath === '/' ? `/${newChild.name}` : `${parentPath}/${newChild.name}`;
                  newChild.moduleId = newNode.moduleId;
              }, tx);
          }
      }
  }
}