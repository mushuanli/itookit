// @file: llm-engine/src/persistence/session-engine.ts

import YAML from 'yaml'; // 需要添加依赖: npm install yaml
import {
  VFS,
  BaseModuleService,
  VNodeType,
} from '@itookit/vfs';
import type {
  EngineNode,
  EngineSearchQuery,
  EngineEvent,
  EngineEventType
} from '@itookit/common';
import {
  FS_MODULE_CHAT,
  generateUUID,
  guessMimeType,
} from '@itookit/common';
import {
  ChatManifest,
  ChatNode,
  ChatContextItem,
  ILLMSessionEngine,
  BranchTreeNode,
  AppendMessageMeta,
  UpdateMessageMeta
} from './types';
import { LockManager } from '../utils/LockManager';
import { ChatSessionSettings, DEFAULT_SESSION_SETTINGS } from '../core/types';
import { log } from '../utils/logger';

// ============================================
// LLMSessionEngine
// ============================================

/**
 * LLM 会话引擎
 * 继承 BaseModuleService，通过 engine 访问文件系统
 * 实现 ILLMSessionEngine 接口
 */
export class LLMSessionEngine extends BaseModuleService implements ILLMSessionEngine {
  private lockManager = new LockManager();

  constructor(vfs: VFS) {
    super(FS_MODULE_CHAT, { description: 'Chat Sessions' }, vfs);
  }

  /**
   * 初始化钩子
   */
  protected async onLoad(): Promise<void> {
    //log.info('Initialized');
  }

  // ============================================================
  // 路径辅助
  // ============================================================

  private getHiddenDir(sessionId: string): string {
    return `/.${sessionId}`;
  }

  private getNodePath(sessionId: string, nodeId: string): string {
    return `${this.getHiddenDir(sessionId)}/.${nodeId}.json`;
  }

  // ============================================================
  // ILLMSessionEngine 核心实现
  // ============================================================

  /**
   * 创建新会话
   */
  async createSession(title: string, systemPrompt: string = "You are a helpful assistant."): Promise<string> {
    const sessionId = generateUUID();
    const now = new Date().toISOString();

    log.info('Creating new session', {
      sessionId,
      title,
      systemPromptLength: systemPrompt.length
    });

    // 1. 创建隐藏目录
    await this.engine.createDirectory(this.getHiddenDir(sessionId), null);

    // 2. 创建根节点 (System Prompt)
    const rootNodeId = `node-${Date.now()}-root`;
    const rootNode: ChatNode = {
      id: rootNodeId,
      type: 'message',
      role: 'system',
      content: systemPrompt,
      created_at: now,
      parent_id: null,
      children_ids: [],
      status: 'active'
    };

    await this.writeJson(this.getNodePath(sessionId, rootNodeId), rootNode);

    // 3. 创建 Manifest 文件
    const manifest: ChatManifest = {
      version: "1.0",
      id: sessionId,
      title: title,
      created_at: now,
      updated_at: now,
      settings: { model: "gpt-4", temperature: 0.7 },
      branches: { "main": rootNodeId },
      current_branch: "main",
      current_head: rootNodeId,
      root_id: rootNodeId
    };

    // 创建 .chat 文件
    await this.engine.createFile(
      `${title}.chat`,
      null,
      JSON.stringify(manifest, null, 2),
      { title: title, icon: '💬' }
    );

    this.notify();

    log.info('Session created successfully', { sessionId, title });

    return sessionId;
  }

  /**
   * 初始化已存在的空文件
   */
  async initializeExistingFile(
    nodeId: string,
    title: string,
    systemPrompt: string = "You are a helpful assistant."
  ): Promise<string> {
    // 先检查文件是否已有有效内容
    try {
      const content = await this.engine.readContent(nodeId);
      if (content) {
        const str = typeof content === 'string' ? content : new TextDecoder().decode(content);

        // 尝试解析 JSON
        let manifest: ChatManifest;
        try {
          manifest = JSON.parse(str) as ChatManifest;
        } catch (parseError) {
          log.debug(`Manifest JSON parse failed, will reinitialize:`, parseError);
          return await this.createNewSessionStructure(nodeId, title, systemPrompt);
        }

        // 验证 manifest 结构完整性
        if (!this.isValidManifest(manifest)) {
          log.debug(`Invalid manifest structure, will reinitialize`);
          return await this.createNewSessionStructure(nodeId, title, systemPrompt);
        }

        // 检查隐藏目录和根节点
        const hiddenDirPath = this.getHiddenDir(manifest.id);
        const hiddenDirId = await this.engine.resolvePath(hiddenDirPath);

        if (!hiddenDirId) {
          log.debug(`Hidden directory missing for session ${manifest.id}, rebuilding...`);
          return await this.rebuildSessionStructure(nodeId, manifest, systemPrompt);
        }

        // 检查根节点
        const rootNodePath = this.getNodePath(manifest.id, manifest.root_id);
        const rootNode = await this.readJson<ChatNode>(rootNodePath);

        if (!rootNode) {
          log.debug(`Root node missing, rebuilding session structure`);
          return await this.rebuildSessionStructure(nodeId, manifest, systemPrompt);
        }

        log.debug(`Existing valid session found: ${manifest.id}`);
        return manifest.id;
      }
    } catch (e) {
      log.warn(`Failed to read/validate existing content, will create new:`, e);
    }

    // 文件为空或完全损坏，创建新结构
    return await this.createNewSessionStructure(nodeId, title, systemPrompt);
  }

  /**
   * 验证 manifest 结构
   */
  private isValidManifest(manifest: any): manifest is ChatManifest {
    return (
      manifest &&
      typeof manifest.id === 'string' &&
      typeof manifest.root_id === 'string' &&
      typeof manifest.current_branch === 'string' &&
      typeof manifest.current_head === 'string' &&
      manifest.branches &&
      typeof manifest.branches[manifest.current_branch] === 'string'
    );
  }

  /**
   * 创建新的会话结构
   */
  private async createNewSessionStructure(
    nodeId: string,
    title: string,
    systemPrompt: string
  ): Promise<string> {
    const sessionId = generateUUID();
    const now = new Date().toISOString();

    log.debug(`Creating new session structure: nodeId=${nodeId}, sessionId=${sessionId}`);

    // 创建隐藏目录
    await this.engine.createDirectory(this.getHiddenDir(sessionId), null);

    // 创建根节点
    const rootNodeId = `node-${Date.now()}-root`;
    const rootNode: ChatNode = {
      id: rootNodeId,
      type: 'message',
      role: 'system',
      content: systemPrompt,
      created_at: now,
      parent_id: null,
      children_ids: [],
      status: 'active'
    };

    await this.writeJson(this.getNodePath(sessionId, rootNodeId), rootNode);

    // 创建 Manifest
    const manifest: ChatManifest = {
      version: "1.0",
      id: sessionId,
      title: title,
      created_at: now,
      updated_at: now,
      settings: { model: "gpt-4", temperature: 0.7 },
      branches: { "main": rootNodeId },
      current_branch: "main",
      current_head: rootNodeId,
      root_id: rootNodeId
    };

    await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

    await this.engine.updateMetadata(nodeId, {
      title: title,
      icon: '💬',
      sessionId: sessionId
    });

    this.notify();
    return sessionId;
  }

