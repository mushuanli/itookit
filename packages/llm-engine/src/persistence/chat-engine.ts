// @file: llm-engine/src/persistence/chat-engine.ts

import YAML from 'yaml'; // 需要添加依赖: npm install yaml
import { BaseModuleService } from '@itookit/vfslib';
import type { IVFSManager } from '@itookit/common';
import type {
  FSNode,
  FSEvent,
  FSEventType,
} from '@itookit/common';
import {
  FS_MODULE_CHAT,
  generateUUID,
  guessMimeType,
  buildRenamedFilename,
} from '@itookit/common';
import {
  ChatManifest,
  ChatNode,
  ChatContextItem,
  IChatEngine,
  BranchTreeNode,
  AppendMessageMeta,
  UpdateMessageMeta
} from './types';
import { LockManager } from '../utils/LockManager';
import { ChatSessionSettings, DEFAULT_SESSION_SETTINGS } from '../core/types';
import { repairManifest, ManifestIO } from '../utils/manifest-repair';
import { log } from '../utils/logger';

// ============================================
// ChatEngine
// ============================================

/**
 * LLM 会话引擎
 * 继承 BaseModuleService，通过 engine 访问文件系统
 * 实现 IChatEngine 接口
 *
 * 存储布局（asset dir 模式）：
 *   my-session.chat            ← ChatManifest JSON
 *   _my-session.chat/          ← asset dir (VFS-managed, non-hidden)
 *     000_00000_s.chat         ← root/system node
 *     000_00001_u.chat         ← user message
 *     000_00002_a.chat         ← assistant message
 *     settings.yaml            ← session settings
 */
export class ChatEngine extends BaseModuleService implements IChatEngine {
  private lockManager = new LockManager();
  /** sessionId → chatFileId (VFS node ID of the .chat file) */
  private chatFileIds = new Map<string, string>();
  /** chatFileId → module-relative asset dir path (invalidated on rename/move/delete) */
  private assetDirPaths = new Map<string, string>();

  constructor(vfs: IVFSManager) {
    super(FS_MODULE_CHAT, { description: 'Chat Sessions' }, vfs);
  }

  // ── v3.3: IModuleFS 兼容层（委托给内部 this.engine） ──────

  /** 文件操作驱动（POSIX CRUD + 搜索 + 事件） */
  get driver() { return this.engine.driver; }
  /** 扩展元信息驱动（assetdir / tags / seqfile / refs） */
  get meta() { return this.engine.meta; }
  get moduleId() { return this.engine.moduleId; }
  get capabilities() { return this.engine.capabilities; }
  openFile(nodeId: string) { return this.engine.openFile(nodeId); }

  protected async onLoad(): Promise<void> {}

  // ============================================================
  // 路径辅助
  // ============================================================

  /**
   * Derive the asset dir module-relative path from the chat file node ID.
   * e.g. /folder/my-session.chat → /folder/_my-session.chat
   */
  private async getAssetDirPath(chatFileId: string): Promise<string> {
    const cached = this.assetDirPaths.get(chatFileId);
    if (cached) return cached;
    const node = await this.engine.driver.getNode(chatFileId);
    if (!node || !node.path) throw new Error(`Chat file not found: ${chatFileId}`);
    const lastSlash = node.path.lastIndexOf('/');
    const dir = node.path.substring(0, lastSlash);
    const filename = node.path.substring(lastSlash + 1);
    const path = dir ? `${dir}/_${filename}` : `/_${filename}`;
    this.assetDirPaths.set(chatFileId, path);
    return path;
  }

  /**
   * Generate structured node ID: `${pad3(branchNum)}_${pad5(sn)}_${roleChar}`
   */
  private makeNodeId(branchNum: number, sn: number, role: ChatNode['role']): string {
    const roleChars: Record<ChatNode['role'], string> = {
      user: 'u', assistant: 'a', system: 's', tool: 't'
    };
    const b = String(branchNum).padStart(3, '0');
    const s = String(sn).padStart(5, '0');
    return `${b}_${s}_${roleChars[role] ?? 'u'}`;
  }

  /** Allocate next global sequence number from manifest (mutates manifest.next_sn) */
  private allocateSn(manifest: ChatManifest): number {
    if (manifest.next_sn === undefined) manifest.next_sn = 1;
    return manifest.next_sn++;
  }

  /** Allocate next branch number from manifest (mutates manifest.next_branch_num) */
  private allocateBranchNum(manifest: ChatManifest): number {
    if (manifest.next_branch_num === undefined) manifest.next_branch_num = 1;
    return manifest.next_branch_num++;
  }

  /**
   * Resolve chatFileId from sessionId.
   * Checks chatFileIds cache first (O(1)), falls back to full tree scan.
   */
  private async resolveChatFileId(sessionId: string): Promise<string | null> {
    const cached = this.chatFileIds.get(sessionId);
    if (cached) return cached;

    const tree = await this.engine.driver.getChildren('/');
    const allFiles = await this.collectAllFileNodes(tree);

    for (const node of allFiles) {
      if (!this.isChatFile(node.name)) continue;
      try {
        const manifest = await this.getManifest(node.path); // also populates cache
        if (manifest.id === sessionId) return node.path;
      } catch { continue; }
    }
    return null;
  }

  /**
   * Returns true if the filename should be treated as a .chat session file.
   * Accepts:
   *   - "session.chat"            ← canonical
   *   - "Claudecode 讲解"         ← missing extension (lost via external rename or LocalFS bug)
   *
   * Rejects:
   *   - "notes.md" / "image.png" ← real other-type files with a different extension
   */
  private isChatFile(name: string): boolean {
    if (name.endsWith('.chat')) return true;
    // If the name has NO extension at all (no '.'), treat it as a chat file
    // whose extension was accidentally stripped.
    return !name.includes('.');
  }

  private async collectAllFileNodes(nodes: FSNode[]): Promise<FSNode[]> {
    const result: FSNode[] = [];
    for (const node of nodes) {
      if (node.type === 'file') {
        result.push(node);
      } else if (node.type === 'directory') {
        try {
          const children = await this.engine.driver.getChildren(node.path) as FSNode[];
          result.push(...await this.collectAllFileNodes(children));
        } catch { /* ignore */ }
      }
    }
    return result;
  }

