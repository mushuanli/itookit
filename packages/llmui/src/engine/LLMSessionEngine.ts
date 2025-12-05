// @file llm-ui/engine/LLMSessionEngine.ts

import { 
    BaseModuleService, 
    VFSCore, 
    VNode, 
    VNodeType 
} from '@itookit/vfs-core';
import { 
    ILLMSessionEngine, 
    EngineNode, 
    EngineSearchQuery, 
    EngineEvent, 
    EngineEventType, 
    generateUUID, 
    ChatContextItem,
    ChatManifest, 
    ChatNode, 
    IYamlParser,
    FS_MODULE_CHAT
} from '@itookit/common';

// ✨ [修复 1.1] 引入真正的 YAML 库，或使用严格的 JSON 模式
// 如果项目中有 js-yaml，使用它；否则明确只支持 JSON
import * as yaml from 'js-yaml'; // 需要安装: npm install js-yaml @types/js-yaml

const Yaml: IYamlParser = {
    parse: (t) => {
        try {
            return yaml.load(t) as any;
        } catch {
            // Fallback to JSON for backward compatibility
            return JSON.parse(t);
        }
    },
    stringify: (o) => yaml.dump(o, { indent: 2 })
};

// ✨ [修复 1.4] DEBUG 标志控制日志
const DEBUG = process.env.NODE_ENV === 'development';
const log = (...args: any[]) => DEBUG && console.log(...args);

// ✨ [修复 1.2] 简单的锁实现
class LockManager {
    private locks = new Map<string, Promise<void>>();

    async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
        // 等待现有锁释放
        while (this.locks.has(key)) {
            await this.locks.get(key);
        }

        let release: () => void;
        const lockPromise = new Promise<void>(resolve => {
            release = resolve;
        });
        this.locks.set(key, lockPromise);

        try {
            return await fn();
        } finally {
            this.locks.delete(key);
            release!();
        }
    }
}

export class LLMSessionEngine extends BaseModuleService implements ILLMSessionEngine {
    
    // ✨ [修复 1.2] 添加锁管理器
    private lockManager = new LockManager();
    
    constructor(vfs?: VFSCore) {
        // 1. 指定模块名为 'chats' (或者通过参数传入)
        super(FS_MODULE_CHAT, { description: 'Chat Sessions' }, vfs);
    }

    /**
     * Service 初始化后的钩子
     */
    protected async onLoad(): Promise<void> {
        // 可以在这里建立索引或执行清理
    }

    // ============================================================
    // 辅助 Getter 解决 Property access error
    // ============================================================
    
    // BaseModuleService 中的 this.vfs 是 VFSCore 实例
    // VFSCore 没有 pathResolver/storage，它们在底层 VFS 实例上
    private get coreVfs() {
        return this.vfs.getVFS();
    }

    // ============================================================
    // 路径辅助 (私有)
    // ============================================================

    private getHiddenDir(sessionId: string): string {
        return `/.${sessionId}`;
    }

    private getNodePath(sessionId: string, nodeId: string): string {
        // 这里的路径相对于模块根目录
        // e.g., /.550e-8400/.msg-node-123.yaml
        return `${this.getHiddenDir(sessionId)}/.${nodeId}.yaml`;
    }


    // ============================================================
    // ILLMSessionEngine 实现
    // ============================================================

