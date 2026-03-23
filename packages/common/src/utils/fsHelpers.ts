/**
 * @file common/utils/fsHelpers.ts
 * @desc IModuleFS 便利函数
 *
 * 基于核心接口方法组合实现，不属于接口契约。
 * 消费方直接 import 使用，无需后端额外实现。
 */

import type { IModuleFS, FSNode, IFSTransaction } from '../interfaces/fs';
import { CONFIG_MODULE } from '../interfaces/fs';

const DEV_MODULE = '__dev';
const SYSTEM_DIRS = {
    CONFIG: '/__config',
    DEV: '/dev',
    MODULE: '/module',
} as const;

/**
 * 检查路径是否存在
 * 替代原 IModuleFS.pathExists
 */
export async function pathExists(
    fs: IModuleFS,
    path: string
): Promise<boolean> {
    return (await fs.resolvePath(path)) !== null;
}

/**
 * 加载完整节点树
 * 替代原 IModuleFS.loadTree
 *
 * 优先使用 walkTree（流式，内存友好），
 * 降级为 getChildren 递归。
 */
export async function loadTree(
    fs: IModuleFS,
    rootIdOrPath: string = '/'
): Promise<FSNode[]> {
    const nodes: FSNode[] = [];

    if (fs.walkTree) {
        await fs.walkTree((node) => {
            nodes.push(node);
        }, { rootIdOrPath });
        return nodes;
    }

    // 降级：递归 getChildren
    async function collect(parentIdOrPath: string) {
        const children = await fs.getChildren(parentIdOrPath);
        for (const child of children) {
            nodes.push(child);
            if (child.type === 'directory') {
                await collect(child.id);
            }
        }
    }
    await collect(rootIdOrPath);
    return nodes;
}

/**
 * 分页获取子节点
 * 替代原 IModuleFS.getChildrenPaged
 */
export async function getChildrenPaged(
    fs: IModuleFS,
    idOrPath: string,
    offset: number,
    limit: number,
    sortBy: 'name' | 'modifiedAt' | 'createdAt' = 'name'
): Promise<{
    nodes: FSNode[];
    total: number;
    hasMore: boolean;
}> {
    const all = await fs.getChildren(idOrPath);

    // 排序
    const sorted = [...all].sort((a, b) => {
        let cmp: number;
        switch (sortBy) {
            case 'name':
                cmp = a.name.localeCompare(b.name);
                break;
            case 'modifiedAt':
                cmp = b.modifiedAt - a.modifiedAt;
                break;
            case 'createdAt':
                cmp = b.createdAt - a.createdAt;
                break;
        }
        // 二级排序：id 保证分页稳定性
        return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
    });

    const sliced = sorted.slice(offset, offset + limit);

    return {
        nodes: sliced,
        total: all.length,
        hasMore: offset + limit < all.length,
    };
}

/**
 * 获取节点的所有资产文件
 * 替代原 IAssetOperations.getAssets（可选方法）
 */
export async function getAssets(
    fs: IModuleFS,
    ownerIdOrPath: string
): Promise<FSNode[]> {
    // 优先用资产子接口的专用方法
    if (fs.assets) {
        const dirId = await fs.assets.getAssetDirectoryId(ownerIdOrPath);
        if (!dirId) return [];
        return fs.getChildren(dirId);
    }
    return [];
}

/**
 * 安全执行事务（不支持时自动降级）
 */
export async function withTransaction<T>(
    fs: IModuleFS,
    fn: (tx: IFSTransaction) => Promise<T>
): Promise<T> {
    if (fs.capabilities.transaction && fs.transaction) {
        return fs.transaction(fn);
    }
    const passthrough: IFSTransaction = {
        getNode: (id) => fs.getNode(id),
        readContent: (id, opts) => fs.readContent(id, opts),
        createFile: (opts) => fs.createFile(opts),
        createDirectory: (opts) => fs.createDirectory(opts),
        writeContent: (id, c, opts) => fs.writeContent(id, c, opts),
        rename: (id, name) => fs.rename(id, name),
        move: (ids, target) => fs.move(ids, target),
        delete: (ids) => fs.delete(ids),
        updateMetadata: (id, meta) => fs.updateMetadata(id, meta),
    };
    return fn(passthrough);
}


// ═══════════════════════════════════════════════════════════════
// 路径基础操作
// ═══════════════════════════════════════════════════════════════

export interface ParsedPath {
    dir: string;
    base: string;
    name: string;
    ext: string;
}

export function normalizePath(innerPath: string): string {
    if (!innerPath || innerPath === '/') return '/';
    const withLeadingSlash = innerPath.startsWith('/')
        ? innerPath
        : '/' + innerPath;
    const parts = withLeadingSlash.split('/').filter((p) => p.length > 0);
    const resolved: string[] = [];
    for (const part of parts) {
        if (part === '.') continue;
        else if (part === '..') resolved.pop();
        else resolved.push(part);
    }
    return '/' + resolved.join('/') || '/';
}

