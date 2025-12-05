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
        
        // 1. 创建隐藏数据目录: /.uuid/
        // 使用 moduleEngine 提供的接口，它会自动处理 parentId 逻辑
        // 但这里我们是在根目录下创建，可以直接用 vfs.createDirectory 或者 moduleEngine.createDirectory
        // 为了方便，直接调用底层 vfs.createDirectory (BaseModuleService 提供了 protected vfs)
        // 注意：vfs.createDirectory 接受的是相对于模块的路径
        await this.vfs.createDirectory(this.moduleName, this.getHiddenDir(sessionId));

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
        // 使用 moduleEngine.createFile 也可以，但这里为了利用 writeJson 的便捷性，
        // 我们需要手动 updateMetadata，或者直接调用 vfs.createFile
        const manifestPath = this.getManifestPath(sessionId);
        await this.vfs.createFile(
            this.moduleName,
            manifestPath,
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

    async appendMessage(sessionId: string, role: ChatNode['role'], content: string, meta: any = {}): Promise<string> {
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

        // 2. 更新父节点
        const parentNode = await this.readJson<ChatNode>(this.getNodePath(sessionId, parentId));
        if (parentNode) {
            if (!parentNode.children_ids) parentNode.children_ids = [];
            parentNode.children_ids.push(newNodeId);
            await this.writeJson(this.getNodePath(sessionId, parentId), parentNode);
        }

        // 3. 更新 Manifest
        manifest.current_head = newNodeId;
        manifest.branches[manifest.current_branch] = newNodeId;
        manifest.updated_at = new Date().toISOString();
        await this.writeJson(this.getManifestPath(sessionId), manifest);

        return newNodeId;
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
    
    // ✨ [实现] 原地更新节点内容
    async updateNode(sessionId: string, nodeId: string, updates: Partial<Pick<ChatNode, 'content' | 'meta' | 'status'>>): Promise<void> {
        const path = this.getNodePath(sessionId, nodeId);
        const node = await this.readJson<ChatNode>(path);
        if (!node) throw new Error(`Node ${nodeId} not found`);

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

    async getManifest(sessionId: string): Promise<ChatManifest> {
        const m = await this.readJson<ChatManifest>(this.getManifestPath(sessionId));
        if (!m) throw new Error("Manifest missing");
        return m;
    }


    // ============================================================
    // ISessionEngine Overrides (UI List Logic)
    // ============================================================

    async loadTree(): Promise<EngineNode[]> {
        // 使用 moduleEngine 获取原始树
        const allNodes = await this.moduleEngine.loadTree();
        // [修复] Code 7022: 显式指定参数类型
        return allNodes.filter((node: EngineNode) => 
            node.type === 'file' && node.name.endsWith('.chat')
        );
    }

    // --- Internal Helpers ---



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

    // 拦截创建文件操作 (来自 UI 的 New 按钮)
    async createFile(name: string, parentId: string | null, content?: string | ArrayBuffer): Promise<EngineNode> {
        const title = name || "New Chat";
        const sessionId = await this.createSession(title);
        
        // 返回 EngineNode 供 UI 选中
        const manifestPath = this.getManifestPath(sessionId);
        // [修复] Code 2339: 使用 coreVfs.pathResolver
        const nodeId = await this.coreVfs.pathResolver.resolve(this.moduleName, manifestPath);
        if (!nodeId) throw new Error("Failed to resolve created session node");
        
        return this.moduleEngine.getNode(nodeId) as Promise<EngineNode>;
    }

    // 删除逻辑
    async delete(ids: string[]): Promise<void> {
        for (const id of ids) {
            // [修复] Code 2339: 使用 coreVfs.storage
            const node = await this.coreVfs.storage.loadVNode(id);
            if (!node) continue;

            // 1. 删除文件
            await this.vfs.delete(this.moduleName, node.path);

            // 2. 删除关联目录
            if (node.name.endsWith('.chat')) {
                const uuid = node.name.replace('.chat', '');
                await this.deleteFile(this.getHiddenDir(uuid)); // vfs.delete 支持递归
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

    /*
        // 1. 手动将 EngineSearchQuery (通用层) 转换为 SearchQuery (VFS层)
        const vfsQuery: SearchQuery = {
            limit: query.limit,
            tags: query.tags,
            // 映射通用的 text 搜索到 nameContains
            // 注意：因为我们只改了 metadata.title 而没改文件名，
            // vfsCore 默认的 searchNodes 主要是搜 name。
            // 如果要搜 title，可能需要 vfsCore 支持 metadata 搜索或在此处做后处理。
            // 简单起见，这里假设搜文件名，或者 vfsCore 支持 metadata 搜索
            nameContains: query.text,
            type: query.type === 'file' ? VNodeType.FILE : 
                  query.type === 'directory' ? VNodeType.DIRECTORY : undefined,
            metadata: undefined 
        };

        // 2. 调用 VFS 搜索
        const results = await this.vfsCore.searchNodes(vfsQuery, this.moduleName);
        
        // 3. 过滤并转换结果
        return results
            .filter((n: VNode) => n.name.endsWith('.chat'))
            // 如果 vfsQuery 没搜到 metadata.title，这里可以在内存中二次过滤
            .filter((n: VNode) => {
                if (!query.text) return true;
                const title = n.metadata?.title || '';
                // 简单的内存补救搜索，以防 VFS 搜索未命中 metadata
                return n.name.includes(query.text) || title.includes(query.text); 
            })
            .map((n: VNode) => this.toEngineNode(n));
            */
    }

    // 其他代理方法
    async readContent(id: string): Promise<string | ArrayBuffer> { 
        return this.moduleEngine.readContent(id); 
    }
    
    async getNode(id: string): Promise<EngineNode | null> { 
        return this.moduleEngine.getNode(id); 
    }
    /**
     * 重写 createDirectory: 禁用在 UI 上创建文件夹
     */
    async createDirectory(name: string, parentId: string | null): Promise<EngineNode> {
        throw new Error("Chat list does not support sub-directories.");
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
