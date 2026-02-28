
// common/utils/fsPath.ts
/**
 * @file common/utils/fsPath.ts
 * @desc 文件系统路径工具函数（纯函数，无副作用）
 *
 * 设计原则:
 * - 纯函数，不依赖任何 I/O 或状态
 * - 任何层（UI、Service、Engine）都可直接使用
 * - 与 IModuleFS / IVFSManager 解耦
 */

/**
 * 路径分解结果
 */
export interfaceParsedPath {
    /** 父目录路径，如 '/notes'；根级文件返回 '/' */
    dir: string;

    /** 文件/目录名（含扩展名），如 'hello.md' */
    base: string;

    /** 文件名（不含扩展名），如 'hello' */
    name: string;

    /** 扩展名（含点），如 '.md'；无扩展名返回 '' */
    ext: string;
}

/**
 * 系统级路径分解结果
 */
export interface SystemPath {
    /** 模块名，如 'notes' */
    moduleName: string;

    /** 模块内路径，如 '/subdir/hello.md' */
    innerPath: string;
}

/**
 * 分解模块内路径为目录、文件名、扩展名
 *
 * @example
 * ```ts
 * parsePath('/notes/hello.md')
 * // → { dir: '/notes', base: 'hello.md', name: 'hello', ext: '.md' }
 *
 * parsePath('/readme')
 * // → { dir: '/', base: 'readme', name: 'readme', ext: '' }
 *
 * parsePath('/')
 * // → { dir: '/', base: '', name: '', ext: '' }
 * ```
 */
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
        // 无扩展名或以点开头的隐藏文件（如 '.gitignore'）
        return { dir, base, name: base, ext: '' };
    }

    return {
        dir,
        base,
        name: base.slice(0, lastDot),
        ext: base.slice(lastDot),
    };
}

/**
 * 拼接路径段，自动处理多余斜杠
 *
 * @example
 * ```ts
 * joinPath('/notes/', '/hello.md')  // → '/notes/hello.md'
 * joinPath('/notes', 'sub', 'file.md')  // → '/notes/sub/file.md'
 * joinPath('/', 'hello.md')  // → '/hello.md'
 * ```
 */
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

/**
 * 获取父目录路径
 *
 * @example
 * ```ts
 * parentPath('/notes/hello.md')  // → '/notes'
 * parentPath('/hello.md')  // → '/'
 * parentPath('/')  // → null
 * ```
 */
export function parentPath(innerPath: string): string | null {
    const normalized = normalizePath(innerPath);
    if (normalized === '/') return null;

    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash <= 0) return '/';
    return normalized.slice(0, lastSlash);
}

/**
 * 规范化路径
 *
 * - 确保以 '/' 开头
 * - 去除尾部 '/'（根路径除外）
 * - 合并连续 '/'
 * - 解析 '.' 和 '..'
 *
 * @example
 * ```ts
 * normalizePath('notes//hello.md')  // → '/notes/hello.md'
 * normalizePath('/notes/sub/../hello.md')  // → '/notes/hello.md'
 * normalizePath('/notes/')  // → '/notes'
 * normalizePath('')  // → '/'
 * ```
 */
export function normalizePath(innerPath: string): string {
    if (!innerPath || innerPath === '/') return '/';

    // 确保以 '/' 开头
    const withLeadingSlash = innerPath.startsWith('/')
        ? innerPath
        : '/' + innerPath;

    const parts = withLeadingSlash.split('/').filter((p) => p.length > 0);
    const resolved: string[] = [];

    for (const part of parts) {
        if (part === '.') {
            continue;
        } else if (part === '..') {
            resolved.pop();
        } else {
            resolved.push(part);
        }
    }

    return '/' + resolved.join('/') || '/';
}

/**
 * 分解系统级全路径为 moduleName + innerPath
 *
 * @example
 * ```ts
 * parseSystemPath('/notes/hello.md')
 * // → { moduleName: 'notes', innerPath: '/hello.md' }
 *
 * parseSystemPath('/notes')
 * // → { moduleName: 'notes', innerPath: '/' }
 *
 * parseSystemPath('/__config/app.conf')
 * // → { moduleName: '__config', innerPath: '/app.conf' }
 * ```
 *
 * @throws Error 如果路径格式无效（不以 '/' 开头或无模块名）
 */
export function parseSystemPath(systemPath: string): SystemPath {
    const normalized = normalizePath(systemPath);

    if (normalized === '/') {
        throw new Error(`Invalid system path: '${systemPath}' (no module name)`);
    }

    // 去掉开头的 '/'，然后按第一个 '/' 分割
    const withoutLeading = normalized.slice(1);
    const firstSlash = withoutLeading.indexOf('/');

    if (firstSlash === -1) {
        return {
            moduleName: withoutLeading,
            innerPath: '/',
        };
    }

    return {
        moduleName: withoutLeading.slice(0, firstSlash),
        innerPath: withoutLeading.slice(firstSlash),
    };
}

/**
 * 拼接系统级全路径
 *
 * @example
 * ```ts
 * toSystemPath('notes', '/hello.md')  // → '/notes/hello.md'
 * toSystemPath('notes', '/')  // → '/notes'
 * ```
 */
export function toSystemPath(
    moduleName: string,
    innerPath: string
): string {
    const normalizedInner = normalizePath(innerPath);

    if (normalizedInner === '/') {
        return '/' + moduleName;
    }

    return '/' + moduleName + normalizedInner;
}

/**
 * 获取文件扩展名（含点）
 *
 * @example
 * ```ts
 * extname('hello.md')  // → '.md'
 * extname('/path/to/file.tar.gz')  // → '.gz'
 * extname('noext')  // → ''
 * extname('.gitignore')  // → ''
 * ```
 */
export function extname(nameOrPath: string): string {
    const base = nameOrPath.includes('/')
        ? nameOrPath.slice(nameOrPath.lastIndexOf('/') + 1)
        : nameOrPath;

    const lastDot = base.lastIndexOf('.');
    if (lastDot <= 0) return '';
    return base.slice(lastDot);
}

/**
 * 获取文件基础名（不含目录路径）
 *
 * @example
 * ```ts
 * basename('/notes/hello.md')  // → 'hello.md'
 * basename('/notes/')  // → 'notes'
 * basename('hello.md')  // → 'hello.md'
 * ```
 */
export function basename(nameOrPath: string): string {
    const normalized = nameOrPath.replace(/\/+$/, '');
    if (!normalized) return '';

    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

/**
 * 判断 idOrPath 是否为路径
 *
 * 约定: 以 '/' 开头的字符串为路径，否则为节点 ID。
 *
 * @example
 * ```ts
 * isPath('/notes/hello.md')  // → true
 * isPath('abc123')  // → false
 * isPath('')  // → false
 * ```
 */
export function isPath(idOrPath: string): boolean {
    return idOrPath.length > 0 && idOrPath.charAt(0) === '/';
}

/**
 * 检查路径是否为另一路径的祖先
 *
 * @example
 * ```ts
 * isAncestor('/', '/notes/hello.md')  // → true
 * isAncestor('/notes', '/notes/hello.md')  // → true
 * isAncestor('/notes', '/notes')  // → false (不是自身的祖先)
 * isAncestor('/notes', '/other/file.md')  // → false
 * ```
 */
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

/**
 * 计算从一个路径到另一个路径的相对路径
 *
 * @example
 * ```ts
 * relativePath('/notes', '/notes/sub/hello.md')  // → 'sub/hello.md'
 * relativePath('/', '/notes/hello.md')  // → 'notes/hello.md'
 * ```
 *
 * @throws Error 如果 target 不是 base 的后代
 */
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