  // ============================================================
  // ManifestIO 适配器（供 repairManifest 使用）
  // ============================================================

  private getManifestIO(): ManifestIO {
    return {
      getManifest: (nodeId) => this.getManifest(nodeId),
      writeManifest: async (nodeId, manifest) => {
        await this.engine.driver.writeContent(nodeId, JSON.stringify(manifest, null, 2));
      }
    };
  }

  // ============================================================
  // 会话结构创建（统一入口）
  // ============================================================

  /**
   * Create session data structures: root node in asset dir + manifest in .chat file.
   * Takes chatFileId (the .chat file's VFS node ID) and generates sessionId internally.
   */
  private async createSessionStructure(
    chatFileId: string,
    title: string,
    systemPrompt: string
  ): Promise<{ sessionId: string; rootNodeId: string; manifest: ChatManifest }> {
    const sessionId = generateUUID();
    const now = new Date().toISOString();
    const rootNodeId = this.makeNodeId(0, 0, 'system'); // '000_00000_s'

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
    await this.engine.meta.assets.putAsset(chatFileId, `${rootNodeId}.chat`, JSON.stringify(rootNode));

    const manifest: ChatManifest = {
      version: '1.0',
      id: sessionId,
      title,
      created_at: now,
      updated_at: now,
      settings: { model: '' },
      branches: { main: rootNodeId },
      current_branch: 'main',
      current_head: rootNodeId,
      root_id: rootNodeId,
      chat_node_id: chatFileId,
      next_sn: 1,
      next_branch_num: 1,
      branch_nums: { main: 0 },
    };

    await this.engine.driver.writeContent(chatFileId, JSON.stringify(manifest, null, 2));
    this.chatFileIds.set(sessionId, chatFileId);

    return { sessionId, rootNodeId, manifest };
  }

  // ============================================================
  // 上下文遍历（统一入口）
  // ============================================================

  /**
   * 从指定节点向上遍历 parent 链，构建有序上下文
   */
  private async buildContextChain(
    assetDir: string,
    headNodeId: string
  ): Promise<ChatContextItem[]> {
    const nodes: ChatNode[] = [];
    let currentNodeId: string | null = headNodeId;
    const visited = new Set<string>();

    while (currentNodeId) {
      if (visited.has(currentNodeId)) {
        log.warn('Circular reference detected', { nodeId: currentNodeId });
        break;
      }
      visited.add(currentNodeId);

      const chatNode: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${currentNodeId}.chat`);
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

  private async appendToParentChildren(
    assetDir: string,
    parentId: string | null,
    childId: string
  ): Promise<void> {
    if (!parentId) return;
    const parentNode: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${parentId}.chat`);
    if (!parentNode) return;
    if (!parentNode.children_ids) parentNode.children_ids = [];
    parentNode.children_ids.push(childId);
    await this.writeJson(`${assetDir}/${parentId}.chat`, parentNode);
  }

  private async removeFromParentChildren(
    assetDir: string,
    parentId: string,
    childId: string
  ): Promise<void> {
    const nodePath = `${assetDir}/${parentId}.chat`;
    const parentNode: ChatNode | null = await this.readJson<ChatNode>(nodePath);
    if (!parentNode) return;

    const index = parentNode.children_ids.indexOf(childId);
    if (index !== -1) {
      parentNode.children_ids.splice(index, 1);
      await this.writeJson(nodePath, parentNode);
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

    if (!manifest.summary || manifest.summary === 'New conversation') {
      manifest.summary = content.substring(0, 100).replace(/[\r\n]+/g, ' ').trim();
    }

    const defaultTitles = new Set(['New Chat', 'Untitled', 'New conversation']);
    if (defaultTitles.has(manifest.title)) {
      const newTitle = content.substring(0, 30).replace(/[\r\n]+/g, ' ').trim() || 'Chat';
      manifest.title = newTitle;
      metaUpdates.title = newTitle;
    }

    if (Object.keys(metaUpdates).length > 0) {
      try {
        await this.engine.driver.updateMetadata(nodeId, metaUpdates);
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
      const content = await this.engine.driver.readContent(nodeId);
      if (!content) return null;

      const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
      if (!str) return null;

      const parsed = JSON.parse(str);
      const valid = this.isValidManifest(parsed);
      if (!valid) log.warn('Manifest parsed but failed structure check', { nodeId });
      return valid ? parsed : null;
    } catch {
      return null;
    }
  }

  private async isSessionStructureIntact(chatFileId: string, manifest: ChatManifest): Promise<boolean> {
    const assetDirPath = await this.engine.meta.assets.getAssetDirPath(chatFileId);
    if (!assetDirPath) return false;

    const assetDir = await this.getAssetDirPath(chatFileId);
    const rootPath = `${assetDir}/${manifest.root_id}.chat`;
    const rootNode = await this.readJson<ChatNode>(rootPath);
    // If the root node file exists (assetDirId found) but can't be parsed,
    // treat as intact — unreadable != absent. Rebuild would wipe all nodes.
    if (!rootNode) {
      return this.engine.driver.exists(rootPath);
    }
    return rootNode.status !== 'deleted';
  }

  // ============================================================
  // 删除辅助
  // ============================================================

  private async softDeleteRecursive(assetDir: string, nodeId: string): Promise<number> {
    const nodePath = `${assetDir}/${nodeId}.chat`;
    const node: ChatNode | null = await this.readJson<ChatNode>(nodePath);
    if (!node || node.status === 'deleted') return 0;

    let count = 0;
    for (const childId of node.children_ids) {
      count += await this.softDeleteRecursive(assetDir, childId);
    }

    node.status = 'deleted';
    await this.writeJson(nodePath, node);
    return count + 1;
  }

  private async collectDescendantIds(
    assetDir: string,
    nodeId: string,
    collected: Set<string>
  ): Promise<void> {
    if (collected.has(nodeId)) return;

    const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${nodeId}.chat`);
    if (!node || node.status === 'deleted') return;

    collected.add(nodeId);
    for (const childId of node.children_ids) {
      await this.collectDescendantIds(assetDir, childId, collected);
    }
  }

  private async findNearestActiveAncestor(
    assetDir: string,
    startNodeId: string,
    deletedNodeIds: Set<string>,
    fallbackId: string
  ): Promise<string> {
    let currentId: string | null = startNodeId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${currentId}.chat`);
      if (!node) break;

      if (node.parent_id && !deletedNodeIds.has(node.parent_id)) {
        const parentNode: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${node.parent_id}.chat`);
        if (parentNode && parentNode.status === 'active') {
          return node.parent_id;
        }
      }

      currentId = node.parent_id;
    }

    return fallbackId;
  }

  private async isNodeInDeletedSubtree(
    targetId: string,
    deletedId: string,
    assetDir: string
  ): Promise<boolean> {
    if (targetId === deletedId) return true;

    let currentId: string | null = targetId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === deletedId) return true;
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${currentId}.chat`);
      if (!node) break;
      currentId = node.parent_id;
    }

    return false;
  }

