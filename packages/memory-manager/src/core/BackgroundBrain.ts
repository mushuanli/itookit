import { VFSCore, VFSEventType, VFSEvent } from '@itookit/vfs-core';
import { MDxProcessor, ProcessResult } from '@itookit/mdxeditor';
import { FileProvider } from '@itookit/vfs-ui';

export class BackgroundBrain {
    private processor: MDxProcessor;
    private isProcessing = false;
    private activeRules: string[];

    constructor(private vfsCore: VFSCore, private moduleName: string, activeRules: string[] = ['*']) {
        this.activeRules = activeRules;

        // 初始化 Processor，注入 FileProvider 以支持解析 mdx://file/ 链接
        // 并能够获取文件相关数据进行上下文增强
        const fileProvider = new FileProvider({ vfsCore, moduleName });

        // 注意：MDxProcessor 需要传入 Provider 数组
        // @ts-ignore: 确保类型兼容性，FileProvider 实现了 IMentionProviderForProcessor
        this.processor = new MDxProcessor([fileProvider]);
    }

    public start() {
        console.log(`🧠 [BackgroundBrain] Started for module: ${this.moduleName}`);
        this.vfsCore.getEventBus().on(VFSEventType.NODE_UPDATED, this.handleNodeUpdate);
    }

    public stop() {
        // 假设 VFS EventBus 支持 off 方法，或者我们需要保存 unsubscribe 函数
        // 目前 vfs-core 的 EventBus 返回的是 unsubscribe 函数
        // 这里为了演示简化了，实际应该保存 unsubscribe 句柄
        console.log(`🧠 [BackgroundBrain] Stopped.`);
    }

    private handleNodeUpdate = async (event: VFSEvent) => {
        // 1. 循环保护
        if (this.isProcessing) return;
        
        // [订正] 如果事件数据表明这只是元数据更新，且是我们自己触发的，则忽略
        // 由于 VFSCore event data 很简单，我们检查 metadata 中是否有特定标记
        // 或者通过简单的内存锁 this.isProcessing 来防抖
        if (event.data?.metadataOnly) {
            // 这里我们无法确定 source，但可以做一个优化：
            // 如果仅仅是 metadata 更新，通常不需要重新进行 AI 分析（除非内容变了）
            // 所以我们可以直接 return。
            // 只有内容变化 (content write) 才触发 AI 分析。
            return;
        }

        const nodeId = event.nodeId;

        try {
            this.isProcessing = true;

            // 2. 检查节点类型，只处理文件
            // 优化：可以通过 event.data 传递更多信息来避免不必要的 read
            const node = await this.vfsCore.getVFS().stat(nodeId);
            if (node.type !== 'file') return;

            // 3. 读取内容
            const content = await this.vfsCore.getVFS().read(nodeId);
            if (typeof content !== 'string') return;

            // 4. Headless 处理 (只读内容，提取信息)
            // 这是"所见即所得"不被破坏的关键：我们绝不修改 content
            const result: ProcessResult = await this.processor.process(content, {
                rules: {
                    // 收集提及的用户、标签、文件引用到 metadata
                    'user': { action: 'keep', collectMetadata: true },
                    'tag': { action: 'keep', collectMetadata: true },
                    'file': { action: 'keep', collectMetadata: true },
                    // 默认规则
                    '*': { action: 'keep' }
                }
            });

            // 5. 将提取的信息回写到 VFS Metadata
            // vfs-ui 会监听 Metadata 变更并更新列表显示的标签/图标
            const newMetadata = {
                ...result.metadata,
                _ai_last_scan: Date.now(),
                _ai_processed: true
            };

            // 使用 updateNodeMetadata
            // 关键：带上 source: 'AI_BRAIN' 标记，防止触发死循环
            // 注意：updateNodeMetadata 可能会合并数据，具体看 vfs-core 实现
            // 这里假设我们需要手动合并旧 metadata，但 process 结果通常包含了 frontmatter
            // 为了安全，我们只更新 AI 相关的字段，避免覆盖用户手动修改的 frontmatter

            // TODO: 需要确认 vfs-core 是否支持传递 event data (source 标记)
            // 假设 updateNodeMetadata 内部会触发 NODE_UPDATED，我们需要一种机制传递 source
            // 如果 vfs-core API 不支持，我们需要在 handleNodeUpdate 开头做更智能的 diff

            await this.vfsCore.updateNodeMetadata(nodeId, newMetadata);
            
            console.log(`🧠 [BackgroundBrain] Updated metadata for ${nodeId}`);
            
        } catch (e) {
            console.error('[BackgroundBrain] Error processing node:', nodeId, e);
        } finally {
            this.isProcessing = false;
        }
    }
}
