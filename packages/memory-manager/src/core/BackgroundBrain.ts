/**
 * @file src/core/BackgroundBrain.ts
 */
import { VFSCore, VFSEventType, VFSEvent } from '@itookit/vfs-core';
import { MDxProcessor, ProcessResult } from '@itookit/mdxeditor';
import { FileProvider } from '@itookit/vfs-ui';

export class BackgroundBrain {
    private processor: MDxProcessor;
    private isProcessing = false;
    // 使用简单的防抖计时器
    private debounceTimers = new Map<string, any>();
    private unsubscribe: (() => void) | null = null;

    constructor(private vfsCore: VFSCore, private moduleName: string, activeRules: string[] = ['*']) {
        const fileProvider = new FileProvider({ vfsCore, moduleName });
        // @ts-ignore
        this.processor = new MDxProcessor([fileProvider]);
    }

    public start() {
        console.log(`🧠 [BackgroundBrain] Started for module: ${this.moduleName}`);
        this.unsubscribe = this.vfsCore.getEventBus().on(VFSEventType.NODE_UPDATED, this.handleNodeUpdate);
    }

    public stop() {
        this.unsubscribe?.();
        this.debounceTimers.forEach(clearTimeout);
        this.debounceTimers.clear();
        console.log(`🧠 [BackgroundBrain] Stopped.`);
    }

    private handleNodeUpdate = (event: VFSEvent) => {
        const nodeId = event.nodeId;

        // 1. 防抖：如果在 2秒内连续触发 (例如用户正在打字)，只处理最后一次
        if (this.debounceTimers.has(nodeId)) {
            clearTimeout(this.debounceTimers.get(nodeId));
        }

        this.debounceTimers.set(nodeId, setTimeout(async () => {
            this.debounceTimers.delete(nodeId);
            await this.processNode(nodeId);
        }, 2000));
    }

    private async processNode(nodeId: string) {
        if (this.isProcessing) return;

        try {
            // 2. 获取节点状态
            const node = await this.vfsCore.getVFS().stat(nodeId);
            if (node.type !== 'file') return;

            // 3. 检查是否需要处理 (防止死循环)
            // 如果最近一次更新是我们自己 (AI) 触发的，且距离现在很近，则跳过
            const lastAiScan = node.metadata?._ai_last_scan;
            const lastModified = new Date(node.modifiedAt).getTime();
            
            // 如果 AI 扫描时间比文件最后修改时间还晚，说明内容没变，只是 metadata 变了
            // 或者这次变更就是 AI 写入 metadata 导致的
            if (lastAiScan && lastAiScan >= lastModified) {
                return; 
            }

            this.isProcessing = true;
            
            // 4. 读取内容并处理
            const content = await this.vfsCore.getVFS().read(nodeId);
            if (typeof content !== 'string') return;

            const result: ProcessResult = await this.processor.process(content, {
                rules: {
                    'user': { action: 'keep', collectMetadata: true },
                    'tag': { action: 'keep', collectMetadata: true },
                    'file': { action: 'keep', collectMetadata: true },
                    '*': { action: 'keep' }
                }
            });

            // 5. 更新元数据
            const newMetadata = {
                ...node.metadata, // 必须合并现有 metadata
                ...result.metadata,
                _ai_last_scan: Date.now(),
                _ai_processed: true
            };

            // 注意：updateNodeMetadata 不会改变 modifiedAt (通常是文件内容变才改)
            // 但如果 vfs-core 实现中 metadata 改变也会触发 NODE_UPDATED，
            // 上面的 lastAiScan >= lastModified 检查至关重要。
            await this.vfsCore.updateNodeMetadata(nodeId, newMetadata);
            
            console.log(`🧠 [BackgroundBrain] Processed ${nodeId}`);
            
        } catch (e) {
            console.error('[BackgroundBrain] Error:', e);
        } finally {
            this.isProcessing = false;
        }
    }
}