  private async repairManifestAfterDelete(
    nodeId: string,
    assetDir: string,
    deletedNodeId: string,
    deletedNode: ChatNode
  ): Promise<void> {
    const io = this.getManifestIO();

    await repairManifest(
      io,
      nodeId,
      async (id) => this.isNodeInDeletedSubtree(id, deletedNodeId, assetDir),
      async (_invalidId, manifest) => {
        const fallback = deletedNode.parent_id || manifest.root_id;
        const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${fallback}.chat`);
        return (node && node.status !== 'deleted') ? fallback : manifest.root_id;
      }
    );
  }

  private async repairManifestAfterBatchDelete(
    nodeId: string,
    assetDir: string,
    deletedNodeIds: Set<string>
  ): Promise<void> {
    const io = this.getManifestIO();

    await repairManifest(
      io,
      nodeId,
      async (id) => deletedNodeIds.has(id),
      async (invalidId, manifest) =>
        this.findNearestActiveAncestor(assetDir, invalidId, deletedNodeIds, manifest.root_id)
    );
  }

  // ============================================================
  // 内部删除实现（不获取锁，由调用方加锁）
  // ============================================================

  private async deleteMessageInternal(
    nodeId: string,
    assetDir: string,
    messageNodeId: string
  ): Promise<void> {
    const messageNode = await this.readJson<ChatNode>(`${assetDir}/${messageNodeId}.chat`);

    if (!messageNode || messageNode.status === 'deleted') return;

    await this.softDeleteRecursive(assetDir, messageNodeId);

    if (messageNode.parent_id) {
      await this.removeFromParentChildren(assetDir, messageNode.parent_id, messageNodeId);
    }

    await this.repairManifestAfterDelete(nodeId, assetDir, messageNodeId, messageNode);
  }

  // ============================================================
  // Branch 路径辅助
  // ============================================================

  private async collectAncestorIds(
    assetDir: string,
    nodeId: string,
    collected: Set<string>
  ): Promise<void> {
    let currentId: string | null = nodeId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      collected.add(currentId);

      const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${currentId}.chat`);
      if (!node) break;
      currentId = node.parent_id;
    }
  }