export function joinPath(...segments: string[]): string {
    if (segments.length === 0) return '/';
    const joined = segments
        .map((s, i) => {
            if (i === 0) return s.replace(/\/+$/, '');
            return s.replace(/^\/+|\/+$/g, '');
        })
        .filter((s) => s.length > 0)
        .join('/');
    return normalizePath(joined || '/');
}

export function parsePath(innerPath: string): ParsedPath {
    const normalized = normalizePath(innerPath);
    if (normalized === '/') {
        return { dir: '/', base: '', name: '', ext: '' };
    }
    const lastSlash = normalized.lastIndexOf('/');
    const dir = lastSlash <= 0 ? '/' : normalized.slice(0, lastSlash);
    const base = normalized.slice(lastSlash + 1);
    const lastDot = base.lastIndexOf('.');
    if (lastDot <= 0) {
        return { dir, base, name: base, ext: '' };
    }
    return {
        dir,
        base,
        name: base.slice(0, lastDot),
        ext: base.slice(lastDot),
    };
}

export function parentPath(innerPath: string): string | null {
    const normalized = normalizePath(innerPath);
    if (normalized === '/') return null;
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash <= 0) return '/';
    return normalized.slice(0, lastSlash);
}

export function extname(nameOrPath: string): string {
    const base = nameOrPath.includes('/')
        ? nameOrPath.slice(nameOrPath.lastIndexOf('/') + 1)
        : nameOrPath;
    const lastDot = base.lastIndexOf('.');
    if (lastDot <= 0) return '';
    return base.slice(lastDot);
}

