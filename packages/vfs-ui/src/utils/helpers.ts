/**
 * @file vfs-ui/utils/helpers.ts
 * @desc Shared utility functions
 */

/** 判断是否为隐藏文件 */
export const isHiddenFile = (name: string): boolean =>
    name.startsWith('.') || name.startsWith('__');

/** 判断节点是否应该被过滤 */
export const shouldFilterNode = (node: { name: string; moduleId?: string; path?: string }): boolean => {
    if (node.moduleId && isHiddenFile(node.moduleId)) return true;
    if (node.path?.split('/').some(isHiddenFile)) return true;
    return isHiddenFile(node.name);
};

/** 移除文件扩展名 */
export const stripExtension = (name: string): string => {
    const lastDot = name.lastIndexOf('.');
    return lastDot > 0 ? name.substring(0, lastDot) : name;
};

/** 获取文件扩展名 */
export const getExtension = (filename: string): string => {
    const lastDot = filename.lastIndexOf('.');
    return lastDot > 0 ? filename.substring(lastDot).toLowerCase() : '';
};

/** 格式化相对时间 */
export const formatRelativeTime = (timestamp: string | undefined): string => {
    if (!timestamp) return '';
    try {
        const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
        if (seconds < 60) return "刚刚";
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}分钟前`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}小时前`;
        return `${Math.floor(hours / 24)}天前`;
    } catch {
        return '';
    }
};

/** 递归查找节点 */
export const findNodeById = <T extends { id: string; children?: T[] }>(
    items: T[],
    id: string
): T | undefined => {
    for (const item of items) {
        if (item.id === id) return item;
        if (item.children) {
            const found = findNodeById(item.children, id);
            if (found) return found;
        }
    }
    return undefined;
};

/** 递归遍历节点 */
export const traverseNodes = <T extends { children?: T[] }>(
    items: T[],
    callback: (item: T) => void
): void => {
    for (const item of items) {
        callback(item);
        if (item.children) traverseNodes(item.children, callback);
    }
};