  /**
   * 重建会话结构（保留 manifest ID，重建隐藏目录）
   */
  private async rebuildSessionStructure(
    nodeId: string,
    oldManifest: ChatManifest,
    systemPrompt: string
  ): Promise<string> {
    const sessionId = oldManifest.id;
    const now = new Date().toISOString();

    log.debug(`Rebuilding session structure: sessionId=${sessionId}`);

    // 清理可能存在的残留目录
    const hiddenDirPath = this.getHiddenDir(sessionId);
    try {
      const existingDirId = await this.engine.resolvePath(hiddenDirPath);
      if (existingDirId) {
        await this.engine.delete([existingDirId]);
      }
    } catch (e) {
      // 忽略
    }

    // 重新创建隐藏目录
    await this.engine.createDirectory(hiddenDirPath, null);

    // 创建根节点
    const rootNodeId = `node-${Date.now()}-root`;
    const rootNode: ChatNode = {
      id: rootNodeId,
      type: 'message',
      role: 'system',
      content: systemPrompt,
      created_at: now,
      parent_id: null,
      children_ids: [],
      status: 'active'
    };

    await this.writeJson(this.getNodePath(sessionId, rootNodeId), rootNode);

    // 更新 Manifest（保留原始 ID 和 title）
    const manifest: ChatManifest = {
      ...oldManifest,
      root_id: rootNodeId,
      branches: { "main": rootNodeId },
      current_branch: "main",
      current_head: rootNodeId,
      updated_at: now
    };

    await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

    this.notify();
    return sessionId;
  }