export function basename(nameOrPath: string): string {
    const normalized = nameOrPath.replace(/\/+$/, '');
    if (!normalized) return '';
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

export function isAncestor(
    ancestorPath: string,
    descendantPath: string
): boolean {
    const a = normalizePath(ancestorPath);
    const d = normalizePath(descendantPath);
    if (a === d) return false;
    if (a === '/') return true;
    return d.startsWith(a + '/');
}

export function relativePath(base: string, target: string): string {
    const normalizedBase = normalizePath(base);
    const normalizedTarget = normalizePath(target);
    if (normalizedBase === '/') {
        return normalizedTarget.slice(1);
    }
    if (!normalizedTarget.startsWith(normalizedBase + '/')) {
        throw new Error(
            `'${target}' is not a descendant of '${base}'`
        );
    }
    return normalizedTarget.slice(normalizedBase.length + 1);
}

// ═══════════════════════════════════════════════════════════════
// idOrPath 判断（保留，不变）
// ═══════════════════════════════════════════════════════════════

export function isPath(idOrPath: string): boolean {
    return idOrPath.length > 0 && idOrPath.charAt(0) === '/';
}

// ═══════════════════════════════════════════════════════════════
// 资产目录路径
// ═══════════════════════════════════════════════════════════════

/**
 * 获取文件的资产目录路径
 *
 * 仅适用于文件节点（file / seqfile），目录不使用此约定。
 * 命名约定：同级目录下 . + 文件全名（含扩展名）
 *
 * @example
 * ```ts
 * assetDirPath('/notes/hello.md')  // → '/notes/.hello.md'
 * assetDirPath('/data/config')     // → '/data/.config'
 * ```
 *
 * @throws Error 根路径无法计算
 */
export function assetDirPath(filePath: string): string {
    const parsed = parsePath(filePath);
    if (!parsed.base) {
        throw new Error('Cannot compute asset dir for root path');
    }
    return joinPath(parsed.dir, '.' + parsed.base);
}

/**
 * 启发式判断名称是否符合资产目录命名约定
 *
 * 仅做格式检查。无法区分资产目录与普通隐藏文件，
 * 确认需结合 FSNode.type === 'directory' 和 owner 的 assetDirId。
 */
export function looksLikeAssetDir(nameOrPath: string): boolean {
    const name = basename(nameOrPath);
    return name.startsWith('.') && name.length > 1;
}

/**
 * 从资产目录路径反推 owner 文件路径
 *
 * @returns owner 路径，格式不匹配返回 null
 *
 * @example
 * ```ts
 * assetDirOwnerPath('/notes/.hello.md')  // → '/notes/hello.md'
 * assetDirOwnerPath('/notes/regular')    // → null
 * ```
 */
export function assetDirOwnerPath(assetDirPath: string): string | null {
    const parsed = parsePath(assetDirPath);
    if (!parsed.base.startsWith('.') || parsed.base.length <= 1) {
        return null;
    }
    const ownerName = parsed.base.slice(1);
    return joinPath(parsed.dir, ownerName);
}

// ═══════════════════════════════════════════════════════════════
// 系统级路径
// ═══════════════════════════════════════════════════════════════

/**
 * 系统路径解析结果
 */
export interface SystemPath {
    /** 模块名（业务模块名 / '__config' / '__dev'） */
    moduleName: string;
    /** 模块内路径 */
    innerPath: string;
    /** 路径所在区域 */
    zone: 'config' | 'dev' | 'module';
}

/**
 * 解析系统级全路径
 *
 * 系统目录结构：
 *   /__config/...          → 全局配置模块
 *   /dev/...               → 设备文件
 *   /module/<name>/...     → 业务模块
 *
 * IModuleFS 路径映射：
 *   模块 'notes' 的 IModuleFS 中 '/' = 系统级 '/module/notes/'
 *   模块 'notes' 的 IModuleFS 中 '/hello.md' = 系统级 '/module/notes/hello.md'
 *
 * @example
 * ```ts
 * parseSystemPath('/__config/app.conf')
 * // → { zone:'config', moduleName:'__config', innerPath:'/app.conf' }
 *
 * parseSystemPath('/dev/llm')
 * // → { zone:'dev', moduleName:'__dev', innerPath:'/llm' }
 *
 * parseSystemPath('/module/notes/hello.md')
 * // → { zone:'module', moduleName:'notes', innerPath:'/hello.md' }
 * ```
 *
 * @throws Error 无法识别的路径格式
 */
export function parseSystemPath(systemPath: string): SystemPath {
    const normalized = normalizePath(systemPath);

    if (normalized === '/') {
        throw new Error(
            `Invalid system path: '${systemPath}' (root is not addressable)`
        );
    }

    // /__config/...
    if (
        normalized === SYSTEM_DIRS.CONFIG ||
        normalized.startsWith(SYSTEM_DIRS.CONFIG + '/')
    ) {
        const innerPath =
            normalized === SYSTEM_DIRS.CONFIG
                ? '/'
                : normalized.slice(SYSTEM_DIRS.CONFIG.length);
        return {
            moduleName: CONFIG_MODULE,
            innerPath: innerPath || '/',
            zone: 'config',
        };
    }

    // /dev/...
    if (
        normalized === SYSTEM_DIRS.DEV ||
        normalized.startsWith(SYSTEM_DIRS.DEV + '/')
    ) {
        const innerPath =
            normalized === SYSTEM_DIRS.DEV
                ? '/'
                : normalized.slice(SYSTEM_DIRS.DEV.length);
        return {
            moduleName: DEV_MODULE,
            innerPath: innerPath || '/',
            zone: 'dev',
        };
    }

    // /module 本身（无模块名）
    if (normalized === SYSTEM_DIRS.MODULE) {
        throw new Error(
            `Invalid system path: '${systemPath}'. ` +
            `'/module' is a namespace, not addressable. Use '/module/<name>/...'`
        );
    }

    // /module/<name>/...
    if (normalized.startsWith(SYSTEM_DIRS.MODULE + '/')) {
        const withoutPrefix = normalized.slice(
            SYSTEM_DIRS.MODULE.length + 1
        );
        const firstSlash = withoutPrefix.indexOf('/');
        if (firstSlash === -1) {
            return {
                moduleName: withoutPrefix,
                innerPath: '/',
                zone: 'module',
            };
        }
        return {
            moduleName: withoutPrefix.slice(0, firstSlash),
            innerPath: withoutPrefix.slice(firstSlash),
            zone: 'module',
        };
    }

    throw new Error(
        `Invalid system path: '${systemPath}'. ` +
        `Expected prefix: ${SYSTEM_DIRS.CONFIG}, ${SYSTEM_DIRS.DEV}, or ${SYSTEM_DIRS.MODULE}/<name>`
    );
}

/**
 * 构造系统级全路径
 *
 * @example
 * ```ts
 * toSystemPath('notes', '/hello.md')      // → '/module/notes/hello.md'
 * toSystemPath('__config', '/app.conf')   // → '/__config/app.conf'
 * toSystemPath('__dev', '/llm')           // → '/dev/llm'
 * ```
 */
export function toSystemPath(
    moduleName: string,
    innerPath: string
): string {
    const normalizedInner = normalizePath(innerPath);
    const suffix = normalizedInner === '/' ? '' : normalizedInner;

    if (moduleName === CONFIG_MODULE) {
        return SYSTEM_DIRS.CONFIG + suffix;
    }

    if (moduleName === DEV_MODULE) {
        return SYSTEM_DIRS.DEV + suffix;
    }

    return SYSTEM_DIRS.MODULE + '/' + moduleName + suffix;
}
