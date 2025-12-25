/**
 * @file mdx/core/asset-helper.ts
 * @desc 统一处理附件目录解析逻辑，支持伴生目录和自定义目标目录
 */
import type { ISessionEngine } from '@itookit/common';

export interface AssetConfigOptions {
    /** 
     * 指定附件存储的目标目录 ID 或相对路径 ('./')。
     * 如果设置了此项，将覆盖默认的“伴生目录”逻辑。
     * - ID: 直接使用该目录 ID
     * - './': 使用当前编辑文件所在的目录 (parentId)
     */
    targetAttachmentDirectoryId?: string;
}

/**
 * 统一解析附件目录 ID
 * @param engine 会话引擎
 * @param currentNodeId 当前编辑的节点 ID
 * @param options 配置选项
 * @returns 解析出的目录 ID，如果无法解析则返回 null
 */
export async function resolveAssetDirectory(
    engine: ISessionEngine,
    currentNodeId: string | undefined,
    options: AssetConfigOptions
): Promise<string | null> {
    if (!currentNodeId) return null;

    // 1. 如果配置了目标目录 (覆盖默认行为)
    if (options.targetAttachmentDirectoryId) {
        // 1.1 处理相对路径 './' -> 当前文件所在的目录
        if (options.targetAttachmentDirectoryId === './') {
            const currentNode = await engine.getNode(currentNodeId);
            // 如果是文件，返回其父目录；如果是目录，返回它自己(虽然editor一般只编辑文件)
            return currentNode ? currentNode.parentId : null;
        }
        
        // 1.2 处理绝对 ID (假设传入的就是 ID)
        return options.targetAttachmentDirectoryId;
    }

    // 2. 默认逻辑：使用 Engine 提供的伴生目录逻辑 (通常是 .filename 目录)
    if (engine.getAssetDirectoryId) {
        return await engine.getAssetDirectoryId(currentNodeId);
    }

    return null;
}
