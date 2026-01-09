/**
 * @file memory-manager/core/BackgroundBrain.ts
 */
import { FileMentionSource } from '@itookit/vfs-ui';
import { MDxProcessor, ProcessResult } from '@itookit/mdxeditor';
import type { ISessionEngine, EngineEvent } from '@itookit/common';

/**
 * 节点更新事件的 payload 类型
 */
interface NodeUpdatePayload {
    nodeId: string;
    path?: string;
    data?: {
        metadataOnly?: boolean;
        [key: string]: unknown;
    };
}

export class BackgroundBrain {
    private processor: MDxProcessor;
    private isProcessing = false;
    // 使用简单的防抖计时器
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private unsubscribe: (() => void) | null = null;

    // [修改] 接收 ISessionEngine 接口
    constructor(private engine: ISessionEngine, _activeRules: string[] = ['*']) {
        // [修改] 适配新的 MentionSource 签名
        const fileProvider = new FileMentionSource({ engine: this.engine });
        
        // @ts-ignore MDxProcessor 类型可能需要更新以匹配新的 Source 接口，此处暂忽略
        this.processor = new MDxProcessor([fileProvider]);
    }

    public start() {
        console.log(`🧠 [BackgroundBrain] Started.`);
        // [修改] 使用 engine.on 监听 'node:updated'
        this.unsubscribe = this.engine.on('node:updated', this.handleNodeUpdate);
    }

    public stop() {
        this.unsubscribe?.();
        this.debounceTimers.forEach(clearTimeout);
        this.debounceTimers.clear();
        console.log(`🧠 [BackgroundBrain] Stopped.`);
    }

    private handleNodeUpdate = (event: EngineEvent) => {
        // ✅ 类型断言：将 unknown 转为具体类型
        const payload = event.payload as NodeUpdatePayload | null;
        
        if (!payload || !payload.nodeId) {
            return;
        }

        // 如果更新事件仅仅是元数据变更，忽略此次事件，防止死循环
        if (payload.data?.metadataOnly) {
            return;
        }

        const nodeId = payload.nodeId;

        // 防抖：如果在 2秒内连续触发，只处理最后一次
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
            // [修改] 使用 engine API
            const node = await this.engine.getNode(nodeId);
            if (!node || node.type !== 'file') return;

            // 3. 检查是否需要处理 (防止死循环)
            // 如果最近一次更新是我们自己 (AI) 触发的，且距离现在很近，则跳过
            const lastAiScan = node.metadata?._ai_last_scan;
            const lastModified = node.modifiedAt; // 已经是 number (timestamp)
            
            // 如果 AI 扫描时间比文件最后修改时间还晚，说明内容没变，只是 metadata 变了
            // 或者这次变更就是 AI 写入 metadata 导致的
            if (typeof lastAiScan === 'number' && lastAiScan >= lastModified) {
                return; 
            }

            this.isProcessing = true;
            
            const content = await this.engine.readContent(nodeId);
            if (typeof content !== 'string') return;

            const result: ProcessResult = await this.processor.process(content, {
                rules: {
                    'user': { action: 'keep', collectMetadata: true },
                    'tag': { action: 'keep', collectMetadata: true },
                    'file': { action: 'keep', collectMetadata: true },
                    '*': { action: 'keep' }
                }
            });

            // 更新元数据
            const newMetadata: Record<string, unknown> = {
                ...(node.metadata || {}),
                ...result.metadata,
                _ai_last_scan: Date.now(),
                _ai_processed: true
            };

            // [修改] 使用 engine 更新元数据
            await this.engine.updateMetadata(nodeId, newMetadata);
            
            console.log(`🧠 [BackgroundBrain] Processed ${nodeId}`);
            
        } catch (e) {
            console.error('[BackgroundBrain] Error:', e);
        } finally {
            this.isProcessing = false;
        }
    }
}
