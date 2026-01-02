// @file: llm-engine/src/persistence/session-engine.ts

import { 
    BaseModuleService, 
    VFSCore
} from '@itookit/vfs-core';
import { 
    EngineNode, 
    EngineSearchQuery, 
    EngineEvent, 
    EngineEventType, 
    FS_MODULE_CHAT,
    generateUUID,
    guessMimeType,
} from '@itookit/common';
import { 
    ChatManifest, 
    ChatNode, 
    ChatContextItem, 
    ILLMSessionEngine,
} from './types';

// 调试日志
const DEBUG = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
const log = (...args: any[]) => DEBUG && console.log('[LLMSessionEngine]', ...args);

// ============================================
// 锁管理器
// ============================================

class LockManager {
    private locks = new Map<string, Promise<void>>();
    private waitQueues = new Map<string, Array<() => void>>();

    async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
        while (this.locks.has(key)) {
            await new Promise<void>(resolve => {
                const queue = this.waitQueues.get(key) || [];
                queue.push(resolve);
                this.waitQueues.set(key, queue);
            });
        }

        let release: () => void;
        const lockPromise = new Promise<void>(resolve => {
            release = resolve;
        });
        this.locks.set(key, lockPromise);

        try {
            return await fn();
        } finally {
            if (this.locks.get(key) === lockPromise) {
                this.locks.delete(key);
            }
            const queue = this.waitQueues.get(key);
            if (queue && queue.length > 0) {
                const next = queue.shift();
                if (queue.length === 0) {
                    this.waitQueues.delete(key);
                }
                next?.();
            }
            release!();
        }
    }
}

// ============================================
// LLMSessionEngine
// ============================================

/**
 * LLM 会话引擎
 * 继承 BaseModuleService，通过 moduleEngine 访问文件系统
 * 实现 ILLMSessionEngine 接口
 */
export class LLMSessionEngine extends BaseModuleService implements ILLMSessionEngine {
    private lockManager = new LockManager();
    
