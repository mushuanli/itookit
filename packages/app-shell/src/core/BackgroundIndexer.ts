/**
 * @file app-shell/core/BackgroundIndexer.ts
 *
 * 后台文件索引器 — 监听文件变更，自动提取结构化元数据（标签、提及、任务数等）
 * 并写回文件 metadata，供搜索和侧边栏摘要使用。
 */
import { FileMentionSource } from '@itookit/vfs-ui';
import { MDxProcessor, ProcessResult } from '@itookit/mdxeditor';
import type { IModuleFS, FSEvent } from "@itookit/common";

interface NodeUpdatePayload {
    nodeId: string;
    path?: string;
    data?: {
        metadataOnly?: boolean;
        [key: string]: unknown;
    };
}

export class BackgroundIndexer {
    private processor: MDxProcessor;
    private isProcessing = false;
    private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private unsubscribe: (() => void) | null = null;

    constructor(private engine: IModuleFS, _activeRules: string[] = ['*']) {
        const fileProvider = new FileMentionSource({ engine: this.engine });
        // @ts-ignore
        this.processor = new MDxProcessor([fileProvider]);
    }

    public start() {
        console.log(`🔍 [BackgroundIndexer] Started`);
        this.unsubscribe = this.engine.driver.on('node:updated', this.handleNodeUpdate);
    }

    public stop() {
        this.unsubscribe?.();
        this.debounceTimers.forEach(clearTimeout);
        this.debounceTimers.clear();
        console.log(`🔍 [BackgroundIndexer] Stopped`);
    }

    private handleNodeUpdate = (event: FSEvent<'node:updated'>) => {
        const payload = event.payload as unknown as NodeUpdatePayload | null;

        if (!payload || !payload.nodeId) {
            return;
        }

        if (payload.data?.metadataOnly) {
            return;
        }

        const nodeId = payload.nodeId;

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
            const node = await this.engine.driver.getNode(nodeId);
            if (!node || node.type !== 'file') return;

            const lastAiScan = node.metadata?._ai_last_scan;
            const lastModified = node.modifiedAt;

            if (typeof lastAiScan === 'number' && lastAiScan >= lastModified) {
                return;
            }

            this.isProcessing = true;

            const content = await this.engine.driver.readContent(nodeId);
            if (typeof content !== 'string') return;

            const result: ProcessResult = await this.processor.process(content, {
                rules: {
                    'user': { action: 'keep', collectMetadata: true },
                    'tag': { action: 'keep', collectMetadata: true },
                    'file': { action: 'keep', collectMetadata: true },
                    '*': { action: 'keep' }
                }
            });

            const newMetadata: Record<string, unknown> = {
                ...(node.metadata || {}),
                ...result.metadata,
                _ai_last_scan: Date.now(),
                _ai_processed: true
            };

            await this.engine.driver.updateMetadata(nodeId, newMetadata);

            console.log(`🔍 [BackgroundIndexer] Indexed ${nodeId}`);

        } catch (e) {
            console.error('[BackgroundIndexer] Error:', e);
        } finally {
            this.isProcessing = false;
        }
    }
}