  private async collectExclusiveChain(
    assetDir: string,
    headNodeId: string,
    protectedNodeIds: Set<string>
  ): Promise<string[]> {
    const chain: string[] = [];
    let currentId: string | null = headNodeId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      if (protectedNodeIds.has(currentId)) break;

      chain.push(currentId);

      const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${currentId}.chat`);
      if (!node) break;
      currentId = node.parent_id;
    }
    return chain;
  }

  private async softDeleteExclusive(
    assetDir: string,
    nodeId: string,
    protectedNodeIds: Set<string>,
    deletedIds: string[]
  ): Promise<void> {
    if (protectedNodeIds.has(nodeId)) return;

    const nodePath = `${assetDir}/${nodeId}.chat`;
    const node: ChatNode | null = await this.readJson<ChatNode>(nodePath);
    if (!node || node.status === 'deleted') return;

    for (const childId of node.children_ids) {
      await this.softDeleteExclusive(assetDir, childId, protectedNodeIds, deletedIds);
    }

    node.status = 'deleted';
    await this.writeJson(nodePath, node);
    deletedIds.push(nodeId);
  }

  private async buildBranchMembership(
    assetDir: string,
    manifest: ChatManifest
  ): Promise<Map<string, Set<string>>> {
    const membership = new Map<string, Set<string>>();

    for (const [branchName, headId] of Object.entries(manifest.branches)) {
      let currentId: string | null = headId;
      const visited = new Set<string>();

      while (currentId) {
        if (visited.has(currentId)) break;
        visited.add(currentId);

        if (!membership.has(currentId)) {
          membership.set(currentId, new Set());
        }
        membership.get(currentId)!.add(branchName);

        const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${currentId}.chat`);
        if (!node) break;
        currentId = node.parent_id;
      }
    }

    return membership;
  }

  private async collectActivePathIds(
    assetDir: string,
    headNodeId: string
  ): Promise<Set<string>> {
    const pathIds = new Set<string>();
    let currentId: string | null = headNodeId;
    const visited = new Set<string>();

    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      pathIds.add(currentId);

      const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${currentId}.chat`);
      if (!node) break;
      currentId = node.parent_id;
    }
    return pathIds;
  }

  private async isNodeOnBranchPath(
    assetDir: string,
    branchHeadId: string,
    targetNodeId: string
  ): Promise<boolean> {
    let currentId: string | null = branchHeadId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === targetNodeId) return true;
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${currentId}.chat`);
      if (!node) break;
      currentId = node.parent_id;
    }
    return false;
  }

  // ============================================================
  // 自动分支名生成
  // ============================================================

  private generateBranchName(manifest: ChatManifest): string {
    const existingNames = new Set(Object.keys(manifest.branches));
    let index = 1;
    let name: string;
    do {
      name = `branch-${index}`;
      index++;
    } while (existingNames.has(name));
    return name;
  }

  // ============================================================
  // IChatEngine 核心实现
  // ============================================================

  async createSession(
    title: string,
    systemPrompt: string = 'You are a helpful assistant.'
  ): Promise<string> {
    const fileNode = await this.engine.driver.createFile({
      name: `${title}.chat`,
      parentPath: null,
      content: '{}',
      metadata: { title, icon: '💬' },
    });

    const { sessionId } = await this.createSessionStructure(fileNode.path, title, systemPrompt);
    await this.engine.driver.updateMetadata(fileNode.path, { title, icon: '💬', sessionId });

    this.notify();
    return sessionId;
  }

  async initializeExistingFile(
    nodeId: string,
    title: string,
    systemPrompt: string = 'You are a helpful assistant.'
  ): Promise<string> {
    const manifest = await this.tryReadValidManifest(nodeId);

    if (!manifest) {
      // Safety guard: only auto-create a new session if the .chat file is
      // genuinely empty (new file) or absent. If the file already has content
      // but the manifest could not be parsed, it is corrupt — never overwrite
      // user data without explicit confirmation.
      const existing = await this.engine.driver.readContent(nodeId);
      const existingSize = existing instanceof ArrayBuffer
        ? existing.byteLength
        : (existing as string).length;

      if (existingSize > 0) {
        log.error('Session file is corrupt, refusing to auto-create', { nodeId, existingSize });
        throw new Error(`Session file is corrupt and cannot be parsed (nodeId=${nodeId}). Manual recovery required.`);
      }

      return this.createNewSessionForNode(nodeId, title, systemPrompt);
    }

    const intact = await this.isSessionStructureIntact(nodeId, manifest);
    if (!intact) {
      log.warn('Session structure broken, attempting rebuild', { nodeId });
      return this.rebuildSessionStructure(nodeId, manifest, systemPrompt);
    }

    // Populate cache
    this.chatFileIds.set(manifest.id, nodeId);
    return manifest.id;
  }

  private async createNewSessionForNode(
    nodeId: string,
    title: string,
    systemPrompt: string
  ): Promise<string> {
    const { sessionId } = await this.createSessionStructure(nodeId, title, systemPrompt);
    await this.engine.driver.updateMetadata(nodeId, { title, icon: '💬', sessionId });

    this.notify();
    return sessionId;
  }

  private async rebuildSessionStructure(

    nodeId: string,
    oldManifest: ChatManifest,
    systemPrompt: string
  ): Promise<string> {
    // Safety guard: check whether the asset dir has any nodes before deleting.
    // An asset dir with nodes means user data exists — do NOT auto-delete.
    // Only wipe when the asset dir is genuinely empty (no node files at all).
    const assetDirPath = await this.engine.meta.assets.getAssetDirPath(nodeId);
    if (assetDirPath) {
      const assets = await this.engine.driver.getChildren(assetDirPath) as FSNode[];
      if (assets.length > 0) {
        log.error('Session structure broken but asset dir has nodes, refusing to rebuild', { nodeId, count: assets.length });
        throw new Error(`Session structure is broken but asset dir contains ${assets.length} node(s) — cannot auto-rebuild without data loss (nodeId=${nodeId}). Manual recovery required.`);
      }
      // Asset dir exists but is empty — safe to remove and recreate
      try {
        await this.engine.driver.delete([assetDirPath]);
      } catch {
        // ignore
      }
    }

    const { sessionId } = await this.createSessionStructure(
      nodeId, oldManifest.title, systemPrompt
    );

    this.notify();
    return sessionId;
  }

  // ============================================================
  // 上下文
  // ============================================================

  async getSessionContext(nodeId: string, _sessionId: string): Promise<ChatContextItem[]> {
    const manifest = await this.getManifest(nodeId);
    if (!manifest) throw new Error('Manifest missing');
    const assetDir = await this.getAssetDirPath(nodeId);
    return this.buildContextChain(assetDir, manifest.current_head);
  }

  async getSessionContextFromHead(
    nodeId: string,
    _sessionId: string,
    headNodeId: string
  ): Promise<ChatContextItem[]> {
    const assetDir = await this.getAssetDirPath(nodeId);
    return this.buildContextChain(assetDir, headNodeId);
  }

  async getManifest(nodeId: string): Promise<ChatManifest> {
    try {
      const content = await this.engine.driver.readContent(nodeId);
      if (!content) throw new Error('Empty file content');

      const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
      const manifest = JSON.parse(str) as ChatManifest;

      // Populate sessionId → chatFileId cache
      if (manifest.id) {
        this.chatFileIds.set(manifest.id, nodeId);
      }

      return manifest;
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
        await this.engine.driver.writeContent(nodeId, JSON.stringify(manifest, null, 2));
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
      const assetDir = await this.getAssetDirPath(nodeId);
      const parentId = manifest.current_head;

      const branchNum = (manifest.branch_nums ?? {})[manifest.current_branch] ?? 0;
      const sn = this.allocateSn(manifest);
      const newNodeId = this.makeNodeId(branchNum, sn, role);
      const now = new Date().toISOString();

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
      try {
        await this.engine.meta.assets.putAsset(nodeId, `${newNodeId}.chat`, JSON.stringify(newNode));
      } catch (e) {
        console.error('[DEBUG-ASSET] appendMessage putAsset FAILED:', e);
        throw e;
      }

      await this.appendToParentChildren(assetDir, parentId, newNodeId);

      if (role === 'user') {
        await this.autoUpdateTitleAndSummary(nodeId, manifest, content);
      }

      manifest.current_head = newNodeId;
      manifest.branches[manifest.current_branch] = newNodeId;
      manifest.updated_at = now;
      await this.engine.driver.writeContent(nodeId, JSON.stringify(manifest, null, 2));

      return newNodeId;
    });
  }

  async updateNode(
    sessionId: string,
    messageId: string,
    updates: {
      content?: string;
      meta?: UpdateMessageMeta;
      status?: ChatNode['status'];
    }
  ): Promise<void> {
    return this.lockManager.acquire(`node:${sessionId}:${messageId}`, async () => {
      const chatFileId = await this.resolveChatFileId(sessionId);
      if (!chatFileId) {
        console.warn('[DEBUG-ASSET] updateNode resolveChatFileId returned null for sessionId=', sessionId);
        return;
      }
      const assetDir = await this.getAssetDirPath(chatFileId);
      const nodePath = `${assetDir}/${messageId}.chat`;
      const node: ChatNode | null = await this.readJson<ChatNode>(nodePath);
      if (!node) {
        console.warn('[DEBUG-ASSET] updateNode readJson returned null for nodePath=', nodePath);
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
        await this.writeJson(nodePath, node);
      }
    });
  }

  async deleteMessage(
    nodeId: string,
    sessionId: string,
    messageNodeId: string
  ): Promise<void> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const assetDir = await this.getAssetDirPath(nodeId);
      await this.deleteMessageInternal(nodeId, assetDir, messageNodeId);
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
      const assetDir = await this.getAssetDirPath(nodeId);
      const deletedNodeIds = new Set<string>();
      const parentUpdates = new Map<string, Set<string>>();

      for (const messageNodeId of messageNodeIds) {
        const messageNode = await this.readJson<ChatNode>(`${assetDir}/${messageNodeId}.chat`);
        if (!messageNode || messageNode.status === 'deleted') continue;

        if (messageNode.parent_id) {
          if (!parentUpdates.has(messageNode.parent_id)) {
            parentUpdates.set(messageNode.parent_id, new Set());
          }
          parentUpdates.get(messageNode.parent_id)!.add(messageNodeId);
        }

        await this.collectDescendantIds(assetDir, messageNodeId, deletedNodeIds);
      }

      if (deletedNodeIds.size === 0) return;

      for (const deletedId of deletedNodeIds) {
        const nodePath = `${assetDir}/${deletedId}.chat`;
        const node: ChatNode | null = await this.readJson<ChatNode>(nodePath);
        if (node && node.status !== 'deleted') {
          node.status = 'deleted';
          await this.writeJson(nodePath, node);
        }
      }

      for (const [parentId, childIdsToRemove] of parentUpdates) {
        if (deletedNodeIds.has(parentId)) continue;

        const parentPath = `${assetDir}/${parentId}.chat`;
        const parentNode: ChatNode | null = await this.readJson<ChatNode>(parentPath);
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

      await this.repairManifestAfterBatchDelete(nodeId, assetDir, deletedNodeIds);
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
      const assetDir = await this.getAssetDirPath(nodeId);

      const originalNode = await this.readJson<ChatNode>(`${assetDir}/${originalNodeId}.chat`);
      if (!originalNode) throw new Error('Original node not found');

      const hasChildren = originalNode.children_ids.length > 0;

      if (hasChildren) {
        let isProtectedByOtherBranch = false;
        for (const [name, headId] of Object.entries(manifest.branches)) {
          if (name === manifest.current_branch) continue;
          if (await this.isNodeOnBranchPath(assetDir, headId, originalNodeId)) {
            isProtectedByOtherBranch = true;
            break;
          }
        }

        if (!isProtectedByOtherBranch) {
          const preservedBranchName = this.generateBranchName(manifest);
          manifest.branches[preservedBranchName] = manifest.current_head;
          // Assign branch num for the preserved branch
          if (!manifest.branch_nums) manifest.branch_nums = { main: 0 };
          manifest.branch_nums[preservedBranchName] = this.allocateBranchNum(manifest);
        }
      }

      const branchNum = (manifest.branch_nums ?? {})[manifest.current_branch] ?? 0;
      const sn = this.allocateSn(manifest);
      const newNodeId = this.makeNodeId(branchNum, sn, originalNode.role);
      const now = new Date().toISOString();

      const newNode: ChatNode = {
        ...originalNode,
        id: newNodeId,
        content: newContent,
        created_at: now,
        children_ids: [],
        meta: {
          ...originalNode.meta,
          branchCreatedFrom: 'edit',
          branchCreatedAt: now,
        }
      };

      await this.engine.meta.assets.putAsset(nodeId, `${newNodeId}.chat`, JSON.stringify(newNode));
      await this.appendToParentChildren(assetDir, newNode.parent_id, newNodeId);

      manifest.current_head = newNodeId;
      manifest.branches[manifest.current_branch] = newNodeId;
      manifest.updated_at = now;
      await this.engine.driver.writeContent(nodeId, JSON.stringify(manifest, null, 2));

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
      createdFrom?: 'regenerate' | 'edit' | 'manual';
    }
  ): Promise<string> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const manifest = await this.getManifest(nodeId);
      const assetDir = await this.getAssetDirPath(nodeId);

      const sourceNode = await this.readJson<ChatNode>(`${assetDir}/${sourceMessageId}.chat`);
      if (!sourceNode) throw new Error(`Source node not found: ${sourceMessageId}`);

      const branchName = options?.name || this.generateBranchName(manifest);
      const branchNum = this.allocateBranchNum(manifest);
      const sn = this.allocateSn(manifest);
      const newNodeId = this.makeNodeId(branchNum, sn, sourceNode.role);
      const now = new Date().toISOString();

      if (!manifest.branch_nums) manifest.branch_nums = { main: 0 };
      manifest.branch_nums[branchName] = branchNum;

      const newNode: ChatNode = {
        id: newNodeId,
        type: 'message',
        role: sourceNode.role,
        content: options?.copyContent ? sourceNode.content : '',
        created_at: now,
        parent_id: sourceNode.parent_id,
        children_ids: [],
        status: 'active',
        meta: {
          ...(options?.copyContent && sourceNode.meta?.files
            ? { files: sourceNode.meta.files }
            : {}),
          branchCreatedFrom: options?.createdFrom || 'manual',
          branchCreatedAt: now,
        },
      };

      await this.engine.meta.assets.putAsset(nodeId, `${newNodeId}.chat`, JSON.stringify(newNode));

      if (newNode.parent_id) {
        await this.appendToParentChildren(assetDir, newNode.parent_id, newNodeId);
      }

      manifest.branches[branchName] = newNodeId;
      manifest.current_branch = branchName;
      manifest.current_head = newNodeId;
      manifest.updated_at = now;
      await this.engine.driver.writeContent(nodeId, JSON.stringify(manifest, null, 2));

      return newNodeId;
    });
  }

  async switchBranch(nodeId: string, sessionId: string, branchName: string): Promise<void> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const manifest = await this.getManifest(nodeId);
      if (!manifest.branches[branchName]) throw new Error('Branch not found');

      manifest.current_branch = branchName;
      manifest.current_head = manifest.branches[branchName];
      manifest.updated_at = new Date().toISOString();

      await this.engine.driver.writeContent(nodeId, JSON.stringify(manifest, null, 2));
    });
  }

  async registerPathAsBranch(
    nodeId: string,
    sessionId: string,
    targetNodeId: string,
    branchName?: string
  ): Promise<string> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const manifest = await this.getManifest(nodeId);
      const assetDir = await this.getAssetDirPath(nodeId);
      const name = branchName || this.generateBranchName(manifest);

      const leafId = await this.findDeepestActiveLeaf(assetDir, targetNodeId);

      if (!manifest.branch_nums) manifest.branch_nums = { main: 0 };
      manifest.branch_nums[name] = this.allocateBranchNum(manifest);
      manifest.branches[name] = leafId;
      manifest.current_branch = name;
      manifest.current_head = leafId;
      manifest.updated_at = new Date().toISOString();

      await this.engine.driver.writeContent(nodeId, JSON.stringify(manifest, null, 2));
      return name;
    });
  }

  private async findDeepestActiveLeaf(assetDir: string, nodeId: string): Promise<string> {
    let currentId = nodeId;
    const visited = new Set<string>();

    while (true) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${currentId}.chat`);
      if (!node) break;

      let foundChild = false;
      for (const childId of node.children_ids) {
        const child = await this.readJson<ChatNode>(`${assetDir}/${childId}.chat`);
        if (child && child.status === 'active') {
          currentId = childId;
          foundChild = true;
          break;
        }
      }

      if (!foundChild) break;
    }

    return currentId;
  }

  async findBranchForNode(
    nodeId: string,
    _sessionId: string,
    targetNodeId: string
  ): Promise<string | null> {
    const manifest = await this.getManifest(nodeId);
    const assetDir = await this.getAssetDirPath(nodeId);
    const matchingBranches: string[] = [];

    for (const [branchName, headId] of Object.entries(manifest.branches)) {
      if (await this.isNodeOnBranchPath(assetDir, headId, targetNodeId)) {
        matchingBranches.push(branchName);
      }
    }

    if (matchingBranches.length === 0) return null;

    if (matchingBranches.includes(manifest.current_branch)) {
      return manifest.current_branch;
    }

    return matchingBranches[0];
  }

  async getBranchTree(
    _sessionId: string,
    nodeId: string,
    rootNodeId?: string
  ): Promise<BranchTreeNode> {
    const manifest = await this.getManifest(nodeId);
    const assetDir = await this.getAssetDirPath(nodeId);
    const root = rootNodeId || manifest.root_id;

    const activePathIds = await this.collectActivePathIds(assetDir, manifest.current_head);
    const branchMembership = await this.buildBranchMembership(assetDir, manifest);

    const headToBranch = new Map<string, string>();
    for (const [name, headId] of Object.entries(manifest.branches)) {
      headToBranch.set(headId, name);
    }

    return this.buildBranchTreeRecursive(
      assetDir, root, activePathIds, branchMembership, headToBranch
    );
  }

  private async buildBranchTreeRecursive(
    assetDir: string,
    nodeId: string,
    activePathIds: Set<string>,
    branchMembership: Map<string, Set<string>>,
    headToBranch: Map<string, string>
  ): Promise<BranchTreeNode> {
    const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${nodeId}.chat`);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const children: BranchTreeNode[] = [];
    for (const childId of node.children_ids) {
      const childNode = await this.readJson<ChatNode>(`${assetDir}/${childId}.chat`);
      if (!childNode || childNode.status === 'deleted') continue;

      try {
        children.push(
          await this.buildBranchTreeRecursive(
            assetDir, childId, activePathIds, branchMembership, headToBranch
          )
        );
      } catch (e) {
        log.warn('Failed to build branch tree child', { childId, error: e });
      }
    }

    const memberBranches = branchMembership.get(nodeId);

    return {
      id: nodeId,
      role: node.role,
      content: node.content,
      timestamp: new Date(node.created_at).getTime(),
      isOnActivePath: activePathIds.has(nodeId),
      memberOfBranches: memberBranches ? Array.from(memberBranches) : [],
      branchHead: headToBranch.get(nodeId),
      createdFrom: node.meta?.branchCreatedFrom,
      children
    };
  }

  async renameBranch(
    nodeId: string,
    sessionId: string,
    oldName: string,
    newName: string
  ): Promise<void> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const manifest = await this.getManifest(nodeId);

      if (!manifest.branches[oldName]) {
        throw new Error(`Branch not found: ${oldName}`);
      }
      if (oldName !== newName && manifest.branches[newName]) {
        throw new Error(`Branch name already exists: ${newName}`);
      }

      const headNodeId = manifest.branches[oldName];
      delete manifest.branches[oldName];
      manifest.branches[newName] = headNodeId;

      // Migrate branch_nums entry
      if (manifest.branch_nums) {
        const num = manifest.branch_nums[oldName];
        if (num !== undefined) {
          delete manifest.branch_nums[oldName];
          manifest.branch_nums[newName] = num;
        }
      }

      if (manifest.current_branch === oldName) {
        manifest.current_branch = newName;
      }

      manifest.updated_at = new Date().toISOString();
      await this.engine.driver.writeContent(nodeId, JSON.stringify(manifest, null, 2));
    });
  }

  async deleteBranch(
    nodeId: string,
    sessionId: string,
    branchName: string,
    options?: { cascade?: boolean }
  ): Promise<string[]> {
    return this.lockManager.acquire(`session:${sessionId}`, async () => {
      const manifest = await this.getManifest(nodeId);
      const assetDir = await this.getAssetDirPath(nodeId);

      if (!manifest.branches[branchName]) {
        throw new Error(`Branch not found: ${branchName}`);
      }
      if (Object.keys(manifest.branches).length <= 1) {
        throw new Error('Cannot delete the last branch');
      }

      const branchHeadId = manifest.branches[branchName];

      const protectedNodeIds = new Set<string>();
      for (const [name, headId] of Object.entries(manifest.branches)) {
        if (name === branchName) continue;
        await this.collectAncestorIds(assetDir, headId, protectedNodeIds);
      }

      const branchExclusiveChain = await this.collectExclusiveChain(
        assetDir, branchHeadId, protectedNodeIds
      );

      const deletedIds: string[] = [];

      for (const exclusiveNodeId of branchExclusiveChain) {
        if (options?.cascade !== false) {
          await this.softDeleteExclusive(assetDir, exclusiveNodeId, protectedNodeIds, deletedIds);
        } else {
          const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${exclusiveNodeId}.chat`);
          if (node && node.status !== 'deleted') {
            node.status = 'deleted';
            await this.writeJson(`${assetDir}/${exclusiveNodeId}.chat`, node);
            deletedIds.push(exclusiveNodeId);
          }
        }
      }

      for (const deletedId of deletedIds) {
        const deletedNode = await this.readJson<ChatNode>(`${assetDir}/${deletedId}.chat`);
        if (deletedNode?.parent_id && protectedNodeIds.has(deletedNode.parent_id)) {
          await this.removeFromParentChildren(assetDir, deletedNode.parent_id, deletedId);
        }
      }

      delete manifest.branches[branchName];
      if (manifest.branch_nums) {
        delete manifest.branch_nums[branchName];
      }

      if (manifest.current_branch === branchName) {
        const remaining = Object.keys(manifest.branches);
        manifest.current_branch = remaining[0];
        manifest.current_head = manifest.branches[remaining[0]];
      }

      manifest.updated_at = new Date().toISOString();
      await this.engine.driver.writeContent(nodeId, JSON.stringify(manifest, null, 2));

      return deletedIds;
    });
  }

  // ============================================================
  // getNodeSiblings
  // ============================================================

  async getNodeSiblings(sessionId: string, messageId: string): Promise<ChatNode[]> {
    const chatFileId = await this.resolveChatFileId(sessionId);
    if (!chatFileId) return [];
    const assetDir = await this.getAssetDirPath(chatFileId);

    const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${messageId}.chat`);
    if (!node || !node.parent_id) return node ? [node] : [];

    const parent = await this.readJson<ChatNode>(`${assetDir}/${node.parent_id}.chat`);
    if (!parent) return [node];

    const siblings = await Promise.all(
      parent.children_ids.map(id =>
        this.readJson<ChatNode>(`${assetDir}/${id}.chat`)
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

      await this.engine.driver.writeContent(nodeId, JSON.stringify(manifest, null, 2));
    });
  }

  async validateManifest(nodeId: string, _sessionId: string): Promise<boolean> {
    try {
      const manifest = await this.getManifest(nodeId);
      const assetDir = await this.getAssetDirPath(nodeId);

      const isNodeInvalid = async (id: string): Promise<boolean> => {
        const node: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${id}.chat`);
        return node === null || node.status === 'deleted';
      };

      // Check if any head/branch reference is invalid before attempting repair
      let needsRepair = await isNodeInvalid(manifest.current_head);
      if (!needsRepair) {
        for (const branchHead of Object.values(manifest.branches)) {
          if (await isNodeInvalid(branchHead)) {
            needsRepair = true;
            break;
          }
        }
      }

      if (!needsRepair) return true;

      // Repair manifest pointers only — never deletes chat data files
      log.warn('Manifest has invalid references, repairing pointers', { nodeId });
      await repairManifest(
        this.getManifestIO(),
        nodeId,
        isNodeInvalid,
        async (_invalidId, m) => {
          // Walk ancestors of root to find a valid fallback
          const rootNode: ChatNode | null = await this.readJson<ChatNode>(`${assetDir}/${m.root_id}.chat`);
          return (rootNode && rootNode.status !== 'deleted') ? m.root_id : m.root_id;
        }
      );
      return false;
    } catch (e) {
      log.error('Manifest validation failed', { nodeId, error: e });
      return false;
    }
  }

  // ============================================================
  // IFSEngine file operations
  // ============================================================

  async createDirectory(name: string, parentPath: string | null): Promise<FSNode> {
    return this.engine.driver.createDirectory({ name, parentPath });
  }

  async createFile(
    name: string,
    parentPath: string | null,
    _content?: string | ArrayBuffer
  ): Promise<FSNode> {
    const baseName = (name || 'New Chat').replace(/\.chat$/i, '');
    const availableName = await this.findAvailableFileName(baseName, parentPath);

    // Create .chat file first, then build session structure
    const node = await this.engine.driver.createFile({
      name: `${availableName}.chat`,
      parentPath,
      content: '{}',
      metadata: { title: availableName, icon: '💬' },
    });

    const { sessionId } = await this.createSessionStructure(
      node.path, availableName, 'You are a helpful assistant.'
    );
    await this.engine.driver.updateMetadata(node.path, { title: availableName, icon: '💬', sessionId });

    this.notify();
    return node;
  }

  private async findAvailableFileName(
    baseName: string,
    parentPath: string | null
  ): Promise<string> {
    const existingNames = new Set<string>();

    try {
      const children = parentPath
        ? await this.engine.driver.getChildren(parentPath)
        : (await this.engine.driver.getChildren('/')).filter(n => !n.parentPath);

      children.forEach(child => {
        if (child.name.endsWith('.chat')) {
          existingNames.add(child.name.replace(/\.chat$/i, '').toLowerCase());
        }
      });
    } catch {
      // continue, assume no conflicts
    }

    if (!existingNames.has(baseName.toLowerCase())) return baseName;

    for (let i = 1; i <= 100; i++) {
      const numberedName = `${baseName} (${i})`;
      if (!existingNames.has(numberedName.toLowerCase())) return numberedName;
    }

    return `${baseName}_${generateUUID().substring(0, 8)}`;
  }

  async rename(id: string, newName: string): Promise<void> {
    this.assetDirPaths.delete(id);
    const node = await this.vfs.getNodeById(id);
    if (!node) throw new Error('Node not found');

    // Always preserve .chat extension regardless of what node.name currently contains.
    // If node.name has lost its .chat (e.g., renamed outside app or via LocalFS), fall back
    // to the canonical .chat extension so the session remains recognisable.
    const sourceName = node.name.endsWith('.chat') ? node.name : `${node.name}.chat`;
    const { filename, title: cleanName } = buildRenamedFilename(newName, sourceName);
    await this.engine.driver.rename(id, filename);

    // After rename, the old id (path) is gone; compute the new path.
    const lastSlash = id.lastIndexOf('/');
    const newId = lastSlash >= 0 ? id.substring(0, lastSlash + 1) + filename : filename;

    // Update chatFileIds cache: remap sessionId → newId
    for (const [sessionId, cachedId] of this.chatFileIds) {
      if (cachedId === id) {
        this.chatFileIds.set(sessionId, newId);
        break;
      }
    }

    try {
      const manifest = await this.getManifest(newId);
      manifest.title = cleanName;
      manifest.updated_at = new Date().toISOString();
      await this.engine.driver.writeContent(newId, JSON.stringify(manifest, null, 2));
    } catch {
      // ignore
    }

    await this.engine.driver.updateMetadata(newId, { title: cleanName });
  }

  async delete(ids: string[]): Promise<void> {
    // The VFS automatically cascade-deletes asset dirs when the owner file is
    // deleted (vfs-engine.ts: toAssetDirName → deleteRecursive). No manual
    // cleanup needed — attempting it first causes a double-delete ENOENT.
    ids.forEach(id => this.assetDirPaths.delete(id));
    await this.engine.driver.delete(ids);
    this.notify();
  }

  async search(query: { type?: string; text?: string; tags?: string[]; limit?: number; scope?: string[] }): Promise<FSNode[]> {
    const result = await this.engine.driver.search({
      type: query.type as any,
      name: query.text ? { contains: query.text } : undefined,
      tags: query.tags ? { any: query.tags } : undefined,
      limit: query.limit,
    });
    return Array.from(result.nodes).filter(
      (node: FSNode) => node.type === 'file' && this.isChatFile(node.name)
    );
  }

  // ============================================================
  // 资产操作
  // ============================================================

  async createAsset(
    ownerNodeId: string,
    filename: string,
    content: string | ArrayBuffer
  ): Promise<FSNode> {
    return this.engine.meta.assets.putAsset(ownerNodeId, filename, content);
  }

  async getAssetDirectoryId(ownerNodeId: string): Promise<string | null> {
    return this.engine.meta.assets.getAssetDirPath(ownerNodeId);
  }

  async getAssets(ownerNodeId: string): Promise<FSNode[]> {
    const dirPath = await this.engine.meta.assets.getAssetDirPath(ownerNodeId);
    return dirPath ? await this.engine.driver.getChildren(dirPath) as FSNode[] : [];
  }

  async readSessionAsset(sessionId: string, assetPath: string): Promise<Blob | null> {
    const chatFileId = await this.resolveChatFileId(sessionId);
    if (!chatFileId) return null;

    const assetDir = await this.getAssetDirPath(chatFileId);
    const cleanPath = assetPath.startsWith('./') ? assetPath.slice(2) : assetPath;
    const fullPath = `${assetDir}/${cleanPath}`;

    try {
      const nodeId = await this.engine.driver.resolvePath(fullPath);
      if (!nodeId) return null;

      const raw = await this.engine.driver.readContent(nodeId);
      if (!raw) return null;
      const blobContent = typeof raw === 'string' ? raw :
        raw instanceof ArrayBuffer ? raw :
        (raw.buffer as ArrayBuffer).slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

      return new Blob([blobContent], { type: guessMimeType(cleanPath) });
    } catch {
      return null;
    }
  }

  // ============================================================
  // proxy methods (IFSEngine interface)
  // ============================================================

  async getChildren(parentId: string): Promise<FSNode[]> {
    const nodes = await this.engine.driver.getChildren(parentId);
    // Filter hidden files, asset dirs, and non-.chat files at every level
    return nodes.filter((node: FSNode) => {
      if (node.name.startsWith('.')) return false;
      if (node.name.startsWith('_')) return false;
      if (node.type === 'file') return this.isChatFile(node.name);
      if (node.type === 'directory') return true;
      return false;
    });
  }

  async readContent(id: string): Promise<string | ArrayBuffer> {
    const raw = await this.engine.driver.readContent(id);
    return typeof raw === 'string' ? raw :
      raw instanceof ArrayBuffer ? raw : (raw.buffer as ArrayBuffer).slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  }

  async getNode(id: string): Promise<FSNode | null> {
    return this.engine.driver.getNode(id);
  }

  async writeContent(id: string, content: string | ArrayBuffer): Promise<void> {
    return this.engine.driver.writeContent(id, content);
  }

  async move(ids: string[], targetParentId: string | null): Promise<void> {
    ids.forEach(id => this.assetDirPaths.delete(id));
    return this.engine.driver.move(ids, targetParentId);
  }

  async updateMetadata(id: string, metadata: Record<string, any>): Promise<void> {
    return this.engine.driver.updateMetadata(id, metadata);
  }

  async setTags(id: string, tags: string[]): Promise<void> {
    await this.engine.meta.tags?.setTags(id, tags);
  }

  async setTagsBatch(updates: Array<{ id: string; tags: string[] }>): Promise<void> {
    const tagsOps = this.engine.meta.tags;
    if (tagsOps) {
      await Promise.all(updates.map(u => tagsOps.setTags(u.id, u.tags)));
    }
  }

  async getAllTags(): Promise<Array<{ name: string; color?: string }>> {
    const tags = this.engine.meta?.tags?.getAllTags();
    return tags ?? [];
  }

  on<E extends FSEventType>(event: E, callback: (e: FSEvent<E>) => void): () => void {
    return this.engine.driver.on(event, callback as any);
  }

  // ============================================================
  // 会话设置管理 (YAML)
  // ============================================================

  async getSessionSettings(sessionId: string): Promise<ChatSessionSettings> {
    try {
      const chatFileId = await this.resolveChatFileId(sessionId);
      if (!chatFileId) return { ...DEFAULT_SESSION_SETTINGS };

      const assetDir = await this.getAssetDirPath(chatFileId);
      const settingsPath = `${assetDir}/settings.yaml`;

      const nodeId = await this.engine.driver.resolvePath(settingsPath);
      if (!nodeId) return { ...DEFAULT_SESSION_SETTINGS };

      const content = await this.engine.driver.readContent(nodeId);
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
      const chatFileId = await this.resolveChatFileId(sessionId);
      if (!chatFileId) return;

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
      // createAsset has put (upsert) semantics
      await this.engine.meta.assets.putAsset(chatFileId, 'settings.yaml', yamlContent);
    });
  }
}
