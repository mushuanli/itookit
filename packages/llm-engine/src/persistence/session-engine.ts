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
import { repairManifest, ManifestIO } from '../utils/manifest-repair';
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
  // ManifestIO 适配器（供 repairManifest 使用）
  // ============================================================

  private getManifestIO(): ManifestIO {
    return {
      getManifest: (nodeId) => this.getManifest(nodeId),
      writeManifest: async (nodeId, manifest) => {
        await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
      }
    };
  }

  // ============================================================
  // 会话结构创建（统一入口）
  // ============================================================

  /**
   * 创建会话的核心数据结构：隐藏目录 + 根节点 + manifest
   * 不负责创建 .chat 文件，由调用方决定如何写入
   */
  private async createSessionStructure(
    sessionId: string,
    title: string,
    systemPrompt: string
  ): Promise<{ sessionId: string; rootNodeId: string; manifest: ChatManifest }> {
    const now = new Date().toISOString();
    const rootNodeId = `node-${Date.now()}-root`;

    await this.engine.createDirectory(this.getHiddenDir(sessionId), null);

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

    const manifest: ChatManifest = {
      version: "1.0",
      id: sessionId,
      title,
      created_at: now,
      updated_at: now,
      settings: { model: "gpt-4", temperature: 0.7 },
      branches: { "main": rootNodeId },
      current_branch: "main",
      current_head: rootNodeId,
      root_id: rootNodeId
    };

    return { sessionId, rootNodeId, manifest };
  }

  // ============================================================
  // 上下文遍历（统一入口）
  // ============================================================

  /**
   * 从指定节点向上遍历 parent 链，构建有序上下文
   */
  private async buildContextChain(
    sessionId: string,
    headNodeId: string
  ): Promise<ChatContextItem[]> {
    const nodes: ChatNode[] = [];
    let currentNodeId: string | null = headNodeId;
    const visited = new Set<string>();

    while (currentNodeId) {
      if (visited.has(currentNodeId)) {
        log.warn('Circular reference detected', { sessionId, nodeId: currentNodeId });
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

    return nodes.reverse().map((node, index) => ({ node, depth: index }));
  }

  // ============================================================
  // 节点操作辅助
  // ============================================================

  /**
   * 向父节点的 children_ids 追加子节点
   */
  private async appendToParentChildren(
    sessionId: string,
    parentId: string | null,
    childId: string
  ): Promise<void> {
    if (!parentId) return;
    const parentNode = await this.readJson<ChatNode>(this.getNodePath(sessionId, parentId));
    if (!parentNode) return;
    if (!parentNode.children_ids) parentNode.children_ids = [];
    parentNode.children_ids.push(childId);
    await this.writeJson(this.getNodePath(sessionId, parentId), parentNode);
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
   * 自动更新会话标题和摘要
   */
  private async autoUpdateTitleAndSummary(
    nodeId: string,
    manifest: ChatManifest,
    content: string
  ): Promise<void> {
    const metaUpdates: Record<string, any> = {};

    if (!manifest.summary || manifest.summary === "New conversation") {
      manifest.summary = content.substring(0, 100).replace(/[\r\n]+/g, ' ').trim();
    }

    const defaultTitles = new Set(['New Chat', 'Untitled', 'New conversation']);
    if (defaultTitles.has(manifest.title)) {
      const newTitle = content.substring(0, 30).replace(/[\r\n]+/g, ' ').trim() || "Chat";
      manifest.title = newTitle;
      metaUpdates.title = newTitle;
    }

    if (Object.keys(metaUpdates).length > 0) {
      try {
        await this.engine.updateMetadata(nodeId, metaUpdates);
      } catch (e) {
        log.warn('Failed to update session metadata', { error: e });
      }
    }
  }

  // ============================================================
  // Manifest 验证辅助
  // ============================================================

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

  private async tryReadValidManifest(nodeId: string): Promise<ChatManifest | null> {
    try {
      const content = await this.engine.readContent(nodeId);
      if (!content) return null;

      const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
      const parsed = JSON.parse(str);
      return this.isValidManifest(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private async isSessionStructureIntact(manifest: ChatManifest): Promise<boolean> {
    const hiddenDirId = await this.engine.resolvePath(this.getHiddenDir(manifest.id));
    if (!hiddenDirId) return false;

    const rootNode = await this.readJson<ChatNode>(
      this.getNodePath(manifest.id, manifest.root_id)
    );
    return !!rootNode;
  }

  // ============================================================
  // 删除辅助
  // ============================================================

  /**
   * 递归软删除节点及其所有后代
   */
  private async softDeleteRecursive(sessionId: string, nodeId: string): Promise<number> {
    const path = this.getNodePath(sessionId, nodeId);
    const node = await this.readJson<ChatNode>(path);
    if (!node || node.status === 'deleted') return 0;

    let count = 0;
    for (const childId of node.children_ids) {
      count += await this.softDeleteRecursive(sessionId, childId);
    }

    node.status = 'deleted';
    await this.writeJson(path, node);
    return count + 1;
  }

  /**
   * 递归收集节点及其所有后代 ID
   */
  private async collectDescendantIds(
    sessionId: string,
    nodeId: string,
    collected: Set<string>
  ): Promise<void> {
    if (collected.has(nodeId)) return;

    const node = await this.readJson<ChatNode>(this.getNodePath(sessionId, nodeId));
    if (!node || node.status === 'deleted') return;

    collected.add(nodeId);
    for (const childId of node.children_ids) {
      await this.collectDescendantIds(sessionId, childId, collected);
    }
  }

  /**
   * 从目标节点向上查找最近的未被删除的祖先
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

      const node: ChatNode | null = await this.readJson<ChatNode>(this.getNodePath(sessionId, currentId));
      if (!node) break;

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
   * 检查 targetId 是否等于 deletedId 或是其后代
   */
  private async isNodeInDeletedSubtree(
    targetId: string,
    deletedId: string,
    sessionId: string
  ): Promise<boolean> {
    if (targetId === deletedId) return true;

    let currentId: string | null = targetId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === deletedId) return true;
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const node: ChatNode | null = await this.readJson<ChatNode>(this.getNodePath(sessionId, currentId));
      if (!node) break;
      currentId = node.parent_id;
    }

    return false;
  }

  /**
   * 使用通用 repairManifest 修复单条删除后的 manifest
   */
  private async repairManifestAfterDelete(
    nodeId: string,
    sessionId: string,
    deletedNodeId: string,
    deletedNode: ChatNode
  ): Promise<void> {
    const io = this.getManifestIO();

    await repairManifest(
      io,
      nodeId,
      async (id) => this.isNodeInDeletedSubtree(id, deletedNodeId, sessionId),
      async (_invalidId, manifest) => {
        const fallback = deletedNode.parent_id || manifest.root_id;
        const node = await this.readJson<ChatNode>(this.getNodePath(sessionId, fallback));
        return (node && node.status !== 'deleted') ? fallback : manifest.root_id;
      }
    );
  }

  /**
   * 使用通用 repairManifest 修复批量删除后的 manifest
   */
  private async repairManifestAfterBatchDelete(
    nodeId: string,
    sessionId: string,
    deletedNodeIds: Set<string>
  ): Promise<void> {
    const io = this.getManifestIO();

    await repairManifest(
      io,
      nodeId,
      async (id) => deletedNodeIds.has(id),
      async (invalidId, manifest) =>
        this.findNearestActiveAncestor(sessionId, invalidId, deletedNodeIds, manifest.root_id)
    );
  }

  // ============================================================
  // 内部删除实现（不获取锁，由调用方加锁）
  // ============================================================

  private async deleteMessageInternal(
    nodeId: string,
    sessionId: string,
    messageNodeId: string
  ): Promise<void> {
    const messagePath = this.getNodePath(sessionId, messageNodeId);
    const messageNode = await this.readJson<ChatNode>(messagePath);

    if (!messageNode || messageNode.status === 'deleted') return;

    await this.softDeleteRecursive(sessionId, messageNodeId);

    if (messageNode.parent_id) {
      await this.removeFromParentChildren(sessionId, messageNode.parent_id, messageNodeId);
    }

    await this.repairManifestAfterDelete(nodeId, sessionId, messageNodeId, messageNode);
  }

  // ============================================================
  // ILLMSessionEngine 核心实现
  // ============================================================

  async createSession(
    title: string,
    systemPrompt: string = "You are a helpful assistant."
  ): Promise<string> {
    const { sessionId, manifest } = await this.createSessionStructure(
      generateUUID(), title, systemPrompt
    );

    await this.engine.createFile(
      `${title}.chat`, null,
      JSON.stringify(manifest, null, 2),
      { title, icon: '💬' }
    );

    this.notify();
    return sessionId;
  }

  async initializeExistingFile(
    nodeId: string,
    title: string,
    systemPrompt: string = "You are a helpful assistant."
  ): Promise<string> {
    const manifest = await this.tryReadValidManifest(nodeId);

    if (!manifest) {
      return this.createNewSessionForNode(nodeId, title, systemPrompt);
    }

    if (!(await this.isSessionStructureIntact(manifest))) {
      return this.rebuildSessionStructure(nodeId, manifest, systemPrompt);
    }

    log.debug(`Existing valid session found: ${manifest.id}`);
    return manifest.id;
  }

  private async createNewSessionForNode(
    nodeId: string,
    title: string,
    systemPrompt: string
  ): Promise<string> {
    const { sessionId, manifest } = await this.createSessionStructure(
      generateUUID(), title, systemPrompt
    );

    await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
    await this.engine.updateMetadata(nodeId, { title, icon: '💬', sessionId });

    this.notify();
    return sessionId;
  }

  private async rebuildSessionStructure(
    nodeId: string,
    oldManifest: ChatManifest,
    systemPrompt: string
  ): Promise<string> {
    const sessionId = oldManifest.id;

    // 清理残留目录
    try {
      const existingDirId = await this.engine.resolvePath(this.getHiddenDir(sessionId));
      if (existingDirId) {
        await this.engine.delete([existingDirId]);
      }
    } catch {
      // ignore
    }

    const { manifest } = await this.createSessionStructure(
      sessionId, oldManifest.title, systemPrompt
    );

    await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

    this.notify();
    return sessionId;
  }

  // ============================================================
  // 上下文
  // ============================================================

  async getSessionContext(nodeId: string, sessionId: string): Promise<ChatContextItem[]> {
    const manifest = await this.getManifest(nodeId);
    if (!manifest) throw new Error("Manifest missing");
    return this.buildContextChain(sessionId, manifest.current_head);
  }

  async getSessionContextFromHead(
    _nodeId: string,
    sessionId: string,
    headNodeId: string
  ): Promise<ChatContextItem[]> {
    return this.buildContextChain(sessionId, headNodeId);
  }

  async getManifest(nodeId: string): Promise<ChatManifest> {
    try {
      const content = await this.engine.readContent(nodeId);
      if (!content) throw new Error("Empty file content");

      const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
      return JSON.parse(str) as ChatManifest;
    } catch (e) {
      throw new Error(`Manifest missing for node: ${nodeId}`);
    }
  }

  // ============================================================
  // UI 状态
  // ============================================================

  async getUIState(nodeId: string): Promise<ChatManifest['ui_state'] | null> {
    try {
      const manifest = await this.getManifest(nodeId);
      return manifest.ui_state || null;
    } catch {
      return null;
    }
  }

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
        if (e.message?.includes('not found') || e.message?.includes('Manifest missing')) {
          return;
        }
        throw e;
      }
    });
  }

  // ============================================================
  // 消息操作
  // ============================================================

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

      // 创建并写入新节点
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
      await this.writeJson(this.getNodePath(sessionId, newNodeId), newNode);

      // 更新父节点
      await this.appendToParentChildren(sessionId, parentId, newNodeId);

      // 自动更新 title/summary
      if (role === 'user') {
        await this.autoUpdateTitleAndSummary(nodeId, manifest, content);
      }

      // 更新 manifest
      manifest.current_head = newNodeId;
      manifest.branches[manifest.current_branch] = newNodeId;
      manifest.updated_at = now;
      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

      return newNodeId;
    });
  }

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
      if (!node) return;

      let hasChanges = false;

      if (updates.content !== undefined && updates.content !== node.content) {
        node.content = updates.content;
        hasChanges = true;
      }

      if (updates.status !== undefined && updates.status !== node.status) {
        node.status = updates.status;
        hasChanges = true;
      }

      if (updates.meta) {
        node.meta = { ...node.meta, ...updates.meta };
        hasChanges = true;
      }

      if (hasChanges) {
        await this.writeJson(path, node);
      }
    });
  }

  async deleteMessage(
    nodeId: string,
    sessionId: string,
    messageNodeId: string
  ): Promise<void> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      await this.deleteMessageInternal(nodeId, sessionId, messageNodeId);
    });
  }

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
      const parentUpdates = new Map<string, Set<string>>();

      // 收集所有需要删除的节点
      for (const messageNodeId of messageNodeIds) {
        const messageNode = await this.readJson<ChatNode>(
          this.getNodePath(sessionId, messageNodeId)
        );
        if (!messageNode || messageNode.status === 'deleted') continue;

        if (messageNode.parent_id) {
          if (!parentUpdates.has(messageNode.parent_id)) {
            parentUpdates.set(messageNode.parent_id, new Set());
          }
          parentUpdates.get(messageNode.parent_id)!.add(messageNodeId);
        }

        await this.collectDescendantIds(sessionId, messageNodeId, deletedNodeIds);
      }

      if (deletedNodeIds.size === 0) return;

      // 批量软删除
      for (const deletedId of deletedNodeIds) {
        const path = this.getNodePath(sessionId, deletedId);
        const node = await this.readJson<ChatNode>(path);
        if (node && node.status !== 'deleted') {
          node.status = 'deleted';
          await this.writeJson(path, node);
        }
      }

      // 批量更新父节点
      for (const [parentId, childIdsToRemove] of parentUpdates) {
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

      // 一次性修复 manifest
      await this.repairManifestAfterBatchDelete(nodeId, sessionId, deletedNodeIds);
    });
  }

  // ============================================================
  // 编辑消息
  // ============================================================

  async editMessage(
    nodeId: string,
    sessionId: string,
    originalNodeId: string,
    newContent: string
  ): Promise<string> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const manifest = await this.getManifest(nodeId);
      const originalNode = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, originalNodeId)
      );
      if (!originalNode) throw new Error("Original node not found");

      const newNodeId = generateUUID();
      const now = new Date().toISOString();

      const newNode: ChatNode = {
        ...originalNode,
        id: newNodeId,
        content: newContent,
        created_at: now,
        children_ids: []
      };

      await this.writeJson(this.getNodePath(sessionId, newNodeId), newNode);
      await this.appendToParentChildren(sessionId, newNode.parent_id, newNodeId);

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
      const manifest = await this.getManifest(nodeId);
      const sourceNode = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, sourceMessageId)
      );
      if (!sourceNode) throw new Error(`Source node not found: ${sourceMessageId}`);

      const newNodeId = generateUUID();
      const now = new Date().toISOString();

      const branchMeta = {
        branchMetadata: {
          branchName: options?.name,
          createdFrom: options?.createdFrom || 'manual',
          createdAt: now,
        }
      };

      const newNode = this.buildBranchNode(
        sourceNode, newNodeId, now, branchMeta, options
      );

      await this.writeJson(this.getNodePath(sessionId, newNodeId), newNode);

      // 更新父节点的 children_ids
      const parentId = newNode.parent_id;
      if (parentId) {
        if (parentId === sourceMessageId) {
          // assistant 场景：新节点挂在 sourceNode 下
          if (!sourceNode.children_ids.includes(newNodeId)) {
            sourceNode.children_ids.push(newNodeId);
            await this.writeJson(
              this.getNodePath(sessionId, sourceMessageId),
              sourceNode
            );
          }
        } else {
          // user/system 场景：新节点与 sourceNode 并列
          await this.appendToParentChildren(sessionId, parentId, newNodeId);
        }
      }

      // 更新 manifest
      manifest.current_head = newNodeId;
      manifest.branches[manifest.current_branch] = newNodeId;
      manifest.updated_at = now;
      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

      return newNodeId;
    });
  }

  /**
   * 根据源节点角色构建分支节点
   */
  private buildBranchNode(
    sourceNode: ChatNode,
    newNodeId: string,
    now: string,
    branchMeta: Record<string, any>,
    options?: { copyContent?: boolean }
  ): ChatNode {
    if (sourceNode.role === 'assistant') {
      // Assistant：创建子用户节点（下一轮分支入口）
      return {
        id: newNodeId,
        type: 'message',
        role: 'user',
        content: '',
        created_at: now,
        parent_id: sourceNode.id, // 挂在 assistant 下
        children_ids: [],
        status: 'active',
        meta: branchMeta,
      };
    }

    // User / System：创建并列兄弟节点
    return {
      id: newNodeId,
      type: 'message',
      role: sourceNode.role === 'user' ? 'user' : sourceNode.role,
      content: options?.copyContent ? sourceNode.content : '',
      created_at: now,
      parent_id: sourceNode.parent_id, // 与源节点并列
      children_ids: [],
      status: 'active',
      meta: {
        ...branchMeta,
        ...(options?.copyContent && sourceNode.role === 'user'
          ? { files: sourceNode.meta?.files }
          : {}
        ),
      },
    };
  }

  async getBranchTree(
    sessionId: string,
    nodeId: string,
    rootNodeId?: string
  ): Promise<BranchTreeNode> {
    const manifest = await this.getManifest(nodeId);
    const root = rootNodeId || manifest.root_id;
    return this.buildBranchTreeRecursive(sessionId, root, manifest.current_head);
  }

  private async buildBranchTreeRecursive(
    sessionId: string,
    nodeId: string,
    activeNodeId: string
  ): Promise<BranchTreeNode> {
    const node = await this.readJson<ChatNode>(this.getNodePath(sessionId, nodeId));
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const children: BranchTreeNode[] = [];
    for (const childId of node.children_ids) {
      const childNode = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, childId)
      );
      if (!childNode || childNode.status === 'deleted') continue;

      try {
        children.push(
          await this.buildBranchTreeRecursive(sessionId, childId, activeNodeId)
        );
      } catch (e) {
        log.warn('Failed to build branch tree child', { childId, error: e });
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

  async renameBranch(sessionId: string, nodeId: string, newName: string): Promise<void> {
    return this.lockManager.acquire(`node:${sessionId}:${nodeId}`, async () => {
      const path = this.getNodePath(sessionId, nodeId);
      const node = await this.readJson<ChatNode>(path);
      if (!node) throw new Error('Node not found');

      if (!node.meta) node.meta = {};
      if (!node.meta.branchMetadata) node.meta.branchMetadata = {};
      node.meta.branchMetadata.branchName = newName;

      await this.writeJson(path, node);
    });
  }

  async deleteBranch(
    nodeId: string,
    sessionId: string,
    messageNodeId: string,
    options?: { cascade?: boolean }
  ): Promise<string[]> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const targetNode = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, messageNodeId)
      );
      if (!targetNode) return [];

      const deletedIds: string[] = [];

      const deleteRecursive = async (id: string): Promise<void> => {
        const node = await this.readJson<ChatNode>(this.getNodePath(sessionId, id));
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

      if (targetNode.parent_id) {
        await this.removeFromParentChildren(
          sessionId, targetNode.parent_id, messageNodeId
        );
      }

      await this.repairManifestAfterDelete(nodeId, sessionId, messageNodeId, targetNode);

      return deletedIds;
    });
  }

  async switchBranch(nodeId: string, sessionId: string, branchName: string): Promise<void> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const manifest = await this.getManifest(nodeId);
      if (!manifest.branches[branchName]) throw new Error("Branch not found");

      manifest.current_branch = branchName;
      manifest.current_head = manifest.branches[branchName];
      manifest.updated_at = new Date().toISOString();

      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
    });
  }

  async getNodeSiblings(sessionId: string, nodeId: string): Promise<ChatNode[]> {
    const node = await this.readJson<ChatNode>(this.getNodePath(sessionId, nodeId));
    if (!node || !node.parent_id) return node ? [node] : [];

    const parent = await this.readJson<ChatNode>(
      this.getNodePath(sessionId, node.parent_id)
    );
    if (!parent) return [node];

    const siblings = await Promise.all(
      parent.children_ids.map(id =>
        this.readJson<ChatNode>(this.getNodePath(sessionId, id))
      )
    );

    return siblings.filter(
      (n): n is ChatNode => n !== null && n.status === 'active'
    );
  }

  // ============================================================
  // ID 转换
  // ============================================================

  async getSessionIdFromNodeId(nodeId: string): Promise<string | null> {
    try {
      const manifest = await this.getManifest(nodeId);
      return manifest.id || null;
    } catch {
      return null;
    }
  }

  // ============================================================
  // Manifest 维护
  // ============================================================

  async updateManifestHead(
    nodeId: string,
    sessionId: string,
    targetNodeId: string
  ): Promise<void> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const manifest = await this.getManifest(nodeId);

      manifest.current_head = targetNodeId;
      manifest.branches[manifest.current_branch] = targetNodeId;
      manifest.updated_at = new Date().toISOString();

      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
    });
  }

  async validateManifest(nodeId: string, sessionId: string): Promise<boolean> {
    try {
      const io = this.getManifestIO();
      const { repaired } = await repairManifest(
        io,
        nodeId,
        async (id) => {
          const node = await this.readJson<ChatNode>(
            this.getNodePath(sessionId, id)
          );
          return !node || node.status === 'deleted';
        },
        async (_invalidId, manifest) => manifest.root_id
      );
      return repaired;
    } catch (e) {
      log.error('Manifest validation failed', { sessionId, nodeId, error: e });
      return false;
    }
  }

  // ============================================================
  // ISessionEngine 文件操作
  // ============================================================

  async loadTree(): Promise<EngineNode[]> {
    const allNodes = await this.engine.loadTree();
    return allNodes.filter((node: EngineNode) => {
      if (node.name.startsWith('.')) return false;
      if (node.type === 'file') return node.name.endsWith('.chat');
      if (node.type === 'directory') return true;
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

    const { sessionId, manifest } = await this.createSessionStructure(
      generateUUID(), availableName, "You are a helpful assistant."
    );

    const node = await this.engine.createFile(
      `${availableName}.chat`,
      parentId,
      JSON.stringify(manifest, null, 2),
      { title: availableName, icon: '💬', sessionId }
    );

    this.notify();
    return node;
  }

  private async findAvailableFileName(
    baseName: string,
    parentId: string | null
  ): Promise<string> {
    const existingNames = new Set<string>();

    try {
      const children = parentId
        ? await this.engine.getChildren(parentId)
        : (await this.engine.loadTree()).filter(n => !n.parentId);

      children.forEach(child => {
        if (child.name.endsWith('.chat')) {
          existingNames.add(child.name.replace(/\.chat$/i, '').toLowerCase());
        }
      });
    } catch {
      // 继续执行，假设没有冲突
    }

    if (!existingNames.has(baseName.toLowerCase())) return baseName;

    for (let i = 1; i <= 100; i++) {
      const numberedName = `${baseName} (${i})`;
      if (!existingNames.has(numberedName.toLowerCase())) return numberedName;
    }

    return `${baseName}_${generateUUID().substring(0, 8)}`;
  }

  async rename(id: string, newName: string): Promise<void> {
    const node = await this.vfs.getNodeById(id);
    if (!node) throw new Error("Node not found");

    try {
      const manifest = await this.getManifest(id);
      manifest.title = newName;
      manifest.updated_at = new Date().toISOString();
      await this.engine.writeContent(id, JSON.stringify(manifest, null, 2));
    } catch {
      // ignore
    }

    await this.engine.updateMetadata(id, { ...node.metadata, title: newName });
  }

  async delete(ids: string[]): Promise<void> {
    // 先执行逻辑清理
    for (const id of ids) {
      await this.cleanupNodeRecursively(id);
    }

    // 再执行物理删除
    await this.engine.delete(ids);
    this.notify();
  }

  /**
   * 递归清理节点关联的会话数据
   */
  private async cleanupNodeRecursively(nodeId: string): Promise<void> {
    const node = await this.vfs.getNodeById(nodeId);
    if (!node) return;

    if (node.type === VNodeType.DIRECTORY) {
      const children = await this.engine.getChildren(nodeId);
      for (const child of children) {
        await this.cleanupNodeRecursively(child.id);
      }
    } else if (node.type === VNodeType.FILE && node.name.endsWith('.chat')) {
      await this.cleanupChatFile(nodeId);
    }
  }

  /**
   * 清理单个 .chat 文件的关联数据
   */
  private async cleanupChatFile(nodeId: string): Promise<void> {
    try {
      const content = await this.engine.readContent(nodeId);
      if (!content) return;

      const str = typeof content === 'string'
        ? content
        : new TextDecoder().decode(content);
      const manifest = JSON.parse(str) as ChatManifest;

      if (!manifest.id) return;

      log.info('Cleaning up session data', {
        sessionId: manifest.id,
        title: manifest.title
      });

      // 修复无效引用后再删除隐藏目录
      const io = this.getManifestIO();
      await repairManifest(
        io, nodeId,
        async (id) => {
          const n = await this.readJson<ChatNode>(
            this.getNodePath(manifest.id, id)
          );
          return !n;
        },
        async (_id, m) => m.root_id
      );

      const hiddenDirPath = this.getHiddenDir(manifest.id);
      const hiddenDirId = await this.engine.resolvePath(hiddenDirPath);
      if (hiddenDirId) {
        await this.engine.delete([hiddenDirId]);
      }
    } catch (e) {
      log.error('Failed to cleanup chat file', { nodeId, error: e });
    }
  }

  async search(query: EngineSearchQuery): Promise<EngineNode[]> {
    const results = await this.engine.search(query);
    return results.filter(
      (node: EngineNode) => node.type === 'file' && node.name.endsWith('.chat')
    );
  }

  // ============================================================
  // 资产操作
  // ============================================================

  async createAsset(
    ownerNodeId: string,
    filename: string,
    content: string | ArrayBuffer
  ): Promise<EngineNode> {
    return this.engine.createAsset(ownerNodeId, filename, content);
  }

  async getAssetDirectoryId(ownerNodeId: string): Promise<string | null> {
    return this.engine.getAssetDirectoryId(ownerNodeId);
  }

  async getAssets(ownerNodeId: string): Promise<EngineNode[]> {
    return this.engine.getAssets(ownerNodeId);
  }

  async readSessionAsset(sessionId: string, assetPath: string): Promise<Blob | null> {
    const cleanPath = assetPath.startsWith('./') ? assetPath.slice(2) : assetPath;
    const internalPath = `${this.getHiddenDir(sessionId)}/${cleanPath}`;

    try {
      const nodeId = await this.engine.resolvePath(internalPath);
      if (!nodeId) return null;

      const content = await this.engine.readContent(nodeId);
      if (!content) return null;

      return new Blob([content], { type: guessMimeType(cleanPath) });
    } catch {
      return null;
    }
  }

  // ============================================================
  // 代理方法（ISessionEngine 接口）
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

  async getSessionSettings(sessionId: string): Promise<ChatSessionSettings> {
    try {
      const nodeId = await this.engine.resolvePath(this.getSettingsPath(sessionId));
      if (!nodeId) return { ...DEFAULT_SESSION_SETTINGS };

      const content = await this.engine.readContent(nodeId);
      if (!content) return { ...DEFAULT_SESSION_SETTINGS };

      const yamlStr = typeof content === 'string'
        ? content
        : new TextDecoder().decode(content);

      return {
        ...DEFAULT_SESSION_SETTINGS,
        ...YAML.parse(yamlStr),
      };
    } catch {
      return { ...DEFAULT_SESSION_SETTINGS };
    }
  }

  async saveSessionSettings(
    sessionId: string,
    settings: Partial<ChatSessionSettings>
  ): Promise<void> {
    return this.lockManager.acquire(`settings:${sessionId}`, async () => {
      const path = this.getSettingsPath(sessionId);

      let current: ChatSessionSettings;
      try {
        current = await this.getSessionSettings(sessionId);
      } catch {
        current = { ...DEFAULT_SESSION_SETTINGS };
      }

      const merged: ChatSessionSettings = {
        ...current,
        ...settings,
        version: '1.0',
        updatedAt: new Date().toISOString(),
      };

      const yamlContent = YAML.stringify(merged, { indent: 2, lineWidth: 0 });

      const nodeId = await this.engine.resolvePath(path);
      if (nodeId) {
        await this.engine.writeContent(nodeId, yamlContent);
      } else {
        const hiddenDir = this.getHiddenDir(sessionId);
        const hiddenDirId = await this.engine.resolvePath(hiddenDir);
        if (!hiddenDirId) {
          await this.engine.createDirectory(hiddenDir, null);
        }

        await this.engine.createFile(
          'settings.yaml', hiddenDir, yamlContent, { type: 'settings' }
        );
      }
    });
  }
}