  /**
   * 获取会话上下文
   */
  async getSessionContext(nodeId: string, sessionId: string): Promise<ChatContextItem[]> {
    const manifest = await this.getManifest(nodeId);
    if (!manifest) throw new Error("Manifest missing");

    const nodes: ChatNode[] = [];
    let currentNodeId: string | null = manifest.current_head;

    while (currentNodeId) {
      const chatNode: ChatNode | null = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, currentNodeId)
      );
      if (!chatNode) break;
      nodes.push(chatNode);
      currentNodeId = chatNode.parent_id;
    }

    // 反转并过滤
    return nodes
      .reverse()
      .filter(node => node.status === 'active')
      .map((node, index) => ({ node, depth: index }));
  }

  /**
   * 获取 Manifest
   */
  async getManifest(nodeId: string): Promise<ChatManifest> {
    try {
      const content = await this.engine.readContent(nodeId);
      if (!content) throw new Error("Empty file content");

      const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
      return JSON.parse(str) as ChatManifest;
    } catch (e) {
      console.error(`[LLMSessionEngine] Failed to read manifest from node ${nodeId}`, e);
      throw new Error(`Manifest missing for node: ${nodeId}`);
    }
  }

  /**
   * 读取 UI 状态
   */
  async getUIState(nodeId: string): Promise<ChatManifest['ui_state'] | null> {
    try {
      const manifest = await this.getManifest(nodeId);
      return manifest.ui_state || null;
    } catch (e) {
      console.warn('[LLMSessionEngine] getUIState failed:', e);
      return null;
    }
  }

  /**
   * 更新 UI 状态（增量合并）
   */
  async updateUIState(
    nodeId: string,
    updates: Partial<NonNullable<ChatManifest['ui_state']>>
  ): Promise<void> {
    return this.lockManager.acquire(`uistate:${nodeId}`, async () => {
      try {
        const manifest = await this.getManifest(nodeId);

        manifest.ui_state = {
          ...manifest.ui_state,
          ...updates,
          collapse_states: {
            ...manifest.ui_state?.collapse_states,
            ...updates.collapse_states
          }
        };

        manifest.updated_at = new Date().toISOString();

        await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
      } catch (e: any) {
        if (e.message?.includes('not found') ||
          e.message?.includes('Node not found') ||
          e.message?.includes('Manifest missing')) {
          console.log(`[LLMSessionEngine] Node ${nodeId} no longer exists, UI state update skipped`);
          return;
        }
        throw e;
      }
    });
  }

  // ============================================================
  // 消息操作
  // ============================================================

  /**
   * 追加消息
   */
  async appendMessage(
    nodeId: string,
    sessionId: string,
    role: ChatNode['role'],
    content: string,
    meta?: AppendMessageMeta
  ): Promise<string> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const manifest = await this.getManifest(nodeId);

      const parentId = manifest.current_head;
      const newNodeId = generateUUID();
      const now = new Date().toISOString();

      // 1. 创建新节点
      const newNode: ChatNode = {
        id: newNodeId,
        type: 'message',
        role,
        content,
        created_at: now,
        parent_id: parentId,
        children_ids: [],
        meta,
        status: 'active'
      };

      // 2. 写入新节点
      await this.writeJson(this.getNodePath(sessionId, newNodeId), newNode);

      // 3. 更新父节点的 children_ids
      if (parentId) {
        const parentNode = await this.readJson<ChatNode>(this.getNodePath(sessionId, parentId));
        if (parentNode) {
          if (!parentNode.children_ids) parentNode.children_ids = [];
          parentNode.children_ids.push(newNodeId);
          await this.writeJson(this.getNodePath(sessionId, parentId), parentNode);
        }
      }

      // 4. 智能更新 Summary 和 Title
      if (role === 'user') {
        let needMetaUpdate = false;
        const metaUpdates: any = {};

        // 处理 Summary
        if (!manifest.summary || manifest.summary === "New conversation") {
          manifest.summary = content.substring(0, 100).replace(/[\r\n]+/g, ' ').trim();
        }

        // 处理 Title
        const defaultTitles = new Set(['New Chat', 'Untitled', 'New conversation']);
        if (defaultTitles.has(manifest.title)) {
          let newTitle = content.substring(0, 30).replace(/[\r\n]+/g, ' ').trim();
          if (newTitle.length === 0) newTitle = "Chat";

          manifest.title = newTitle;
          metaUpdates.title = newTitle;
          needMetaUpdate = true;

          log.info('Updated session title', {
            sessionId,
            oldTitle: manifest.title,
            newTitle
          });
        }

        if (needMetaUpdate) {
          try {
            await this.engine.updateMetadata(nodeId, metaUpdates);
          } catch (e) {
            log.warn('Failed to update session metadata', {
              sessionId,
              nodeId,
              error: e
            });
          }
        }
      }

      // 5. 更新 Manifest
      manifest.current_head = newNodeId;
      manifest.branches[manifest.current_branch] = newNodeId;
      manifest.updated_at = now;

      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

      return newNodeId;
    });
  }

  /**
   * 更新节点（支持流式持久化）
   */
  async updateNode(
    sessionId: string,
    nodeId: string,
    updates: {
      content?: string;
      meta?: UpdateMessageMeta;
      status?: ChatNode['status'];
    }
  ): Promise<void> {
    return this.lockManager.acquire(`node:${sessionId}:${nodeId}`, async () => {
      const path = this.getNodePath(sessionId, nodeId);
      const node = await this.readJson<ChatNode>(path);

      if (!node) {
        log.warn('Node not found for update', { sessionId, nodeId });
        return;
      }

      let hasChanges = false;
      const changes: string[] = [];

      if (updates.content !== undefined && updates.content !== node.content) {
        node.content = updates.content;
        hasChanges = true;
        changes.push('content');
      }

      if (updates.status !== undefined && updates.status !== node.status) {
        node.status = updates.status;
        hasChanges = true;
        changes.push('status');
      }

      if (updates.meta) {
        node.meta = { ...node.meta, ...updates.meta };
        hasChanges = true;
        changes.push('meta');
      }

      if (hasChanges) {
        await this.writeJson(path, node);
      }
    });
  }

  /**
   * 删除单条消息
   *
   * 操作步骤（已修正时序）：
   * 1. 读取目标节点
   * 2. 软删除当前节点及其所有后代（标记 status: 'deleted'）
   * 3. 从父节点的 children_ids 中移除引用
   * 4. 修复 manifest（current_head / branch heads 回退）
   */
  async deleteMessage(
    nodeId: string,
    sessionId: string,
    messageNodeId: string
  ): Promise<void> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      await this.deleteMessageInternal(nodeId, sessionId, messageNodeId);
    });
  }

  /**
   * ✅ 新增：批量删除消息
   *
   * 优化点：
   * - 单次锁获取
   * - 批量处理所有节点的软删除和父引用清理
   * - 只读写一次 manifest
   */
  async deleteMessages(
    nodeId: string,
    sessionId: string,
    messageNodeIds: string[]
  ): Promise<void> {
    if (messageNodeIds.length === 0) return;

    if (messageNodeIds.length === 1) {
      return this.deleteMessage(nodeId, sessionId, messageNodeIds[0]);
    }

    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const deletedNodeIds = new Set<string>();
      // parentId -> Set<childIdsToRemove>
      const parentUpdates = new Map<string, Set<string>>();

      // 阶段 1：收集所有需要删除的节点信息
      for (const messageNodeId of messageNodeIds) {
        const messagePath = this.getNodePath(sessionId, messageNodeId);
        const messageNode = await this.readJson<ChatNode>(messagePath);

        if (!messageNode || messageNode.status === 'deleted') {
          continue;
        }

        // 记录需要从父节点移除的引用
        if (messageNode.parent_id) {
          if (!parentUpdates.has(messageNode.parent_id)) {
            parentUpdates.set(messageNode.parent_id, new Set());
          }
          parentUpdates.get(messageNode.parent_id)!.add(messageNodeId);
        }

        // 收集当前节点及其所有后代
        await this.collectDescendantIds(sessionId, messageNodeId, deletedNodeIds);
      }

      if (deletedNodeIds.size === 0) {
        log.debug('No nodes to delete in batch', { sessionId });
        return;
      }

      // 阶段 2：批量软删除所有节点
      for (const deletedId of deletedNodeIds) {
        const path = this.getNodePath(sessionId, deletedId);
        const node = await this.readJson<ChatNode>(path);
        if (node && node.status !== 'deleted') {
          node.status = 'deleted';
          await this.writeJson(path, node);
        }
      }

      // 阶段 3：批量更新父节点的 children_ids
      for (const [parentId, childIdsToRemove] of parentUpdates) {
        // 如果父节点本身也在删除列表中，跳过
        if (deletedNodeIds.has(parentId)) continue;

        const parentPath = this.getNodePath(sessionId, parentId);
        const parentNode = await this.readJson<ChatNode>(parentPath);
        if (parentNode) {
          const originalLength = parentNode.children_ids.length;
          parentNode.children_ids = parentNode.children_ids.filter(
            id => !childIdsToRemove.has(id)
          );
          if (parentNode.children_ids.length !== originalLength) {
            await this.writeJson(parentPath, parentNode);
          }
        }
      }

      // 阶段 4：一次性修复 manifest
      await this.repairManifestAfterBatchDelete(nodeId, sessionId, deletedNodeIds);

      log.info('Batch delete completed', {
        sessionId,
        requestedCount: messageNodeIds.length,
        actualDeletedCount: deletedNodeIds.size
      });
    });
  }

  // ============================================================
  // 删除 - 内部辅助方法
  // ============================================================

  /**
   * 内部删除逻辑（不获取锁，由调用方负责加锁）
   */
  private async deleteMessageInternal(
    nodeId: string,
    sessionId: string,
    messageNodeId: string
  ): Promise<void> {
    const messagePath = this.getNodePath(sessionId, messageNodeId);
    const messageNode = await this.readJson<ChatNode>(messagePath);

    if (!messageNode) {
      log.warn('Message node not found for deletion', {
        sessionId,
        messageNodeId
      });
      return;
    }

    if (messageNode.status === 'deleted') {
      return;
    }

    // ✅ 步骤 1：先软删除当前节点及其所有后代
    const deletedCount = await this.softDeleteRecursive(sessionId, messageNodeId);

    // ✅ 步骤 2：从父节点的 children_ids 中移除引用
    if (messageNode.parent_id) {
      await this.removeFromParentChildren(sessionId, messageNode.parent_id, messageNodeId);
    }

    // ✅ 步骤 3：最后更新 manifest
    await this.repairManifestAfterDelete(nodeId, sessionId, messageNodeId, messageNode);

    log.debug('Message deleted', {
      sessionId,
      messageNodeId,
      deletedCount
    });
  }

  /**
   * 从父节点的 children_ids 中移除指定子节点
   */
  private async removeFromParentChildren(
    sessionId: string,
    parentId: string,
    childId: string
  ): Promise<void> {
    const parentPath = this.getNodePath(sessionId, parentId);
    const parentNode = await this.readJson<ChatNode>(parentPath);

    if (!parentNode) return;

    const index = parentNode.children_ids.indexOf(childId);
    if (index !== -1) {
      parentNode.children_ids.splice(index, 1);
      await this.writeJson(parentPath, parentNode);
    }
  }

  /**
   * 递归软删除节点及其所有后代
   */
  private async softDeleteRecursive(sessionId: string, nodeId: string): Promise<number> {
    const path = this.getNodePath(sessionId, nodeId);
    const node = await this.readJson<ChatNode>(path);

    if (!node || node.status === 'deleted') return 0;

    let count = 0;

    // 先递归删除子节点
    for (const childId of node.children_ids) {
      count += await this.softDeleteRecursive(sessionId, childId);
    }

    // 标记当前节点为删除
    node.status = 'deleted';
    await this.writeJson(path, node);
    count++;

    return count;
  }

  /**
   * 递归收集节点及其所有后代 ID（不修改任何数据）
   */
  private async collectDescendantIds(
    sessionId: string,
    nodeId: string,
    collected: Set<string>
  ): Promise<void> {
    if (collected.has(nodeId)) return; // 防止循环

    const path = this.getNodePath(sessionId, nodeId);
    const node = await this.readJson<ChatNode>(path);
    if (!node || node.status === 'deleted') return;

    collected.add(nodeId);

    for (const childId of node.children_ids) {
      await this.collectDescendantIds(sessionId, childId, collected);
    }
  }

  /**
   * 单条删除后修复 manifest
   */
  private async repairManifestAfterDelete(
    nodeId: string,
    sessionId: string,
    deletedNodeId: string,
    deletedNode: ChatNode
  ): Promise<void> {
    const manifest = await this.getManifest(nodeId);
    let needsUpdate = false;
    const repairs: string[] = [];

    // 检查 current_head 是否在被删除的子树中
    if (await this.isNodeInDeletedSubtree(manifest.current_head, deletedNodeId, sessionId)) {
      // 回退到被删除节点的父节点
      let newHead = deletedNode.parent_id || manifest.root_id;

      // 验证新的 head 是否有效
      const newHeadNode = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, newHead)
      );
      if (!newHeadNode || newHeadNode.status === 'deleted') {
        // 如果父节点也无效，回退到 root
        newHead = manifest.root_id;
      }

      manifest.current_head = newHead;
      manifest.branches[manifest.current_branch] = newHead;
      needsUpdate = true;

      repairs.push(`current_head: ${deletedNodeId} -> ${newHead}`);
    }

    // 检查其他分支是否引用了被删除的节点
    for (const [branchName, branchHead] of Object.entries(manifest.branches)) {
      if (branchName === manifest.current_branch) continue;

      if (await this.isNodeInDeletedSubtree(branchHead, deletedNodeId, sessionId)) {
        const fallback = deletedNode.parent_id || manifest.root_id;
        manifest.branches[branchName] = fallback;
        needsUpdate = true;
        repairs.push(`branch "${branchName}": ${branchHead} -> ${fallback}`);
      }
    }

    if (needsUpdate) {
      manifest.updated_at = new Date().toISOString();
      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
      log.info('Manifest repaired after deletion', { sessionId, repairs });
    }
  }

  /**
   * ✅ 新增：批量删除后一次性修复 manifest
   */
  private async repairManifestAfterBatchDelete(
    nodeId: string,
    sessionId: string,
    deletedNodeIds: Set<string>
  ): Promise<void> {
    const manifest = await this.getManifest(nodeId);
    let needsUpdate = false;
    const repairs: string[] = [];

    // 修复 current_head
    if (deletedNodeIds.has(manifest.current_head)) {
      const newHead = await this.findNearestActiveAncestor(
        sessionId,
        manifest.current_head,
        deletedNodeIds,
        manifest.root_id
      );
      manifest.current_head = newHead;
      manifest.branches[manifest.current_branch] = newHead;
      needsUpdate = true;
      repairs.push(`current_head -> ${newHead}`);
    }

    // 修复所有分支 heads
    for (const [branchName, branchHead] of Object.entries(manifest.branches)) {
      if (branchName === manifest.current_branch) continue;

      if (deletedNodeIds.has(branchHead)) {
        const newHead = await this.findNearestActiveAncestor(
          sessionId,
          branchHead,
          deletedNodeIds,
          manifest.root_id
        );
        manifest.branches[branchName] = newHead;
        needsUpdate = true;
        repairs.push(`branch "${branchName}" -> ${newHead}`);
      }
    }

    if (needsUpdate) {
      manifest.updated_at = new Date().toISOString();
      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
      log.info('Manifest repaired after batch delete', { sessionId, repairs });
    }
  }

  /**
   * ✅ 新增：从目标节点向上查找最近的未被删除的祖先
   */
  private async findNearestActiveAncestor(
    sessionId: string,
    startNodeId: string,
    deletedNodeIds: Set<string>,
    fallbackId: string
  ): Promise<string> {
    let currentId: string | null = startNodeId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const node: ChatNode | null = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, currentId)
      );
      if (!node) break;

      // 检查父节点是否未被删除且有效
      if (node.parent_id && !deletedNodeIds.has(node.parent_id)) {
        const parentNode = await this.readJson<ChatNode>(
          this.getNodePath(sessionId, node.parent_id)
        );
        if (parentNode && parentNode.status === 'active') {
          return node.parent_id;
        }
      }

      currentId = node.parent_id;
    }

    return fallbackId;
  }

  /**
   * 检查 targetId 是否等于 deletedId 或是 deletedId 的后代
   */
  private async isNodeInDeletedSubtree(
    targetId: string,
    deletedId: string,
    sessionId: string
  ): Promise<boolean> {
    if (targetId === deletedId) return true;

    // 从 targetId 向上遍历，检查是否经过 deletedId
    let currentId: string | null = targetId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === deletedId) return true;
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const node: ChatNode | null = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, currentId)
      );
      if (!node) break;

      currentId = node.parent_id;
    }

    return false;
  }

  /**
   * 编辑消息（创建分支）
   */
  async editMessage(
    nodeId: string,
    sessionId: string,
    originalNodeId: string,
    newContent: string
  ): Promise<string> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const manifest = await this.getManifest(nodeId);
      const originalNode = await this.readJson<ChatNode>(this.getNodePath(sessionId, originalNodeId));

      if (!originalNode) {
        throw new Error("Original node not found");
      }

      const newNodeId = generateUUID();
      const now = new Date().toISOString();

      // 创建新节点（从同一父节点分支）
      const newNode: ChatNode = {
        ...originalNode,
        id: newNodeId,
        content: newContent,
        created_at: now,
        children_ids: []
      };

      await this.writeJson(this.getNodePath(sessionId, newNodeId), newNode);

      // 更新父节点的 children_ids
      if (newNode.parent_id) {
        const parent = await this.readJson<ChatNode>(this.getNodePath(sessionId, newNode.parent_id));
        if (parent) {
          parent.children_ids.push(newNodeId);
          await this.writeJson(this.getNodePath(sessionId, newNode.parent_id), parent);
        }
      }

      // 更新 Manifest
      manifest.current_head = newNodeId;
      manifest.branches[manifest.current_branch] = newNodeId;
      manifest.updated_at = now;

      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

      return newNodeId;
    });
  }

  // ============================================================
  // 分支操作
  // ============================================================

  /**
   * 创建新分支
   */
  async createBranch(
    nodeId: string,
    sessionId: string,
    sourceMessageId: string,
    options?: {
      name?: string;
      copyContent?: boolean;
      createdFrom?: 'retry' | 'edit' | 'manual';
    }
  ): Promise<string> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      log.info('Creating branch', {
        sessionId,
        sourceMessageId,
        branchName: options?.name,
        createdFrom: options?.createdFrom
      });

      const manifest = await this.getManifest(nodeId);
      const sourceNode = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, sourceMessageId)
      );

      if (!sourceNode) {
        log.error('Source node not found for branch creation', {
          sessionId,
          sourceMessageId,
          path: this.getNodePath(sessionId, sourceMessageId)
        });
        throw new Error(`Source node not found: ${sourceMessageId}`);
      }

      const newNodeId = generateUUID();
      const now = new Date().toISOString();

      const branchMeta = {
        branchMetadata: {
          branchName: options?.name,
          createdFrom: options?.createdFrom || 'manual',
          createdAt: now,
        }
      };

      if (sourceNode.role === 'user') {
        // ✅ User Node：创建并列的兄弟 user 节点
        //   parent
        //     ├── sourceNode (user)
        //     └── newNode (user)     ← 新增
        const newNode: ChatNode = {
          id: newNodeId,
          type: 'message',
          role: 'user',
          content: options?.copyContent ? sourceNode.content : '',
          created_at: now,
          parent_id: sourceNode.parent_id,
          children_ids: [],
          status: 'active',
          meta: {
            ...branchMeta,
            ...(options?.copyContent ? { files: sourceNode.meta?.files } : {}),
          }
        };

        await this.writeJson(this.getNodePath(sessionId, newNodeId), newNode);

        if (sourceNode.parent_id) {
          const parent = await this.readJson<ChatNode>(
            this.getNodePath(sessionId, sourceNode.parent_id)
          );
          if (parent && !parent.children_ids.includes(newNodeId)) {
            parent.children_ids.push(newNodeId);
            await this.writeJson(
              this.getNodePath(sessionId, sourceNode.parent_id),
              parent
            );
          }
        }

      } else if (sourceNode.role === 'assistant') {
        // ✅ Assistant Node：创建下一轮对话的分支入口
        //   sourceNode (assistant)
        //     ├── existingChild
        //     └── newNode (user)     ← 新增，等待用户输入
        const newNode: ChatNode = {
          id: newNodeId,
          type: 'message',
          role: 'user',
          content: '',
          created_at: now,
          parent_id: sourceMessageId,
          children_ids: [],
          status: 'active',
          meta: branchMeta,
        };

        await this.writeJson(this.getNodePath(sessionId, newNodeId), newNode);

        if (!sourceNode.children_ids.includes(newNodeId)) {
          sourceNode.children_ids.push(newNodeId);
          await this.writeJson(
            this.getNodePath(sessionId, sourceMessageId),
            sourceNode
          );
        }

      } else {
        // system 或其他：默认作为兄弟节点
        const newNode: ChatNode = {
          ...sourceNode,
          id: newNodeId,
          created_at: now,
          children_ids: [],
          status: 'active',
          meta: { ...sourceNode.meta, ...branchMeta },
        };

        if (!options?.copyContent) {
          newNode.content = '';
        }

        await this.writeJson(this.getNodePath(sessionId, newNodeId), newNode);

        if (sourceNode.parent_id) {
          const parent = await this.readJson<ChatNode>(
            this.getNodePath(sessionId, sourceNode.parent_id)
          );
          if (parent && !parent.children_ids.includes(newNodeId)) {
            parent.children_ids.push(newNodeId);
            await this.writeJson(
              this.getNodePath(sessionId, sourceNode.parent_id),
              parent
            );
          }
        }
      }

      // 更新 Manifest
      manifest.current_head = newNodeId;
      manifest.branches[manifest.current_branch] = newNodeId;
      manifest.updated_at = now;

      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

      log.info('Branch created successfully', {
        sessionId,
        newNodeId,
        sourceRole: sourceNode.role,
        branchName: options?.name
      });

      return newNodeId;
    });
  }

  /**
 * 根据指定 head 节点获取上下文（用于查看非当前分支）
 */
  async getSessionContextFromHead(
    _nodeId: string,
    sessionId: string,
    headNodeId: string
  ): Promise<ChatContextItem[]> {
    const nodes: ChatNode[] = [];
    let currentNodeId: string | null = headNodeId;
    const visited = new Set<string>();

    while (currentNodeId) {
      if (visited.has(currentNodeId)) {
        log.warn('Circular reference detected in branch traversal', {
          sessionId,
          nodeId: currentNodeId
        });
        break;
      }
      visited.add(currentNodeId);

      const chatNode: ChatNode | null = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, currentNodeId)
      );
      if (!chatNode) break;

      if (chatNode.status === 'active') {
        nodes.push(chatNode);
      }

      currentNodeId = chatNode.parent_id;
    }

    return nodes
      .reverse()
      .filter(node => node.status === 'active')
      .map((node, index) => ({ node, depth: index }));
  }

  /**
   * 获取分支树
   */
  async getBranchTree(
    sessionId: string,
    nodeId: string,
    rootNodeId?: string
  ): Promise<BranchTreeNode> {
    const manifest = await this.getManifest(nodeId);
    const root = rootNodeId || manifest.root_id;
    return this.buildBranchTreeRecursive(sessionId, root, manifest.current_head);
  }

  /**
   * ✅ 修复：递归构建分支树，过滤已删除节点
   */
  private async buildBranchTreeRecursive(
    sessionId: string,
    nodeId: string,
    activeNodeId: string
  ): Promise<BranchTreeNode> {
    const node = await this.readJson<ChatNode>(
      this.getNodePath(sessionId, nodeId)
    );

    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    const children: BranchTreeNode[] = [];
    for (const childId of node.children_ids) {
      // ✅ 修复：先检查子节点状态，跳过已删除的节点
      const childNode = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, childId)
      );
      if (!childNode || childNode.status === 'deleted') {
        continue;
      }

      try {
        const childTree = await this.buildBranchTreeRecursive(
          sessionId,
          childId,
          activeNodeId
        );
        children.push(childTree);
      } catch (e) {
        // 子节点构建失败时跳过，避免整棵树构建失败
        log.warn('Failed to build branch tree child', {
          sessionId,
          childId,
          error: e
        });
      }
    }

    return {
      id: nodeId,
      role: node.role,
      content: node.content,
      timestamp: new Date(node.created_at).getTime(),
      isActive: nodeId === activeNodeId,
      branchName: node.meta?.branchMetadata?.branchName,
      createdFrom: node.meta?.branchMetadata?.createdFrom,
      children
    };
  }

  /**
   * 重命名分支
   */
  async renameBranch(
    sessionId: string,
    nodeId: string,
    newName: string
  ): Promise<void> {
    return this.lockManager.acquire(`node:${sessionId}:${nodeId}`, async () => {
      const path = this.getNodePath(sessionId, nodeId);
      const node = await this.readJson<ChatNode>(path);

      if (!node) {
        throw new Error('Node not found');
      }

      if (!node.meta) {
        node.meta = {};
      }

      if (!node.meta.branchMetadata) {
        node.meta.branchMetadata = {};
      }

      node.meta.branchMetadata.branchName = newName;

      await this.writeJson(path, node);
    });
  }

  /**
   * 删除分支（级联删除子节点）
   */
  async deleteBranch(
    nodeId: string,
    sessionId: string,
    messageNodeId: string,
    options?: { cascade?: boolean }
  ): Promise<string[]> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      log.info('Deleting branch', {
        sessionId,
        messageNodeId,
        cascade: options?.cascade
      });

      const deletedIds: string[] = [];
      const targetNode = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, messageNodeId)
      );
      if (!targetNode) {
        log.warn('Target node not found for branch deletion', {
          sessionId,
          messageNodeId
        });
        return deletedIds;
      }

      // ✅ 修正时序：先收集并软删除，再移除父引用

      // 递归软删除
      const deleteRecursive = async (id: string): Promise<void> => {
        const node: ChatNode | null = await this.readJson<ChatNode>(
          this.getNodePath(sessionId, id)
        );
        if (!node || node.status === 'deleted') return;

        if (options?.cascade) {
          for (const childId of node.children_ids) {
            await deleteRecursive(childId);
          }
        }

        node.status = 'deleted';
        await this.writeJson(this.getNodePath(sessionId, id), node);
        deletedIds.push(id);
      };

      await deleteRecursive(messageNodeId);

      // 从父节点的 children_ids 中移除
      if (targetNode.parent_id) {
        await this.removeFromParentChildren(
          sessionId,
          targetNode.parent_id,
          messageNodeId
        );
      }

      // 修复 manifest
      await this.repairManifestAfterDelete(
        nodeId,
        sessionId,
        messageNodeId,
        targetNode
      );

      log.info('Branch deleted successfully', {
        sessionId,
        deletedCount: deletedIds.length,
        deletedIds
      });

      return deletedIds;
    });
  }

  /**
   * 切换分支
   */
  async switchBranch(nodeId: string, sessionId: string, branchName: string): Promise<void> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const manifest = await this.getManifest(nodeId);

      if (!manifest.branches[branchName]) {
        throw new Error("Branch not found");
      }

      manifest.current_branch = branchName;
      manifest.current_head = manifest.branches[branchName];
      manifest.updated_at = new Date().toISOString();

      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
    });
  }

  /**
   * 获取节点的兄弟节点
   */
  async getNodeSiblings(sessionId: string, nodeId: string): Promise<ChatNode[]> {
    const node = await this.readJson<ChatNode>(this.getNodePath(sessionId, nodeId));
    if (!node || !node.parent_id) return node ? [node] : [];

    const parent = await this.readJson<ChatNode>(this.getNodePath(sessionId, node.parent_id));
    if (!parent) return [node];

    const siblings = await Promise.all(
      parent.children_ids.map(id => this.readJson<ChatNode>(this.getNodePath(sessionId, id)))
    );

    return siblings.filter((n): n is ChatNode => n !== null && n.status === 'active');
  }

  // ============================================================
  // ID 转换
  // ============================================================

  async getSessionIdFromNodeId(nodeId: string): Promise<string | null> {
    try {
      const manifest = await this.getManifest(nodeId);
      return manifest.id || null;
    } catch (e) {
      console.error('[LLMSessionEngine] getSessionIdFromNodeId failed:', e);
      return null;
    }
  }

  // ============================================================
  // ISessionEngine 文件操作
  // ============================================================

  async loadTree(): Promise<EngineNode[]> {
    const allNodes = await this.engine.loadTree();

    return allNodes.filter((node: EngineNode) => {
      if (node.name.startsWith('.')) return false;

      if (node.type === 'file') {
        return node.name.endsWith('.chat');
      }

      if (node.type === 'directory') {
        return true;
      }

      return false;
    });
  }

  async createDirectory(name: string, parentId: string | null): Promise<EngineNode> {
    return this.engine.createDirectory(name, parentId);
  }

  async createFile(
    name: string,
    parentId: string | null,
    _content?: string | ArrayBuffer
  ): Promise<EngineNode> {
    const baseName = (name || "New Chat").replace(/\.chat$/i, '');
    const availableName = await this.findAvailableFileName(baseName, parentId);

    const sessionId = generateUUID();
    const now = new Date().toISOString();

    try {
      await this.engine.createDirectory(this.getHiddenDir(sessionId), null);
    } catch (e: any) {
      if (e.message?.includes('exists')) {
        log.debug(`Hidden directory already exists for ${sessionId}, this is unexpected`);
      } else {
        throw e;
      }
    }

    const rootNodeId = `node-${Date.now()}-root`;
    const rootNode: ChatNode = {
      id: rootNodeId,
      type: 'message',
      role: 'system',
      content: "You are a helpful assistant.",
      created_at: now,
      parent_id: null,
      children_ids: [],
      status: 'active'
    };
    await this.writeJson(this.getNodePath(sessionId, rootNodeId), rootNode);

    // 3. 构建 Manifest
    const manifest: ChatManifest = {
      version: "1.0",
      id: sessionId,
      title: availableName,
      created_at: now,
      updated_at: now,
      settings: { model: "gpt-4", temperature: 0.7 },
      branches: { "main": rootNodeId },
      current_branch: "main",
      current_head: rootNodeId,
      root_id: rootNodeId
    };

    // 4. 创建 .chat 文件
    const manifestContent = JSON.stringify(manifest, null, 2);
    const chatFileName = `${availableName}.chat`;

    const node = await this.engine.createFile(
      chatFileName,
      parentId,
      manifestContent,
      {
        title: availableName,
        icon: '💬',
        sessionId: sessionId
      }
    );

    this.notify();
    return node;
  }

  /**
   * 查找可用的文件名
   * 如果 "name" 已存在，尝试 "name (1)", "name (2)" 等
   */
  private async findAvailableFileName(baseName: string, parentId: string | null): Promise<string> {
    const maxAttempts = 100;

    // 获取父目录下的所有文件名
    const existingNames = new Set<string>();

    try {
      let children: EngineNode[];
      if (parentId) {
        children = await this.engine.getChildren(parentId);
      } else {
        // 根目录
        const tree = await this.engine.loadTree();
        children = tree.filter(n => !n.parentId || n.parentId === null);
      }

      children.forEach(child => {
        if (child.name.endsWith('.chat')) {
          existingNames.add(child.name.replace(/\.chat$/i, '').toLowerCase());
        }
      });
    } catch (e) {
      log.debug(`Failed to list existing files:`, e);
      // 继续执行，假设没有冲突
    }

    // 检查原始名称
    if (!existingNames.has(baseName.toLowerCase())) {
      return baseName;
    }

    // 尝试带数字后缀的名称
    for (let i = 1; i <= maxAttempts; i++) {
      const numberedName = `${baseName} (${i})`;
      if (!existingNames.has(numberedName.toLowerCase())) {
        log.debug(`File name conflict resolved: "${baseName}" -> "${numberedName}"`);
        return numberedName;
      }
    }

    // 超过最大尝试次数，使用 UUID 后缀
    const fallbackName = `${baseName}_${generateUUID().substring(0, 8)}`;
    log.debug(`File name conflict: max attempts exceeded, using fallback: "${fallbackName}"`);
    return fallbackName;
  }

  /**
   * 重命名
   */
  async rename(id: string, newName: string): Promise<void> {
    // 使用新 API 获取节点
    const node = await this.vfs.getNodeById(id);
    if (!node) throw new Error("Node not found");

    try {
      const manifest = await this.getManifest(id);
      manifest.title = newName;
      manifest.updated_at = new Date().toISOString();
      await this.engine.writeContent(id, JSON.stringify(manifest, null, 2));
    } catch (e) {
      console.warn("Failed to update manifest title", e);
    }

    await this.engine.updateMetadata(id, {
      ...node.metadata,
      title: newName
    });
  }

  /**
   * 删除
   */
  async delete(ids: string[]): Promise<void> {
    log.info('Deleting nodes', {
      count: ids.length,
      nodeIds: ids
    });

    const cleanupRecursively = async (nodeId: string) => {
      const node = await this.vfs.getNodeById(nodeId);
      if (!node) return;

      // 使用类型判断
      const isDirectory = node.type === VNodeType.DIRECTORY;
      const isFile = node.type === VNodeType.FILE;

      if (isDirectory) {
        // 如果是目录，获取子节点并递归
        const children = await this.engine.getChildren(nodeId);
        for (const child of children) {
          await cleanupRecursively(child.id);
        }
      } else if (isFile && node.name.endsWith('.chat')) {
        // 如果是 chat 文件，执行清理逻辑
        try {
          const content = await this.engine.readContent(nodeId);

          if (content) {
            const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
            const manifest = JSON.parse(str) as ChatManifest;

            if (manifest.id) {
              log.info('Cleaning up session data', {
                sessionId: manifest.id,
                title: manifest.title
              });

              await this.cleanupManifestReferences(nodeId, manifest);

              const hiddenDirPath = this.getHiddenDir(manifest.id);
              const hiddenDirId = await this.engine.resolvePath(hiddenDirPath);
              if (hiddenDirId) {
                await this.engine.delete([hiddenDirId]);
                log.debug('Hidden directory deleted', {
                  sessionId: manifest.id
                });
              }
            }
          }
        } catch (e) {
          log.error('Failed to cleanup session data', {
            nodeId: node.nodeId,
            nodeName: node.name,
            error: e
          });
        }
      }
    };

    // 1. 先执行逻辑清理 (删除 Hidden Data)
    for (const id of ids) {
      await cleanupRecursively(id);
    }

    // 2. 再执行物理删除
    await this.engine.delete(ids);

    this.notify();

    log.info('Nodes deleted successfully', { count: ids.length });
  }

  /**
   * ✅ 新增：清理 manifest 中的无效引用
   */
  private async cleanupManifestReferences(
    nodeId: string,
    manifest: ChatManifest
  ): Promise<void> {
    let needsUpdate = false;
    const fixes: string[] = [];

    // 1. 检查 current_head 是否存在
    const currentHeadPath = this.getNodePath(manifest.id, manifest.current_head);
    const currentHeadExists = await this.readJson<ChatNode>(currentHeadPath);

    if (!currentHeadExists) {
      // current_head 不存在，回退到 root_id
      manifest.current_head = manifest.root_id;
      manifest.branches[manifest.current_branch] = manifest.root_id;
      needsUpdate = true;
      fixes.push('current_head reset to root');
    }

    // 2. 清理 branches 中的无效引用
    for (const [branchName, branchHead] of Object.entries(manifest.branches)) {
      const branchPath = this.getNodePath(manifest.id, branchHead);
      const branchExists = await this.readJson<ChatNode>(branchPath);

      if (!branchExists) {
        // 分支头节点不存在
        if (branchName === manifest.current_branch) {
          // 如果是当前分支，回退到 root
          manifest.branches[branchName] = manifest.root_id;
          manifest.current_head = manifest.root_id;
          fixes.push(`current branch "${branchName}" reset to root`);
        } else {
          // 如果是其他分支，删除该分支
          delete manifest.branches[branchName];
          fixes.push(`branch "${branchName}" removed`);
        }
        needsUpdate = true;
        log.debug(`Cleaned up invalid branch "${branchName}" for session ${manifest.id}`);
      }
    }

    // 3. 更新 manifest
    if (needsUpdate) {
      manifest.updated_at = new Date().toISOString();
      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

      log.info('Manifest references cleaned', {
        sessionId: manifest.id,
        fixes
      });
    }
  }

  /**
   * 搜索
   */
  async search(query: EngineSearchQuery): Promise<EngineNode[]> {
    const results = await this.engine.search(query);
    return results.filter((node: EngineNode) =>
      node.type === 'file' && node.name.endsWith('.chat')
    );
  }

  // ============================================================
  // 资产操作
  // ============================================================

  /**
   * 创建资产文件
   */
  async createAsset(
    ownerNodeId: string,
    filename: string,
    content: string | ArrayBuffer
  ): Promise<EngineNode> {
    return this.engine.createAsset(ownerNodeId, filename, content);
  }

  /**
   * 获取资产目录 ID
   */
  async getAssetDirectoryId(ownerNodeId: string): Promise<string | null> {
    return this.engine.getAssetDirectoryId(ownerNodeId);
  }

  /**
   * 获取资产列表
   */
  async getAssets(ownerNodeId: string): Promise<EngineNode[]> {
    return this.engine.getAssets(ownerNodeId);
  }

  /**
   * 读取会话资产
   */
  async readSessionAsset(sessionId: string, assetPath: string): Promise<Blob | null> {
    // 清理路径：去掉开头的 ./ 
    const cleanPath = assetPath.startsWith('./') ? assetPath.slice(2) : assetPath;

    // 构造 VFS 内部路径： /.sessionId/filename
    const internalPath = `${this.getHiddenDir(sessionId)}/${cleanPath}`;

    try {
      // 1. 获取 NodeID
      const nodeId = await this.engine.resolvePath(internalPath);
      if (!nodeId) return null;

      // 2. 读取内容
      const content = await this.engine.readContent(nodeId);
      if (!content) return null;

      // 3. 转换为 Blob
      const mimeType = guessMimeType(cleanPath);
      return new Blob([content], { type: mimeType });

    } catch (e) {
      console.warn(`[LLMSessionEngine] Failed to read asset: ${internalPath}`, e);
      return null;
    }
  }

  // ============================================================
  // 代理方法（实现 ISessionEngine 接口）
  // ============================================================

  async getChildren(parentId: string): Promise<EngineNode[]> {
    return this.engine.getChildren(parentId);
  }

  async readContent(id: string): Promise<string | ArrayBuffer> {
    return this.engine.readContent(id);
  }

  async getNode(id: string): Promise<EngineNode | null> {
    return this.engine.getNode(id);
  }

  async writeContent(id: string, content: string | ArrayBuffer): Promise<void> {
    return this.engine.writeContent(id, content);
  }

  async move(ids: string[], targetParentId: string | null): Promise<void> {
    return this.engine.move(ids, targetParentId);
  }

  async updateMetadata(id: string, metadata: Record<string, any>): Promise<void> {
    return this.engine.updateMetadata(id, metadata);
  }

  async setTags(id: string, tags: string[]): Promise<void> {
    return this.engine.setTags(id, tags);
  }

  async setTagsBatch(updates: Array<{ id: string; tags: string[] }>): Promise<void> {
    return this.engine.setTagsBatch(updates);
  }

  async getAllTags(): Promise<Array<{ name: string; color?: string }>> {
    return this.engine.getAllTags();
  }

  on(event: EngineEventType, callback: (e: EngineEvent) => void): () => void {
    return this.engine.on(event, callback);
  }

  // ============================================================
  // 会话设置管理 (YAML)
  // ============================================================

  private getSettingsPath(sessionId: string): string {
    return `${this.getHiddenDir(sessionId)}/settings.yaml`;
  }

  /**
   * 获取会话设置
   */
  async getSessionSettings(sessionId: string): Promise<ChatSessionSettings> {
    const path = this.getSettingsPath(sessionId);

    try {
      const nodeId = await this.engine.resolvePath(path);
      if (!nodeId) {
        log.debug('Session settings not found, using defaults', { sessionId });
        return { ...DEFAULT_SESSION_SETTINGS };
      }

      const content = await this.engine.readContent(nodeId);
      if (!content) {
        return { ...DEFAULT_SESSION_SETTINGS };
      }

      const yamlStr = typeof content === 'string'
        ? content
        : new TextDecoder().decode(content);

      const parsed = YAML.parse(yamlStr) as Partial<ChatSessionSettings>;

      return {
        ...DEFAULT_SESSION_SETTINGS,
        ...parsed,
      };

    } catch (e) {
      log.warn('Failed to load session settings', {
        sessionId,
        error: e
      });
      return { ...DEFAULT_SESSION_SETTINGS };
    }
  }

  async saveSessionSettings(
    sessionId: string,
    settings: Partial<ChatSessionSettings>
  ): Promise<void> {
    return this.lockManager.acquire(`settings:${sessionId}`, async () => {

      const path = this.getSettingsPath(sessionId);

      // 加载现有设置
      let current: ChatSessionSettings;
      try {
        current = await this.getSessionSettings(sessionId);
      } catch {
        current = { ...DEFAULT_SESSION_SETTINGS };
      }

      // 合并设置
      const merged: ChatSessionSettings = {
        ...current,
        ...settings,
        version: '1.0',
        updatedAt: new Date().toISOString(),
      };

      // 序列化为 YAML
      const yamlContent = YAML.stringify(merged, {
        indent: 2,
        lineWidth: 0, // 不自动换行
      });

      // 写入文件
      const nodeId = await this.engine.resolvePath(path);
      if (nodeId) {
        await this.engine.writeContent(nodeId, yamlContent);
      } else {
        // 确保隐藏目录存在
        const hiddenDir = this.getHiddenDir(sessionId);
        const hiddenDirId = await this.engine.resolvePath(hiddenDir);
        if (!hiddenDirId) {
          await this.engine.createDirectory(hiddenDir, null);
        }

        await this.engine.createFile(
          'settings.yaml',
          hiddenDir,
          yamlContent,
          { type: 'settings' }
        );
      }
    });
  }

  /**
 * 原子性更新 manifest head（带锁）
 */
  async updateManifestHead(
    nodeId: string,
    sessionId: string,
    targetNodeId: string
  ): Promise<void> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      log.info('Updating manifest head', {
        sessionId,
        targetNodeId
      });
      const manifest = await this.getManifest(nodeId);

      manifest.current_head = targetNodeId;
      manifest.branches[manifest.current_branch] = targetNodeId;
      manifest.updated_at = new Date().toISOString();

      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

      log.info('Manifest head updated successfully', {
        sessionId,
        branch: manifest.current_branch,
        newHead: targetNodeId
      });
    });
  }

  /**
   * 验证并修复 manifest 一致性
   */
  async validateManifest(nodeId: string, sessionId: string): Promise<boolean> {
    try {
      const manifest = await this.getManifest(nodeId);
      let needsUpdate = false;
      const issues: string[] = [];

      // 1. 验证 current_head
      const currentHeadPath = this.getNodePath(sessionId, manifest.current_head);
      const currentHeadNode = await this.readJson<ChatNode>(currentHeadPath);

      if (!currentHeadNode) {
        manifest.current_head = manifest.root_id;
        manifest.branches[manifest.current_branch] = manifest.root_id;
        needsUpdate = true;
        issues.push('current_head not found');
      }

      // 2. 验证分支
      const validBranches: Record<string, string> = {};

      for (const [branchName, branchHead] of Object.entries(manifest.branches)) {
        const branchPath = this.getNodePath(sessionId, branchHead);
        const branchNode = await this.readJson<ChatNode>(branchPath);

        if (branchNode) {
          validBranches[branchName] = branchHead;
        } else {
          needsUpdate = true;
          issues.push(`branch "${branchName}" head not found`);

          if (branchName === manifest.current_branch) {
            validBranches[branchName] = manifest.root_id;
            manifest.current_head = manifest.root_id;
          }
        }
      }

      // 3. 确保至少有一个分支
      if (Object.keys(validBranches).length === 0) {
        validBranches['main'] = manifest.root_id;
        manifest.current_branch = 'main';
        manifest.current_head = manifest.root_id;
        needsUpdate = true;
        issues.push('no valid branches, created main');
      }

      manifest.branches = validBranches;

      // 4. 写回
      if (needsUpdate) {
        manifest.updated_at = new Date().toISOString();
        await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

        log.warn('Manifest validated and repaired', {
          sessionId,
          issues
        });
      } else {
        log.debug('Manifest validation passed', { sessionId });
      }

      return needsUpdate;
    } catch (e) {
      log.error('Manifest validation failed', {
        sessionId,
        nodeId,
        error: e
      });
      return false;
    }
  }
}