    constructor(vfs?: VFSCore) {
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
        await this.moduleEngine.createDirectory(this.getHiddenDir(sessionId), null);

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
        await this.moduleEngine.createFile(
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
        const sessionId = generateUUID();
        const now = new Date().toISOString();
        
        log(`initializeExistingFile: nodeId=${nodeId}, sessionId=${sessionId}`);
        
        // 1. 创建隐藏目录
        try {
            await this.moduleEngine.createDirectory(this.getHiddenDir(sessionId), null);
        } catch (e: any) {
            if (!e.message?.includes('exists')) {
                throw e;
            }
        }

        // 2. 创建根节点
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

        // 3. 创建 Manifest
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

        // 4. 写入到已存在的文件
        await this.moduleEngine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
        
        // 5. 更新元数据
        await this.moduleEngine.updateMetadata(nodeId, {
            title: title,
            icon: '💬',
            sessionId: sessionId
        });

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
            const content = await this.moduleEngine.readContent(nodeId);
            if (!content) throw new Error("Empty file content");
            
            const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
            return JSON.parse(str) as ChatManifest;
        } catch (e) {
            console.error(`[LLMSessionEngine] Failed to read manifest from node ${nodeId}`, e);
            throw new Error(`Manifest missing for node: ${nodeId}`);
        }
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
                        await this.moduleEngine.updateMetadata(nodeId, metaUpdates);
                    } catch (e) {
                        console.warn(`[LLMSessionEngine] Failed to update metadata for ${nodeId}`, e);
                    }
                }
            }

            // 5. 更新 Manifest
            manifest.current_head = newNodeId;
            manifest.branches[manifest.current_branch] = newNodeId;
            manifest.updated_at = now;
            
            await this.moduleEngine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

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
            
            await this.moduleEngine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
            
            return newNodeId;
        });
    }

    // ============================================================
    // 分支操作
    // ============================================================

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
            
            await this.moduleEngine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
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
    // ISessionEngine 文件操作（继承自 common）
    // ============================================================

    /**
     * 加载文件树
     */
    async loadTree(): Promise<EngineNode[]> {
        const allNodes = (await this.moduleEngine.loadTree()) as EngineNode[];
        return allNodes.filter((node: EngineNode) => 
            node.type === 'file' && node.name.endsWith('.chat')
        );
    }

    /**
     * 创建文件 - 供 VFS UI 创建新文件时调用
     */
    async createFile(
        name: string, 
        parentId: string | null, 
        _content?: string | ArrayBuffer
    ): Promise<EngineNode> {
        const title = (name || "New Chat").replace(/\.chat$/i, '');
        
        log(`createFile: name="${name}", title="${title}"`);
        
        // 1. 生成 sessionId
        const sessionId = generateUUID();
        const now = new Date().toISOString();
        
        // 2. 创建隐藏数据目录和根节点
        await this.moduleEngine.createDirectory(this.getHiddenDir(sessionId), null);
        
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
            title: title,
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
        const chatFileName = name.endsWith('.chat') ? name : `${name}.chat`;
        
        const node = await this.moduleEngine.createFile(
            chatFileName,
            parentId,
            manifestContent,
            {
                title: title,
                icon: '💬',
                sessionId: sessionId
            }
        );

        this.notify();
        return node;
    }

    /**
     * 禁用创建目录
     */
    async createDirectory(_name: string, _parentId: string | null): Promise<EngineNode> {
        throw new Error("Chat list does not support sub-directories.");
    }

    /**
     * 重命名
     */
    async rename(id: string, newName: string): Promise<void> {
        const coreVfs = this.vfs.getVFS();
        const node = await coreVfs.storage.loadVNode(id);
        if (!node) throw new Error("Node not found");

        try {
            const manifest = await this.getManifest(id);
            manifest.title = newName;
            manifest.updated_at = new Date().toISOString();
            await this.moduleEngine.writeContent(id, JSON.stringify(manifest, null, 2));
        } catch (e) {
            console.warn("Failed to update manifest title", e);
        }

        await this.moduleEngine.updateMetadata(id, {
            ...node.metadata,
            title: newName
        });
    }

    /**
     * 删除
     */
    async delete(ids: string[]): Promise<void> {
        for (const id of ids) {
            const coreVfs = this.vfs.getVFS();
            const node = await coreVfs.storage.loadVNode(id);
            if (!node) {
                console.warn(`[LLMSessionEngine] Node ${id} not found, skipping`);
                continue;
            }

            // 尝试清理隐藏目录
            try {
                const content = await this.moduleEngine.readContent(id);
                if (content) {
                    const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
                    const manifest = JSON.parse(str) as ChatManifest;
                    
                    if (manifest.id) {
                        // 清理隐藏目录
                        const hiddenDirPath = this.getHiddenDir(manifest.id);
                        const hiddenDirId = await this.moduleEngine.resolvePath(hiddenDirPath);
                        if (hiddenDirId) {
                            await this.moduleEngine.delete([hiddenDirId]);
                        }
                    }
                }
            } catch (e) {
                console.warn('Could not read manifest for cleanup:', e);
            }

            // 2. 删除主文件 - 使用节点 ID
            await this.moduleEngine.delete([id]);
        }
    
        this.notify();
    }

    /**
     * 搜索
     */
    async search(query: EngineSearchQuery): Promise<EngineNode[]> {
        const results = await this.moduleEngine.search(query);
        return results.filter((node: EngineNode) => 
            node.type === 'file' && node.name.endsWith('.chat')
        );
    }

    // ============================================================
    // 代理方法（实现 ISessionEngine 接口）
    // ============================================================
    async getChildren(parentId: string): Promise<EngineNode[]> {
        return this.moduleEngine.getChildren(parentId);
    }

    async createAsset(ownerNodeId: string, filename: string, content: string | ArrayBuffer): Promise<EngineNode> {
        return this.moduleEngine.createAsset(ownerNodeId, filename, content);
    }

    // 建议同时加上这个（虽然可能是可选的，但加上更完整）
    async getAssetDirectoryId(ownerNodeId: string): Promise<string | null> {
        return this.moduleEngine.getAssetDirectoryId ? this.moduleEngine.getAssetDirectoryId(ownerNodeId) : null;
    }
    /**
     * ✅ 实现：读取会话资产
     */
    async readSessionAsset(sessionId: string, assetPath: string): Promise<Blob | null> {
        // 清理路径：去掉开头的 ./ 
        const cleanPath = assetPath.startsWith('./') ? assetPath.slice(2) : assetPath;
        
        // 构造 VFS 内部路径： /.sessionId/filename
        // 注意：这必须与 createAsset 的存储逻辑一致
        const internalPath = `${this.getHiddenDir(sessionId)}/${cleanPath}`;
        
        try {
            // 1. 获取 NodeID
            const nodeId = await this.moduleEngine.resolvePath(internalPath);
            if (!nodeId) return null;

            // 2. 读取内容
            const content = await this.moduleEngine.readContent(nodeId);
            if (!content) return null;

            // 3. 转换为 Blob (UI/Kernel 需要)
            // 如果 content 是 string，转 Blob
            // 如果 content 是 ArrayBuffer，转 Blob
            const mimeType = guessMimeType(cleanPath);
            return new Blob([content], { type: mimeType });
            
        } catch (e) {
            console.warn(`[LLMSessionEngine] Failed to read asset: ${internalPath}`, e);
            return null;
        }
    }

    async readContent(id: string): Promise<string | ArrayBuffer> { 
        return this.moduleEngine.readContent(id); 
    }
    
    async getNode(id: string): Promise<EngineNode | null> { 
        return this.moduleEngine.getNode(id); 
    }
    
    async writeContent(id: string, c: string | ArrayBuffer): Promise<void> { 
        return this.moduleEngine.writeContent(id, c); 
    }
    
    async move(ids: string[], target: string | null): Promise<void> { 
        return this.moduleEngine.move(ids, target); 
    }
    
    async updateMetadata(id: string, meta: Record<string, any>): Promise<void> { 
        return this.moduleEngine.updateMetadata(id, meta); 
    }
    
    async setTags(id: string, tags: string[]): Promise<void> { 
        return this.moduleEngine.setTags(id, tags); 
    }
    
    async setTagsBatch(updates: Array<{ id: string; tags: string[] }>): Promise<void> { 
        if (this.moduleEngine.setTagsBatch) {
            return this.moduleEngine.setTagsBatch(updates);
        }
        await Promise.all(updates.map(u => this.moduleEngine.setTags(u.id, u.tags)));
    }
    
    async getAllTags(): Promise<Array<{ name: string; color?: string }>> { 
        if (this.moduleEngine.getAllTags) {
            return this.moduleEngine.getAllTags();
        }
        return [];
    }
    
    on(event: EngineEventType, cb: (e: EngineEvent) => void): () => void { 
        return this.moduleEngine.on(event, cb); 
    }
}
