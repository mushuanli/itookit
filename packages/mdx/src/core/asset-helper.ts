/**
 * @file mdx/core/asset-helper.ts
 * @desc 资产处理辅助函数库。移除了目录ID解析逻辑，专注于配置和字符串处理。
 */

export interface AssetConfigOptions {
    /**
     * 视图过滤器 (决定在管理器中显示哪些文件)
     * 默认会忽略 .json, .chat 等系统文件
     */
    viewFilter?: {
        /** 白名单：只显示这些扩展名 (e.g. ['.png', '.jpg', '.pdf']) */
        extensions?: string[];
        /** 黑名单正则：排除匹配的文件 (e.g. /^\./ 排除点文件) */
        excludePattern?: RegExp;
    };

    /**
     * 上传限制
     */
    uploadLimit?: {
        /** 允许的 MIME 类型或扩展名 */
        accept?: string[]; 
        /** 最大字节数 */
        maxSize?: number; 
    };
}

/**
 * 默认上传限制
 */
export const DEFAULT_UPLOAD_LIMITS = {
    maxSize: 10 * 1024 * 1024, // 10MB
    accept: [
        'image/*', 
        'application/pdf', 
        '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', 
        '.txt', '.md', '.json', '.svg'
    ],
} as const;

/**
 * 默认的视图过滤逻辑
 */
export function isAssetVisible(filename: string, filter?: AssetConfigOptions['viewFilter']): boolean {
    // 1. 默认安全策略：总是隐藏以 . 开头的系统文件
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
 * 生成插入到 Markdown 的标准路径
 * 强制使用 @asset/ 协议，由 AssetResolverPlugin 解析
 */
export function generateAssetPath(filename: string): string {
    return `@asset/${filename}`;
}

/**
 * 从路径中提取文件名
 * 支持 @asset/filename, ./filename 等格式
 */
export function extractFilenameFromPath(path: string): string {
    let cleanPath = path;
    
    if (cleanPath.startsWith('@asset/')) {
        cleanPath = cleanPath.slice(7);
    } else if (cleanPath.startsWith('./')) {
        cleanPath = cleanPath.slice(2);
    }
    
    // 处理 URL 参数
    return cleanPath.split('?')[0].split('#')[0].split('/').pop() || cleanPath;
}

/**
 * 获取标准化的上传限制配置
 */
export function getUploadLimits(options: AssetConfigOptions): {
    maxSize: number;
    accept: string[];
} {
    return {
        maxSize: options.uploadLimit?.maxSize ?? DEFAULT_UPLOAD_LIMITS.maxSize,
        accept: options.uploadLimit?.accept ?? [...DEFAULT_UPLOAD_LIMITS.accept],
    };
}

/**
 * 验证文件是否符合上传限制
 */
export function validateFile(file: File, limits: { maxSize: number, accept: string[] }): { valid: boolean; error?: string } {
    // 1. 检查大小
    if (file.size > limits.maxSize) {
        const sizeMB = (limits.maxSize / (1024 * 1024)).toFixed(1);
        return { valid: false, error: `文件大小超过限制 (${sizeMB}MB)` };
    }

    // 2. 检查类型
    const fileName = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();
    
    // 如果 accept 为空，允许所有
    if (!limits.accept || limits.accept.length === 0) return { valid: true };

    const isAccepted = limits.accept.some(rule => {
        const r = rule.toLowerCase().trim();
        if (r.startsWith('.')) {
            // 扩展名匹配
            return fileName.endsWith(r);
        } else if (r.endsWith('/*')) {
            // 通配符 MIME 匹配
            const prefix = r.slice(0, -2);
            return fileType.startsWith(prefix);
        } else {
            // 精确 MIME 匹配
            return fileType === r;
        }
    });

    if (!isAccepted) {
        return { valid: false, error: '不支持的文件类型' };
    }

    return { valid: true };
}