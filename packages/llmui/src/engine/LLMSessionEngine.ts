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

// 简单的 YAML Mock (实际应引入库)
const Yaml: IYamlParser = {
    parse: (t) => JSON.parse(t),
    stringify: (o) => JSON.stringify(o, null, 2)
};

export class LLMSessionEngine extends BaseModuleService implements ILLMSessionEngine {
    
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

    private getManifestPath(sessionId: string): string {
        return `/${sessionId}.chat`;
    }

    // ============================================================
    // ILLMSessionEngine 实现
    // ============================================================

    async createSession(title: string, systemPrompt: string = "You are a helpful assistant."): Promise<string> {
        const sessionId = generateUUID();
        console.log(`createSession call: ${title} - id: ${sessionId}`);
        // 1. 创建隐藏数据目录: /.uuid/
        // 使用 moduleEngine 提供的接口，它会自动处理 parentId 逻辑
        // 但这里我们是在根目录下创建，可以直接用 vfs.createDirectory 或者 moduleEngine.createDirectory
        // 为了方便，直接调用底层 vfs.createDirectory (BaseModuleService 提供了 protected vfs)
        // 注意：vfs.createDirectory 接受的是相对于模块的路径
        await this.moduleEngine.createDirectory(this.getHiddenDir(sessionId),null);

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

        // 4. 创建文件并写入 Metadata (title, icon)
        const manifestPath = this.getManifestPath(sessionId);
        await this.moduleEngine.createFile(
            manifestPath,
            null,
            Yaml.stringify(manifest),
            { title: title, icon: '💬' } // Metadata 供 UI 列表显示
        );

        // 通知 UI 更新 (虽然 vfs 会发事件，但有时候为了业务层刷新列表)
        this.notify();

        return sessionId;
    }

    async getSessionContext(sessionId: string): Promise<ChatContextItem[]> {
        const manifest = await this.readJson<ChatManifest>(this.getManifestPath(sessionId));
        if (!manifest) throw new Error("Session not found");

        let currentNodeId: string | null = manifest.current_head;
        const context: ChatContextItem[] = [];

        // 反向遍历链表
        while (currentNodeId) {
            // 显式声明 node 类型，避免推断错误
            const node: ChatNode | null = await this.readJson<ChatNode>(this.getNodePath(sessionId, currentNodeId));
            if (!node) break;

            if (node.status === 'active') {
                context.unshift({ node });
            }
            currentNodeId = node.parent_id;
        }
        return context;
    }

    async getManifest(sessionId: string): Promise<ChatManifest> {
        const m = await this.readJson<ChatManifest>(this.getManifestPath(sessionId));
        if (!m) throw new Error("Manifest missing");
        return m;
    }

    // ============================================================================
    // 消息操作方法
    // ============================================================================

    async appendMessage(
        sessionId: string, 
        role: ChatNode['role'], 
        content: string, 
        meta: any = {}
    ): Promise<string> {
        const manifest = await this.readJson<ChatManifest>(this.getManifestPath(sessionId));
        if (!manifest) throw new Error("Manifest not found");

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
        await this.writeJson(this.getManifestPath(sessionId), manifest);

        return newNodeId;
    }

    /**
     * ✨ [核心方法] 原地更新节点内容（支持流式持久化）
     */
    async updateNode(
        sessionId: string, 
        nodeId: string, 
        updates: Partial<Pick<ChatNode, 'content' | 'meta' | 'status'>>
    ): Promise<void> {
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
    }

