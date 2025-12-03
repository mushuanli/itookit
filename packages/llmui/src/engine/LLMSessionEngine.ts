// @file core/llm/LLMSessionEngine.ts

import { VFSCore, VNode, VNodeType,SearchQuery } from '@itookit/vfs-core';
import { 
    ISessionEngine, EngineNode, EngineSearchQuery, EngineEvent, EngineEventType,
    generateUUID,
    ILLMSessionEngine, ChatContextItem,
    ChatManifest, ChatNode, IYamlParser
} from '@itookit/common';

// 简单的 YAML Mock，实际项目中应替换为 js-yaml 或类似库
const Yaml: IYamlParser = {
    parse: (t) => JSON.parse(t), // 暂用 JSON 模拟，实际请换成 YAML.parse
    stringify: (o) => JSON.stringify(o, null, 2)
};

export class LLMSessionEngine implements ILLMSessionEngine {
    constructor(
        private vfsCore: VFSCore,
        private moduleName: string
    ) {}

    private get vfs() { return this.vfsCore.getVFS(); }
    private get pathResolver() { return this.vfs.pathResolver; }

    //Helper to get file path for a node inside the hidden directory
    private getNodePath(sessionUuid: string, nodeId: string): string {
        // e.g., /.550e-8400/.msg-node-123.yaml
        return `/.${sessionUuid}/.${nodeId}.yaml`;
    }

    private getManifestPath(sessionUuid: string): string {
        // e.g., /550e-8400.chat
        return `/${sessionUuid}.chat`;
    }

    // ============================================================
    // LLM Specific Implementation
    // ============================================================

    async createSession(title: string, systemPrompt: string = "You are a helpful assistant."): Promise<string> {
        const sessionId = generateUUID(); // e.g. "550e-8400"
        
        // 1. 创建隐藏数据目录: /.550e-8400/
        // 注意：VFS createDirectory 使用的是相对 module 的路径
        const hiddenDirName = `.${sessionId}`;
        await this.vfsCore.createDirectory(this.moduleName, `/${hiddenDirName}`);

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
        
        await this.vfsCore.createFile(
            this.moduleName, 
            `/${hiddenDirName}/.${rootNodeId}.yaml`, 
            Yaml.stringify(rootNode)
        );

        // 3. 创建 Manifest 文件: /550e-8400.chat
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

        // [关键] 写入文件时，同时将 title 写入 VNode Metadata
        // 这允许 vfs-ui 列表快速加载标题，而无需读取文件内容
        await this.vfsCore.createFile(
            this.moduleName,
            `/${sessionId}.chat`,
            Yaml.stringify(manifest),
            { title: title, icon: '💬' } 
        );

        return sessionId;
    }

    async getSessionContext(sessionId: string): Promise<ChatContextItem[]> {
        const manifest = await this.getManifest(sessionId);
        let currentNodeId: string | null = manifest.current_head;
        const context: ChatContextItem[] = [];

        // 反向遍历链表
        while (currentNodeId) {
            const node = await this.loadNode(sessionId, currentNodeId);
            if (!node) break; // Should not happen in healthy data
            
            if (node.status === 'active') {
                context.unshift({ node }); // Prepend to maintain chronological order
            }
            currentNodeId = node.parent_id;
        }
        return context;
    }

    async appendMessage(sessionId: string, role: ChatNode['role'], content: string, meta: any = {}): Promise<string> {
        const manifest = await this.getManifest(sessionId);
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

        // 1. 写入新节点文件
        await this.saveNode(sessionId, newNode);

        // 2. 更新父节点的 children (Optional but good for traversal)
        const parentNode = await this.loadNode(sessionId, parentId);
        if (parentNode) {
            if (!parentNode.children_ids) parentNode.children_ids = [];
            parentNode.children_ids.push(newNodeId);
            await this.saveNode(sessionId, parentNode);
        }

        // 3. 更新 Manifest 指针
        manifest.current_head = newNodeId;
        manifest.branches[manifest.current_branch] = newNodeId;
        manifest.updated_at = new Date().toISOString();
        await this.saveManifest(sessionId, manifest);

        return newNodeId;
    }