    async createSession(title: string, systemPrompt: string = "You are a helpful assistant."): Promise<string> {
        const sessionId = generateUUID();
        log(`createSession call: ${title} - id: ${sessionId}`);
        
        await this.moduleEngine.createDirectory(this.getHiddenDir(sessionId), null);

        // 2. 创建根节点 (System Prompt)
        const rootNodeId = `node-${Date.now()}-root`;
        const rootNode: ChatNode = {
            id: rootNodeId,
            type: 'message',
            role: 'system',
            content: systemPrompt,
            created_at: new Date().toISOString(),
            parent_id: null,
            children_ids: [],
            status: 'active'
        };
        
        await this.writeJson(this.getNodePath(sessionId, rootNodeId), rootNode);

        // 3. 创建 Manifest 文件: /uuid.chat
        const manifest: ChatManifest = {
            version: "1.0",
            id: sessionId,
            title: title,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            settings: { model: "gpt-4", temperature: 0.7 },
            branches: { "main": rootNodeId },
            current_branch: "main",
            current_head: rootNodeId,
            root_id: rootNodeId
        };

        // 这里有个潜在问题：createFile 需要父目录，如果没有明确父目录可能会乱。
        // 但 createSession 接口主要用于测试或后台。UI 推荐用 createFile。
        // 为了兼容，我们假设创建一个同名文件
        await this.moduleEngine.createFile(
            `/${title}.chat`,
            null,
            Yaml.stringify(manifest),
            { title: title, icon: '💬' }
        );

        // 通知 UI 更新 (虽然 vfs 会发事件，但有时候为了业务层刷新列表)
        this.notify();

        return sessionId;
    }

    /**
     * [修复] 获取上下文需要 nodeId (读取 Manifest) 和 sessionId (读取隐藏消息)
     */
    async getSessionContext(nodeId: string, sessionId: string): Promise<ChatContextItem[]> {
        const manifest = await this.getManifest(nodeId);
        if (!manifest) throw new Error("Manifest missing or unreadable");

        let currentNodeId: string | null = manifest.current_head;
        const context: ChatContextItem[] = [];

        // ✨ [修复 1.5] 批量读取优化 - 收集所有节点ID后一次性读取
        const nodeIds: string[] = [];
        let tempNodeId: string | null = currentNodeId;
        
        // 先收集所有需要读取的节点ID
        while (tempNodeId) {
            nodeIds.push(tempNodeId);
            const tempNode: ChatNode | null = await this.readJson<ChatNode>(this.getNodePath(sessionId, tempNodeId));
            if (!tempNode) break;
            tempNodeId = tempNode.parent_id;
        }

        // 批量读取（如果 VFS 支持批量读取的话）
        const nodes = await Promise.all(
            nodeIds.map(id => this.readJson<ChatNode>(this.getNodePath(sessionId, id)))
        );

        // 按顺序构建上下文
        for (let i = nodes.length - 1; i >= 0; i--) {
            const node = nodes[i];
            if (node && node.status === 'active') {
                context.push({ node });
            }
        }

        return context;
    }

    /**
     * [修复] 通过 VFS nodeId 读取 Manifest 内容
     */
    async getManifest(nodeId: string): Promise<ChatManifest> {
        try {
            const content = await this.moduleEngine.readContent(nodeId);
            if (!content) throw new Error("Empty file content");
            
            const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
            return Yaml.parse(str) as ChatManifest;
        } catch (e) {
            console.error(`[LLMSessionEngine] Failed to read manifest from node ${nodeId}`, e);
            throw new Error(`Manifest missing for node: ${nodeId}`);
        }
    }

    // ============================================================================
    // 消息操作方法
    // ============================================================================

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
            
            const newNode: ChatNode = {
                id: newNodeId,
                type: 'message',
                role,
                content,
                created_at: new Date().toISOString(),
                parent_id: parentId,
                children_ids: [],
                meta,
                status: 'active'
            };

            // 1. 写入新节点
            await this.writeJson(this.getNodePath(sessionId, newNodeId), newNode);

            // 2. 更新父节点的 children_ids
            if (parentId) {
                const parentNode = await this.readJson<ChatNode>(this.getNodePath(sessionId, parentId));
                if (parentNode) {
                    if (!parentNode.children_ids) parentNode.children_ids = [];
                    parentNode.children_ids.push(newNodeId);
                    await this.writeJson(this.getNodePath(sessionId, parentId), parentNode);
                }
            }

            // 3. 更新 Manifest
            manifest.current_head = newNodeId;
            manifest.branches[manifest.current_branch] = newNodeId;
            manifest.updated_at = new Date().toISOString();
            
            await this.moduleEngine.writeContent(nodeId, JSON.stringify(manifest, null, 2));