    async editMessage(sessionId: string, originalNodeId: string, newContent: string): Promise<string> {
        const manifest = await this.readJson<ChatManifest>(this.getManifestPath(sessionId));
        if (!manifest) throw new Error("Manifest not found");

        const originalNode = await this.readJson<ChatNode>(this.getNodePath(sessionId, originalNodeId));
        if (!originalNode) throw new Error("Original node not found");

        // 1. 创建新节点 (分支节点)
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
        
        await this.writeJson(this.getManifestPath(sessionId), manifest);
        
        return newNodeId;
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

    async switchBranch(sessionId: string, branchName: string): Promise<void> {
        const manifest = await this.readJson<ChatManifest>(this.getManifestPath(sessionId));
        if (!manifest || !manifest.branches[branchName]) throw new Error("Branch not found");
        
        manifest.current_branch = branchName;
        manifest.current_head = manifest.branches[branchName];
        await this.writeJson(this.getManifestPath(sessionId), manifest);
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
        const allNodes = await this.moduleEngine.loadTree();
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
        
        console.log(`[LLMSessionEngine] createFile: name="${name}", title="${title}"`);
        
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

    // 辅助转换方法
    private toEngineNode(vnode: VNode): EngineNode {
        return {
            id: vnode.nodeId,
            parentId: null, 
            name: vnode.name, // 物理文件名 (uuid.chat)
            type: 'file',
            createdAt: vnode.createdAt,
            modifiedAt: vnode.modifiedAt,
            path: vnode.path,
            tags: vnode.tags,
            // [关键] 传递 metadata，其中包含 title 和 icon
            metadata: vnode.metadata, 
            moduleId: this.moduleName,
            icon: vnode.metadata?.icon || 'chat-bubble' 
        };
    }

    // 拦截重命名操作
    async rename(id: string, newName: string): Promise<void> {
        // [修复] Code 2339: 使用 coreVfs.storage
        const node = await this.coreVfs.storage.loadVNode(id);
        if (!node) throw new Error("Node not found");

        const uuid = node.name.replace('.chat', '');

        // 1. 更新 Manifest 中的 title
        try {
            const manifest = await this.getManifest(uuid);
            manifest.title = newName;
            await this.writeJson(this.getManifestPath(uuid), manifest);
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

            // 1. 删除文件
            await this.moduleEngine.delete([node.path]);

            // 2. 删除关联目录
            if (node.name.endsWith('.chat')) {
                const uuid = node.name.replace('.chat', '');
                try {
                    await this.deleteFile(this.getHiddenDir(uuid));
                } catch (e) {
                    console.warn(`Failed to delete hidden dir for ${uuid}`, e);
                }
            }
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
    console.log(`[LLMSessionEngine] getSessionIdFromNodeId called with: ${nodeId}`);
        try {
            // 1. 加载 VNode 元数据
            const node = await this.coreVfs.storage.loadVNode(nodeId);
        console.log(`[LLMSessionEngine] VNode loaded:`, node ? {
            name: node.name,
            type: node.type,
            moduleId: node.moduleId
        } : 'null');
            if (!node) return null;
            
            // 2. 确保是 .chat 文件
        if (!node.name.endsWith('.chat')) {
            console.log(`[LLMSessionEngine] Not a .chat file: ${node.name}`);
            return null;
        }
            
            // 3. ✨ [关键] 读取文件内容获取 sessionId
            let content: string | ArrayBuffer | null = null;
            try {
                content = await this.moduleEngine.readContent(nodeId);
            console.log(`[LLMSessionEngine] Content read, length: ${
                content ? (typeof content === 'string' ? content.length : content.byteLength) : 0
            }`);
            } catch (e) {
                // 文件存在但读取失败（可能是权限问题或损坏）
                console.warn(`[LLMSessionEngine] Failed to read content for ${nodeId}:`, e);
                return null;
            }
            
            // 4. 检查内容是否有效
        if (!content) {
            console.log(`[LLMSessionEngine] No content in file`);
            return null;
        }
            
            const contentStr = typeof content === 'string' 
                ? content 
                : new TextDecoder().decode(content);
            
            // 5. 空文件返回 null（需要初始化）
        if (!contentStr.trim()) {
            console.log(`[LLMSessionEngine] Content is empty/whitespace`);
            return null;
        }
            
            // 6. 解析 manifest
            try {
                const manifest = JSON.parse(contentStr) as ChatManifest;
            console.log(`[LLMSessionEngine] Manifest parsed:`, {
                id: manifest?.id,
                version: manifest?.version,
                title: manifest?.title
            });
                
                // 验证必要字段
                if (!manifest || !manifest.id || !manifest.version) {
                console.log(`[LLMSessionEngine] Invalid manifest structure`);
                    return null;
                }
                
                // 7. ✨ [可选] 验证隐藏目录是否存在（确保数据完整）
                const hiddenDir = this.getHiddenDir(manifest.id);
                const hiddenDirId = await this.coreVfs.pathResolver.resolve(this.moduleName, hiddenDir);
            console.log(`[LLMSessionEngine] Hidden dir check: path=${hiddenDir}, exists=${!!hiddenDirId}`);
                
                if (!hiddenDirId) {
                console.warn(`[LLMSessionEngine] Session data directory missing for ${manifest.id}`);
                    // 数据目录不存在，视为无效 session
                    return null;
                }
                
            console.log(`[LLMSessionEngine] Session ID resolved: ${manifest.id}`);
                return manifest.id;
            } catch (e) {
                // JSON 解析失败，文件内容损坏
            console.warn(`[LLMSessionEngine] JSON parse failed:`, e);
                return null;
            }
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
    console.log(`[LLMSessionEngine] initializeExistingFile START: nodeId=${nodeId}, title=${title}`);
        
        // 1. 生成新的 sessionId
        const sessionId = generateUUID();
    console.log(`[LLMSessionEngine] Generated sessionId: ${sessionId}`);
        
    // 创建隐藏目录
    const hiddenDirPath = this.getHiddenDir(sessionId);
    console.log(`[LLMSessionEngine] Creating hidden dir: ${hiddenDirPath}`);
        try {
        await this.moduleEngine.createDirectory(hiddenDirPath, null);
        console.log(`[LLMSessionEngine] Hidden dir created`);
        } catch (e: any) {
        console.log(`[LLMSessionEngine] Hidden dir creation result:`, e.message);
            if (!e.message?.includes('exists')) {
                throw e;
            }
        }

        // 3. 创建根节点 (System Prompt)
        const rootNodeId = `node-${Date.now()}-root`;
    console.log(`[LLMSessionEngine] Creating root node: ${rootNodeId}`);
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
    console.log(`[LLMSessionEngine] Root node written`);

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

        // 5. ✨ [关键] 写入到已存在的文件节点
    console.log(`[LLMSessionEngine] Writing manifest to nodeId: ${nodeId}`);
        await this.moduleEngine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
    console.log(`[LLMSessionEngine] Manifest written`);
        
        // 6. 更新文件的 metadata（用于 UI 显示）
    console.log(`[LLMSessionEngine] Updating metadata`);
        await this.moduleEngine.updateMetadata(nodeId, {
            title: title,
            icon: '💬',
            sessionId: sessionId  // 额外冗余，方便后续快速访问
        });
    console.log(`[LLMSessionEngine] Metadata updated`);

    // 验证写入成功
    console.log(`[LLMSessionEngine] Verifying write...`);
    const verifyContent = await this.moduleEngine.readContent(nodeId);
    console.log(`[LLMSessionEngine] Verification read, content length: ${
        verifyContent ? (typeof verifyContent === 'string' ? verifyContent.length : (verifyContent as ArrayBuffer).byteLength) : 0
    }`);
        this.notify();
        
    console.log(`[LLMSessionEngine] initializeExistingFile COMPLETE: sessionId=${sessionId}`);
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

