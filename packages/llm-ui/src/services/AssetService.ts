// @file: llm-ui/services/AssetService.ts

import { IChatEngine } from '@itookit/llm-engine';

/**
 * 资源管理服务
 * 职责：附件的上传、获取、管理
 */
export class AssetService {
    constructor(private engine: IChatEngine) { }

    /**
     * 创建资源
     */
    async createAsset(ownerNodeId: string, fileName: string, data: ArrayBuffer): Promise<void> {
        await this.engine.createAsset(ownerNodeId, fileName, data);
    }

    /**
     * 获取资源目录 ID
     */
    async getAssetDirectoryId(ownerNodeId: string): Promise<string | null> {
        return await this.engine.getAssetDirectoryId(ownerNodeId);
    }

    /**
     * 批量上传文件并返回 Markdown 引用
     */
    async uploadFiles(ownerNodeId: string, files: File[]): Promise<string[]> {
        const refs: string[] = [];

        for (const file of files) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                await this.createAsset(ownerNodeId, file.name, arrayBuffer);

                console.log(`[AssetService] Asset saved: ${file.name}`);

                const isImage = file.type.startsWith('image/');
                const ref = isImage
                    ? `![${file.name}](@asset/${file.name})`
                    : `[📄 ${file.name}](@asset/${file.name})`;

                refs.push(ref);
            } catch (e) {
                console.error(`[AssetService] Failed to upload ${file.name}:`, e);
                throw new Error(`Failed to upload ${file.name}`);
            }
        }

        return refs;
    }
}