            return newNodeId;
        });
    }

    /**
     * ✨ [核心方法] 原地更新节点内容（支持流式持久化）
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
     * [修复] 编辑消息涉及分支创建，需要更新 Manifest (nodeId)
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
            if (!originalNode) throw new Error("Original node not found");

            const newNodeId = generateUUID();
            const newNode: ChatNode = {
                ...originalNode,
                id: newNodeId,
                content: newContent,
                created_at: new Date().toISOString(),
                children_ids: []
            };

            await this.writeJson(this.getNodePath(sessionId, newNodeId), newNode);

            if (newNode.parent_id) {
                const parent = await this.readJson<ChatNode>(this.getNodePath(sessionId, newNode.parent_id));
                if (parent) {
                    parent.children_ids.push(newNodeId);
                    await this.writeJson(this.getNodePath(sessionId, newNode.parent_id), parent);
                }
            }

        // 3. 处理分支逻辑
        // 简单策略：直接移动当前 Head 到这个新修改的节点
        // 这意味着原来的路径被丢弃在历史中（但文件还在），或者我们可以创建一个新命名的分支
        // 这里采用类似于 Cursor 的 "navigate sibling" 策略，不强制创建新命名分支，只移动 Head
        // 但注意：如果 originalNode 不是 Head，这会切断 originalNode 之后的所有消息
        // 所以这本质上是一个 "Branch Off" 操作
        
            manifest.current_head = newNodeId;
            manifest.branches[manifest.current_branch] = newNodeId;
            manifest.updated_at = new Date().toISOString();
            
            await this.moduleEngine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
            
            return newNodeId;
        });
    }

    async deleteMessage(sessionId: string, nodeId: string): Promise<void> {
        const path = this.getNodePath(sessionId, nodeId);
        const node = await this.readJson<ChatNode>(path);
        if (node) {
            node.status = 'deleted';
            await this.writeJson(path, node);
        }
    }

    // ============================================================================
    // 分支操作方法
    // ============================================================================

    /**
     * [修复] 切换分支需要更新 Manifest (nodeId)
     */
    async switchBranch(nodeId: string, sessionId: string, branchName: string): Promise<void> {
        return this.lockManager.acquire(`session:${sessionId}`, async () => {
            const manifest = await this.getManifest(nodeId);
            if (!manifest.branches[branchName]) throw new Error("Branch not found");
            
            manifest.current_branch = branchName;
            manifest.current_head = manifest.branches[branchName];
            await this.moduleEngine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
        });
    }

    async getNodeSiblings(sessionId: string, nodeId: string): Promise<ChatNode[]> {
        const node = await this.readJson<ChatNode>(this.getNodePath(sessionId, nodeId));
        if (!node || !node.parent_id) return node ? [node] : [];
        
        const parent = await this.readJson<ChatNode>(this.getNodePath(sessionId, node.parent_id));
        if (!parent) return [node];

        const siblings = await Promise.all(
            parent.children_ids.map(id => this.readJson<ChatNode>(this.getNodePath(sessionId, id)))
        );
        return siblings.filter((n): n is ChatNode => n !== null);
    }

    // ============================================================================
    // ISessionEngine Overrides (UI List Logic)
    // ============================================================================

    async loadTree(): Promise<EngineNode[]> {
        // 使用 moduleEngine 获取原始树
        const allNodes = (await this.moduleEngine.loadTree()) as EngineNode[];
        // [修复] Code 7022: 显式指定参数类型
        return allNodes.filter((node: EngineNode) => 
            node.type === 'file' && node.name.endsWith('.chat')
        );
    }

    /**
     * ✨ [重构] createFile - 供 VFS UI 创建新文件时调用
     * 确保创建的文件一定有完整的 session 结构
     */
    async createFile(
        name: string, 
        parentId: string | null, 
        content?: string | ArrayBuffer
    ): Promise<EngineNode> {
        // 从文件名提取标题
        const title = (name || "New Chat").replace(/\.chat$/i, '');
        
        log(`[LLMSessionEngine] createFile: name="${name}", title="${title}"`);
        
        // 1. 生成 sessionId
        const sessionId = generateUUID();
        
        // 2. 创建隐藏数据目录和根节点
        await this.moduleEngine.createDirectory(this.getHiddenDir(sessionId), null);
        
        const rootNodeId = `node-${Date.now()}-root`;
        const rootNode: ChatNode = {
            id: rootNodeId,
            type: 'message',
            role: 'system',
            content: "You are a helpful assistant.",
            created_at: new Date().toISOString(),
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
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            settings: { model: "gpt-4", temperature: 0.7 },
            branches: { "main": rootNodeId },
            current_branch: "main",
            current_head: rootNodeId,
            root_id: rootNodeId
        };

        // 4. 创建 .chat 文件（包含 manifest 内容）
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
     * 重写 createDirectory: 禁用在 UI 上创建文件夹
     */
    async createDirectory(name: string, parentId: string | null): Promise<EngineNode> {
        throw new Error("Chat list does not support sub-directories.");
    }

    // ============================================================================
    // 文件操作方法
    // ============================================================================

    async rename(id: string, newName: string): Promise<void> {
        // [修复] Code 2339: 使用 coreVfs.storage
        const node = await this.coreVfs.storage.loadVNode(id);
        if (!node) throw new Error("Node not found");

        try {
            // [修复] 直接读取当前文件的 manifest，不需要从文件名推导 UUID
            const manifest = await this.getManifest(id);
            manifest.title = newName;
            await this.moduleEngine.writeContent(id, JSON.stringify(manifest, null, 2));
        } catch (e) {
            console.warn("Failed to update manifest title", e);
        }

        // 2. 更新 VNode Metadata (UI 列表标题)
        await this.moduleEngine.updateMetadata(id, {
            ...node.metadata,
            title: newName
        });
    }

    // 删除逻辑
    async delete(ids: string[]): Promise<void> {
        for (const id of ids) {
            // [修复] Code 2339: 使用 coreVfs.storage
            const node = await this.coreVfs.storage.loadVNode(id);
            if (!node) continue;

            // 先尝试读取 manifest 获取 sessionId
            try {
                const content = await this.moduleEngine.readContent(id);
                if (content) {
                    const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
                    const manifest = JSON.parse(str) as ChatManifest;
                    
                    if (manifest.id) {
                        // 删除隐藏目录及其所有内容
                        const hiddenDirPath = this.getHiddenDir(manifest.id);
                        try {
                            await this.moduleEngine.delete([hiddenDirPath]);
                            log(`[LLMSessionEngine] Cleaned up hidden directory: ${hiddenDirPath}`);
                        } catch (cleanupError) {
                            console.warn(`[LLMSessionEngine] Failed to cleanup hidden dir ${hiddenDirPath}:`, cleanupError);
                        }
                    }
                }
            } catch (e) {
                console.warn('[LLMSessionEngine] Could not read manifest for cleanup:', e);
            }

            // 删除主文件
            await this.moduleEngine.delete([node.path]);

            // [尝试] 读取内容获取 sessionId 来清理隐藏目录 (如果还能读到的话)
            // 如果文件已被删除可能无法读取，这依赖于 VFS 具体的删除顺序
            // 建议：在 UI 层或 delete 逻辑中，如果能获取 sessionId 最好
            // 这里简化逻辑，或者保留垃圾数据 (TODO: 实现 GC 机制)
        }
    }

    async search(query: EngineSearchQuery): Promise<EngineNode[]> {
        // 利用 moduleEngine 的底层搜索 (支持 Tag, Metadata, 文件名)
        const results = await this.moduleEngine.search(query);
        // [修复] 同样显式指定参数类型
        return results.filter((node: EngineNode) => 
            node.type === 'file' && node.name.endsWith('.chat')
        );
    }

    // ============================================================================
    // ✨ [新增] 辅助方法：从 nodeId 获取 sessionId
    // ============================================================================
    
    /**
     * ✨ [核心修复] 从 VFS nodeId 获取 sessionId
     * 必须读取文件内容，因为 sessionId 存储在 manifest 中，与文件名无关
     */
    async getSessionIdFromNodeId(nodeId: string): Promise<string | null> {
        log(`[LLMSessionEngine] getSessionIdFromNodeId called with: ${nodeId}`);
        try {
            const manifest = await this.getManifest(nodeId);
            return manifest.id || null;
        } catch (e) {
            console.error('[LLMSessionEngine] getSessionIdFromNodeId failed:', e);
            return null;
        }
    }

    /**
     * ✨ [新增] 初始化已存在的空文件为有效的 session
     * 不创建新的 VFS 文件，而是写入到指定的 nodeId
     */
    async initializeExistingFile(
        nodeId: string, 
        title: string, 
        systemPrompt: string = "You are a helpful assistant."
    ): Promise<string> {
        log(`[LLMSessionEngine] initializeExistingFile: nodeId=${nodeId}`);
        
        // 1. 生成新的 sessionId
        const sessionId = generateUUID();
        log(`[LLMSessionEngine] Generated sessionId: ${sessionId}`);
        
        const hiddenDirPath = this.getHiddenDir(sessionId);
        log(`[LLMSessionEngine] Creating hidden dir: ${hiddenDirPath}`);
        
        try {
            await this.moduleEngine.createDirectory(hiddenDirPath, null);
            log(`[LLMSessionEngine] Hidden dir created`);
        } catch (e: any) {
            log(`[LLMSessionEngine] Hidden dir creation result:`, e.message);
            if (!e.message?.includes('exists')) {
                throw e;
            }
        }

        // 3. 创建根节点 (System Prompt)
        const rootNodeId = `node-${Date.now()}-root`;
        log(`[LLMSessionEngine] Creating root node: ${rootNodeId}`);
        
        const rootNode: ChatNode = {
            id: rootNodeId,
            type: 'message',
            role: 'system',
            content: systemPrompt,
            created_at: new Date().toISOString(),
            parent_id: null,
            children_ids: [],
            status: 'active'
        };
        
        await this.writeJson(this.getNodePath(sessionId, rootNodeId), rootNode);
        log(`[LLMSessionEngine] Root node written`);

        // 4. 创建 Manifest 内容
        const manifest: ChatManifest = {
            version: "1.0",
            id: sessionId,
            title: title,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            settings: { model: "gpt-4", temperature: 0.7 },
            branches: { "main": rootNodeId },
            current_branch: "main",
            current_head: rootNodeId,
            root_id: rootNodeId
        };

        log(`[LLMSessionEngine] Writing manifest to nodeId: ${nodeId}`);
        await this.moduleEngine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
        log(`[LLMSessionEngine] Manifest written`);
        
        log(`[LLMSessionEngine] Updating metadata`);
        await this.moduleEngine.updateMetadata(nodeId, {
            title: title,
            icon: '💬',
            sessionId: sessionId
        });
        log(`[LLMSessionEngine] Metadata updated`);

        this.notify();
        
        log(`[LLMSessionEngine] initializeExistingFile COMPLETE: sessionId=${sessionId}`);
        return sessionId;
    }

    // ============================================================================
    // 代理方法 (委托给 moduleEngine)
    // ============================================================================

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
    
    async updateMetadata(id: string, meta: any): Promise<void> { 
        return this.moduleEngine.updateMetadata(id, meta); 
    }
    
    async setTags(id: string, tags: string[]): Promise<void> { 
        return this.moduleEngine.setTags(id, tags); 
    }
    
    async setTagsBatch(updates: Array<{ id: string; tags: string[] }>): Promise<void> { 
        // 确保 moduleEngine.setTagsBatch 存在，如果 BaseModuleService 定义为可选，这里需要断言
        if (this.moduleEngine.setTagsBatch) {
            return this.moduleEngine.setTagsBatch(updates);
        }
        // Fallback implementation if needed
        return Promise.all(updates.map(u => this.moduleEngine.setTags(u.id, u.tags))).then(() => {});
    }
    
    async getAllTags(): Promise<Array<{ name: string; color?: string }>> { 
        // 同样可能需要处理可选方法
        if (this.moduleEngine.getAllTags) {
            return this.moduleEngine.getAllTags();
        }
        return [];
    }
    
    on(event: EngineEventType, cb: (e: EngineEvent) => void): () => void { 
        return this.moduleEngine.on(event, cb); 
    }
}

