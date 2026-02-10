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
} from './types';
import { LockManager } from '../utils/LockManager';
import { ChatSessionSettings, DEFAULT_SESSION_SETTINGS } from '../core/types';

// 调试日志
const DEBUG = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
const log = (...args: any[]) => DEBUG && console.log('[LLMSessionEngine]', ...args);

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
    log('Initialized');
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

    log(`createSession: title="${title}", sessionId=${sessionId}`);

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
          log(`Manifest JSON parse failed, will reinitialize:`, parseError);
          return await this.createNewSessionStructure(nodeId, title, systemPrompt);
        }

        // 验证 manifest 结构完整性
        if (!this.isValidManifest(manifest)) {
          log(`Invalid manifest structure, will reinitialize`);
          return await this.createNewSessionStructure(nodeId, title, systemPrompt);
        }

        // 检查隐藏目录和根节点
        const hiddenDirPath = this.getHiddenDir(manifest.id);
        const hiddenDirId = await this.engine.resolvePath(hiddenDirPath);

        if (!hiddenDirId) {
          log(`Hidden directory missing for session ${manifest.id}, rebuilding...`);
          return await this.rebuildSessionStructure(nodeId, manifest, systemPrompt);
        }

        // 检查根节点
        const rootNodePath = this.getNodePath(manifest.id, manifest.root_id);
        const rootNode = await this.readJson<ChatNode>(rootNodePath);

        if (!rootNode) {
          log(`Root node missing, rebuilding session structure`);
          return await this.rebuildSessionStructure(nodeId, manifest, systemPrompt);
        }

        log(`Existing valid session found: ${manifest.id}`);
        return manifest.id;
      }
    } catch (e) {
      log(`Failed to read/validate existing content, will create new:`, e);
    }

    // 文件为空或完全损坏，创建新结构
    return await this.createNewSessionStructure(nodeId, title, systemPrompt);
  }

  /**
   * ✅ 新增：验证 manifest 结构
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
   * ✅ 新增：创建新的会话结构
   */
  private async createNewSessionStructure(
    nodeId: string,
    title: string,
    systemPrompt: string
  ): Promise<string> {
    const sessionId = generateUUID();
    const now = new Date().toISOString();

    log(`Creating new session structure: nodeId=${nodeId}, sessionId=${sessionId}`);

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
   * ✅ 新增：重建会话结构（保留 manifest ID，重建隐藏目录）
   */
  private async rebuildSessionStructure(
    nodeId: string,
    oldManifest: ChatManifest,
    systemPrompt: string
  ): Promise<string> {
    const sessionId = oldManifest.id;
    const now = new Date().toISOString();

    log(`Rebuilding session structure: sessionId=${sessionId}`);

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
   * ✅ 新增：读取 UI 状态
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
   * ✅ 新增：更新 UI 状态（增量合并）
   */
  async updateUIState(
    nodeId: string,
    updates: Partial<NonNullable<ChatManifest['ui_state']>>
  ): Promise<void> {
    return this.lockManager.acquire(`uistate:${nodeId}`, async () => {
      try {
        const manifest = await this.getManifest(nodeId);

        // 增量合并
        manifest.ui_state = {
          ...manifest.ui_state,
          ...updates,
          // 对于 collapse_states，需要深度合并
          collapse_states: {
            ...manifest.ui_state?.collapse_states,
            ...updates.collapse_states
          }
        };

        manifest.updated_at = new Date().toISOString();

        await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
      } catch (e: any) {
        // ✨ 优雅处理节点不存在
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
    meta: any = {}
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
        }

        if (needMetaUpdate) {
          try {
            await this.engine.updateMetadata(nodeId, metaUpdates);
          } catch (e) {
            console.warn(`[LLMSessionEngine] Failed to update metadata for ${nodeId}`, e);
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
    updates: Partial<Pick<ChatNode, 'content' | 'meta' | 'status'>>
  ): Promise<void> {
    return this.lockManager.acquire(`node:${sessionId}:${nodeId}`, async () => {
      const path = this.getNodePath(sessionId, nodeId);
      const node = await this.readJson<ChatNode>(path);

      if (!node) {
        console.warn(`[LLMSessionEngine] Node ${nodeId} not found, skipping update`);
        return;
      }

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

  /**
   * 删除消息（软删除）
   */
  async deleteMessage(sessionId: string, nodeId: string): Promise<void> {
    const path = this.getNodePath(sessionId, nodeId);
    const node = await this.readJson<ChatNode>(path);
    if (node) {
      node.status = 'deleted';
      await this.writeJson(path, node);
    }
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
  /* ✅ 新增：创建新分支
  * @param nodeId VFS 节点 ID
  * @param sessionId 会话 ID
  * @param sourceMessageId 源消息 ID
  * @param options 分支选项
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
      const manifest = await this.getManifest(nodeId);
      const sourceNode = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, sourceMessageId)
      );

      if (!sourceNode) {
        throw new Error('Source node not found');
      }

      // 生成新节点 ID
      const newNodeId = generateUUID();
      const now = new Date().toISOString();

      // 创建新节点（复制源节点）
      const newNode: ChatNode = {
        ...sourceNode,
        id: newNodeId,
        created_at: now,
        children_ids: [],
        meta: {
          ...sourceNode.meta,
          branchMetadata: {
            branchName: options?.name,
            createdFrom: options?.createdFrom || 'manual',
            createdAt: now
          }
        }
      };

      // 如果不复制内容，清空
      if (!options?.copyContent) {
        newNode.content = '';
      }

      // 写入新节点
      await this.writeJson(this.getNodePath(sessionId, newNodeId), newNode);

      // 更新父节点的 children_ids
      if (sourceNode.parent_id) {
        const parent = await this.readJson<ChatNode>(
          this.getNodePath(sessionId, sourceNode.parent_id)
        );
        if (parent) {
          if (!parent.children_ids.includes(newNodeId)) {
            parent.children_ids.push(newNodeId);
            await this.writeJson(
              this.getNodePath(sessionId, sourceNode.parent_id),
              parent
            );
          }
        }
      }

      // 更新 Manifest（切换到新分支）
      manifest.current_head = newNodeId;
      manifest.branches[manifest.current_branch] = newNodeId;
      manifest.updated_at = now;

      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

      return newNodeId;
    });
  }

  /**
   * ✅ 新增：获取分支树
   * @param sessionId 会话 ID
* @param nodeId VFS 节点 ID（.chat 文件的 ID）
   * @param rootNodeId 根节点 ID（可选，默认从 manifest 获取）
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
   * 递归构建分支树
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
      const childNode = await this.buildBranchTreeRecursive(
        sessionId,
        childId,
        activeNodeId
      );
      children.push(childNode);
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
   * ✅ 新增：重命名分支
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
   * ✅ 新增：删除分支（级联删除子节点）
   */
  async deleteBranch(
    sessionId: string,
    nodeId: string,
    options?: { cascade?: boolean }
  ): Promise<string[]> {
    const deletedIds: string[] = [];

    const deleteRecursive = async (id: string) => {
      const node = await this.readJson<ChatNode>(
        this.getNodePath(sessionId, id)
      );

      if (!node) return;

      // 如果启用级联删除，递归删除子节点
      if (options?.cascade && node.children_ids.length > 0) {
        for (const childId of node.children_ids) {
          await deleteRecursive(childId);
        }
      }

      // 软删除节点
      node.status = 'deleted';
      await this.writeJson(this.getNodePath(sessionId, id), node);
      deletedIds.push(id);
    };

    await deleteRecursive(nodeId);

    return deletedIds;
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

  /**
   * 从 VFS nodeId 获取 sessionId
   */
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

  /**
   * 加载文件树
   */
  async loadTree(): Promise<EngineNode[]> {
    const allNodes = await this.engine.loadTree();

    return allNodes.filter((node: EngineNode) => {
      // 1. 总是排除以 . 开头的隐藏文件/文件夹 (系统数据)
      if (node.name.startsWith('.')) return false;

      // 2. 如果是文件，只保留 .chat
      if (node.type === 'file') {
        return node.name.endsWith('.chat');
      }

      // 3. 如果是目录，保留（用于分类）
      if (node.type === 'directory') {
        return true;
      }

      return false;
    });
  }

  /**
   * 创建目录
   */
  async createDirectory(name: string, parentId: string | null): Promise<EngineNode> {
    return this.engine.createDirectory(name, parentId);
  }

  /**
   * 创建文件 - 供 VFS UI 创建新文件时调用
   */
  async createFile(
    name: string,
    parentId: string | null,
    _content?: string | ArrayBuffer
  ): Promise<EngineNode> {
    const baseName = (name || "New Chat").replace(/\.chat$/i, '');

    log(`createFile: name="${name}", baseName="${baseName}"`);

    // 1. 查找可用的文件名
    const availableName = await this.findAvailableFileName(baseName, parentId);

    // 2. 生成 sessionId
    const sessionId = generateUUID();
    const now = new Date().toISOString();

    // 3. 创建隐藏数据目录（带冲突处理）
    try {
      await this.engine.createDirectory(this.getHiddenDir(sessionId), null);
    } catch (e: any) {
      // 如果目录已存在（极端情况：UUID 碰撞），重试
      if (e.message?.includes('exists')) {
        log(`Hidden directory already exists for ${sessionId}, this is unexpected`);
        // 可以选择清理或重新生成 UUID
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
      log(`Failed to list existing files:`, e);
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
        log(`File name conflict resolved: "${baseName}" -> "${numberedName}"`);
        return numberedName;
      }
    }

    // 超过最大尝试次数，使用 UUID 后缀
    const fallbackName = `${baseName}_${generateUUID().substring(0, 8)}`;
    log(`File name conflict: max attempts exceeded, using fallback: "${fallbackName}"`);
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
    // 定义递归清理函数
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
              // ✅ 新增：清理 manifest 中的节点引用
              await this.cleanupManifestReferences(nodeId, manifest);
              // 删除对应的隐藏数据目录
              const hiddenDirPath = this.getHiddenDir(manifest.id);
              const hiddenDirId = await this.engine.resolvePath(hiddenDirPath);
              if (hiddenDirId) {
                await this.engine.delete([hiddenDirId]);
                log(`Cleaned up hidden data for session ${manifest.id}`);
              }
            }
          }
        } catch (e) {
          console.warn(`[LLMSessionEngine] Failed to cleanup data for ${node.name}`, e);
        }
      }
    };

    // 1. 先执行逻辑清理 (删除 Hidden Data)
    for (const id of ids) {
      await cleanupRecursively(id);
    }

    // 2. 再执行物理删除 (删除 VFS 节点)
    await this.engine.delete(ids);

    this.notify();
  }

  /**
   * ✅ 新增：清理 manifest 中的无效引用
   */
  private async cleanupManifestReferences(
    nodeId: string,
    manifest: ChatManifest
  ): Promise<void> {
    let needsUpdate = false;

    // 1. 检查 current_head 是否存在
    const currentHeadPath = this.getNodePath(manifest.id, manifest.current_head);
    const currentHeadExists = await this.readJson<ChatNode>(currentHeadPath);

    if (!currentHeadExists) {
      // current_head 不存在，回退到 root_id
      manifest.current_head = manifest.root_id;
      manifest.branches[manifest.current_branch] = manifest.root_id;
      needsUpdate = true;
      log(`Reset current_head to root for session ${manifest.id}`);
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
        } else {
          // 如果是其他分支，删除该分支
          delete manifest.branches[branchName];
        }
        needsUpdate = true;
        log(`Cleaned up invalid branch "${branchName}" for session ${manifest.id}`);
      }
    }

    // 3. 如果有变更，更新 manifest
    if (needsUpdate) {
      manifest.updated_at = new Date().toISOString();
      await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
      log(`Updated manifest for session ${manifest.id}`);
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
  // ✅ 新增：会话设置管理 (YAML)
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

      // 合并默认值
      return {
        ...DEFAULT_SESSION_SETTINGS,
        ...parsed,
      };

    } catch (e) {
      console.warn('[LLMSessionEngine] Failed to load session settings:', e);
      return { ...DEFAULT_SESSION_SETTINGS };
    }
  }

  /**
   * 保存会话设置
   */
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

      log(`Session settings saved for ${sessionId}`);
    });
  }

  /**
   * ✅ 新增：获取 Agent 对应的可用模型
   */
  async getAvailableModelsForAgent(_agentId: string): Promise<Array<{
    id: string;
    name: string;
    provider?: string;
  }>> {
    // 注意：这个方法需要访问 AgentService，
    // 但 SessionEngine 不应该直接依赖 AgentService
    // 因此这个方法应该在 SessionRegistry 或更上层实现
    // 这里返回空数组，实际实现在 SessionRegistry
    console.warn('[LLMSessionEngine] getAvailableModelsForAgent should be called via SessionRegistry');
    return [];
  }
}
