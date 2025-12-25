/**
 * @file mdx/core/asset-helper.ts
 * @desc 统一处理附件目录解析逻辑，支持伴生目录和自定义目标目录
 */
import type { ISessionEngine } from '@itookit/common';

export interface AssetConfigOptions {
    /** 
     * 目标附件目录 ID
     * - specific ID: 存入指定目录
     * - './': 存入当前文档同级目录 (默认行为)
     */
    targetAttachmentDirectoryId?: string;

    /**
     * [新增] 路径生成策略 (决定插入 Markdown 的链接格式)
     * - 'protocol': 使用 @asset/filename (默认，适合 VFS 内部解析)
     * - 'relative': 使用 ./filename (适合标准 Markdown兼容)
     * - custom function: 自定义生成逻辑
     */
    pathStrategy?: 'protocol' | 'relative' | ((filename: string) => string);

    /**
     * [新增] 视图过滤器 (决定在管理器中显示哪些文件)
     * 默认会忽略 .json, .chat 等系统文件
     */
    viewFilter?: {
        // 白名单：只显示这些扩展名 (e.g. ['.png', '.jpg', '.pdf'])
        extensions?: string[];
        // 黑名单正则：排除匹配的文件 (e.g. /^\./ 排除点文件)
        excludePattern?: RegExp;
    };

    /**
     * [新增] 上传限制
     */
    uploadLimit?: {
        // 允许的 MIME 类型或扩展名
        accept?: string[]; 
        // 最大字节数
        maxSize?: number; 
    };
}

/**
 * 默认的视图过滤逻辑
 */
export function isAssetVisible(filename: string, filter?: AssetConfigOptions['viewFilter']): boolean {
    // 1. 默认安全策略：总是隐藏以 . 开头的系统文件 (除非显式白名单覆盖)
    if (filename.startsWith('.')) return false;

    // 2. 黑名单优先
    if (filter?.excludePattern && filter.excludePattern.test(filename)) {
        return false;
    }

    // 3. 白名单 (如果有定义，必须匹配)
    if (filter?.extensions && filter.extensions.length > 0) {
        const ext = '.' + filename.split('.').pop()?.toLowerCase();
        return filter.extensions.includes(ext);
    }

    // 4. 默认允许其他所有
    return true;
}

/**
 * 生成插入到 Markdown 的路径
 */
export function generateAssetPath(
    filename: string, 
    strategy: AssetConfigOptions['pathStrategy'] = 'protocol'
): string {
    if (typeof strategy === 'function') {
        return strategy(filename);
    }

    if (strategy === 'relative') {
        return `./${filename}`;
    }

    // Default 'protocol'
    return `@asset/${filename}`;
}

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