    // ✨ [实现] 原地更新节点内容
    async updateNode(sessionId: string, nodeId: string, updates: Partial<Pick<ChatNode, 'content' | 'meta' | 'status'>>): Promise<void> {
        const node = await this.loadNode(sessionId, nodeId);
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
            await this.saveNode(sessionId, node);
        }
    }

    async editMessage(sessionId: string, originalNodeId: string, newContent: string): Promise<string> {
        const manifest = await this.getManifest(sessionId);
        const originalNode = await this.loadNode(sessionId, originalNodeId);
        if (!originalNode) throw new Error("Node not found");

        // 1. 创建新节点 (分支节点)
        const newNodeId = generateUUID();
        const newNode: ChatNode = {
            ...originalNode,
            id: newNodeId,
            content: newContent,
            created_at: new Date().toISOString(),
            children_ids: [] // 新分支暂无子节点
            // parent_id 保持不变，指向同一个父亲
        };

        await this.saveNode(sessionId, newNode);

        // 2. 更新父节点添加新的 child
        if (newNode.parent_id) {
            const parent = await this.loadNode(sessionId, newNode.parent_id);
            if (parent) {
                parent.children_ids.push(newNodeId);
                await this.saveNode(sessionId, parent);
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
        
        await this.saveManifest(sessionId, manifest);
        
        return newNodeId;
    }

    async deleteMessage(sessionId: string, nodeId: string): Promise<void> {
        const node = await this.loadNode(sessionId, nodeId);
        if (node) {
            node.status = 'deleted';
            await this.saveNode(sessionId, node);
        }
    }
    
    async switchBranch(sessionId: string, branchName: string): Promise<void> {
        const manifest = await this.getManifest(sessionId);
        if (!manifest.branches[branchName]) throw new Error("Branch not found");
        
        manifest.current_branch = branchName;
        manifest.current_head = manifest.branches[branchName];
        await this.saveManifest(sessionId, manifest);
    }

    async getNodeSiblings(sessionId: string, nodeId: string): Promise<ChatNode[]> {
        const node = await this.loadNode(sessionId, nodeId);
        if (!node || !node.parent_id) return node ? [node] : [];
        
        const parent = await this.loadNode(sessionId, node.parent_id);
        if (!parent) return [node];

        const siblings = await Promise.all(
            parent.children_ids.map(id => this.loadNode(sessionId, id))
        );
        return siblings.filter((n): n is ChatNode => n !== null);
    }

    async getManifest(sessionId: string): Promise<ChatManifest> {
        const content = await this.vfsCore.read(this.moduleName, this.getManifestPath(sessionId));
        return Yaml.parse<ChatManifest>(content as string);
    }

    // --- Internal Helpers ---

    private async loadNode(sessionId: string, nodeId: string): Promise<ChatNode | null> {
        try {
            const path = this.getNodePath(sessionId, nodeId);
            const content = await this.vfsCore.read(this.moduleName, path);
            return Yaml.parse<ChatNode>(content as string);
        } catch (e) {
            console.warn(`Failed to load node ${nodeId}`, e);
            return null;
        }
    }

    private async saveNode(sessionId: string, node: ChatNode): Promise<void> {
        const path = this.getNodePath(sessionId, node.id);
        await this.vfsCore.write(this.moduleName, path, Yaml.stringify(node));
    }

    private async saveManifest(sessionId: string, manifest: ChatManifest): Promise<void> {
        const path = this.getManifestPath(sessionId);
        await this.vfsCore.write(this.moduleName, path, Yaml.stringify(manifest));
    }


    // ============================================================
    // ISessionEngine Implementation (Bridge to VFS for UI List)
    // ============================================================

    async loadTree(): Promise<EngineNode[]> {
        // 我们只返回 .chat 文件作为会话列表
        // 底层的隐藏目录 .uuid/ 应该被过滤掉
        
        const internalNodes = await this.vfsCore.getTree(this.moduleName, '/');
        
        return internalNodes
            .filter(node => node.name.endsWith('.chat') && node.type === VNodeType.FILE)
            .map(node => this.toEngineNode(node));
    }

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
        // [策略] 只更新 Metadata 和 Manifest，不改物理文件名 (UUID)
        // 这样可以保持引用的绝对稳定性

        // 1. 获取节点信息
        const node = await this.vfs.storage.loadVNode(id);
        if (!node) throw new Error("Node not found");

        // 2. 解析 UUID (假设文件名为 uuid.chat)
        const uuid = node.name.replace('.chat', '');

        // 3. 更新 Manifest 文件内容 (持久化标题)
        try {
            const manifest = await this.getManifest(uuid);
            manifest.title = newName; // newName 通常是不带后缀的显示名
            await this.saveManifest(uuid, manifest);
        } catch (e) {
            console.warn("Failed to update manifest title during rename", e);
        }

        // 4. 更新 VNode Metadata (这会让 vfs-ui 列表立即刷新显示新标题)
        // 这一步是关键，它使得 UI 显示的名字改变，但底层文件名不变
        await this.vfsCore.updateNodeMetadata(id, {
            ...node.metadata,
            title: newName
        });
        
        // 注意：不调用 vfsCore.rename()，物理文件名保持 uuid.chat
    }

    // 拦截创建文件操作 (来自 UI 的 New 按钮)
    async createFile(name: string, parentId: string | null, content?: string | ArrayBuffer): Promise<EngineNode> {
        // vfs-ui 传入的 name 可能是 "New Chat" 或 "Untitled"
        const title = name || "New Chat";
        
        // 转为创建会话
        const sessionId = await this.createSession(title);
        
        // 返回创建好的节点供 UI 选中
        const manifestPath = this.getManifestPath(sessionId);
        // 需要使用 pathResolver 解析出 NodeId
        // 注意：这里 manifestPath 是用户态路径 "/uuid.chat"
        const nodeId = await this.vfs.pathResolver.resolve(this.moduleName, manifestPath);
        if (!nodeId) throw new Error("Created session node not found");
        
        const node = await this.vfs.storage.loadVNode(nodeId);
        return this.toEngineNode(node!);
    }

    // 删除逻辑
    async delete(ids: string[]): Promise<void> {
        for (const id of ids) {
            const node = await this.vfs.storage.loadVNode(id);
            if (!node) continue;
            
            // 1. 删除 .chat 文件
            await this.vfsCore.delete(this.moduleName, node.path);
            
            // 2. 清理关联的隐藏目录
            if (node.name.endsWith('.chat')) {
                const uuid = node.name.replace('.chat', '');
                const hiddenDirPath = `/.${uuid}`;
                try {
                    await this.vfsCore.delete(this.moduleName, hiddenDirPath, true);
                } catch (e) {
                    console.warn(`Failed to clean up data directory for ${uuid}`, e);
                }
            }
        }
    }

    async search(query: EngineSearchQuery): Promise<EngineNode[]> {
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
            .filter(n => n.name.endsWith('.chat'))
            // 如果 vfsQuery 没搜到 metadata.title，这里可以在内存中二次过滤
            .filter(n => {
                if (!query.text) return true;
                const title = n.metadata?.title || '';
                // 简单的内存补救搜索，以防 VFS 搜索未命中 metadata
                return n.name.includes(query.text) || title.includes(query.text); 
            })
            .map(n => this.toEngineNode(n));
    }

    // 其他代理方法
    async readContent(id: string): Promise<string | ArrayBuffer> {
        return this.vfs.read(id);
    }
    async getNode(id: string): Promise<EngineNode | null> {
        const vnode = await this.vfs.storage.loadVNode(id);
        return vnode ? this.toEngineNode(vnode) : null;
    }
    async createDirectory(name: string, parentId: string | null): Promise<EngineNode> {
        throw new Error("Folders not supported in flat chat list.");
    }
    
    async writeContent(id: string, content: string | ArrayBuffer): Promise<void> {
        await this.vfs.write(id, content);
    }
    
    async move(ids: string[], targetParentId: string | null): Promise<void> {
         await this.vfsCore.batchMoveNodes(this.moduleName, ids, targetParentId);
    }
    
    async updateMetadata(id: string, metadata: Record<string, any>): Promise<void> {
        await this.vfsCore.updateNodeMetadata(id, metadata);
    }
    
    async setTags(id: string, tags: string[]): Promise<void> {
        await this.vfsCore.setNodeTagsById(id, tags);
    }
    async setTagsBatch(updates: Array<{ id: string; tags: string[] }>): Promise<void> {
        await this.vfsCore.batchSetNodeTags(updates.map(u => ({ nodeId: u.id, tags: u.tags })));
    }
    
    // Stub for getAllTags - optional but good to have
    async getAllTags(): Promise<Array<{ name: string; color?: string }>> {
        const tags = await this.vfsCore.getAllTags();
        return tags.map(t => ({ name: t.name, color: t.color }));
    }

    on(event: EngineEventType, callback: (event: EngineEvent) => void): () => void {
        return this.vfs.events.on(event as any, (e) => callback(e as any));
    }
}
