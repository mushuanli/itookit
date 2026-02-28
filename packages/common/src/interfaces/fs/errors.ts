// common/interfaces/fs/errors.ts
/**
 * @file common/interfaces/fs/errors.ts
 * @desc 文件系统结构化错误类型
 *
 * 设计原则:
 * - 错误码枚举覆盖所有已知失败场景
 * - 错误类继承层次简洁，消费方可通过 instanceof 或 code 区分
 * - 每个常见场景提供专用子类，减少重复的错误构造代码
 */

import type { FSCapabilities } from './types';

/**
 * 文件系统错误码
 */
export type FSErrorCode =
    | 'NOT_FOUND'
    | 'ALREADY_EXISTS'
    | 'NOT_A_FILE'
    | 'NOT_A_DIRECTORY'
    | 'READ_ONLY'
    | 'PERMISSION_DENIED'
    | 'INVALID_PATH'
    | 'INVALID_NAME'
    | 'MODULE_NOT_FOUND'
    | 'CAPABILITY_MISSING'
    | 'STORAGE_ERROR'
    | 'QUOTA_EXCEEDED';

/**
 * 文件系统错误基类
 */
export class FSError extends Error {
    constructor(
        public readonly code: FSErrorCode,
        message: string,
        public readonly operation?: string,
        public readonly path?: string
    ) {
        super(message);
        this.name = 'FSError';
    }
}

/**
 * 节点不存在
 */
export class FSNotFoundError extends FSError {
    constructor(idOrPath: string, operation?: string) {
        super('NOT_FOUND', `Node not found: ${idOrPath}`, operation, idOrPath);
        this.name = 'FSNotFoundError';
    }
}

/**
 * 节点已存在
 */
export class FSAlreadyExistsError extends FSError {
    constructor(path: string, operation?: string) {
        super('ALREADY_EXISTS', `Node already exists: ${path}`, operation, path);
        this.name = 'FSAlreadyExistsError';
    }
}

/**
 * 只读文件系统上执行写入
 */
export class FSReadOnlyError extends FSError {
    constructor(moduleId: string, operation?: string) {
        super('READ_ONLY', `Module '${moduleId}' is read-only`, operation);
        this.name = 'FSReadOnlyError';
    }
}

/**
 * 请求的能力不支持
 */
export class FSCapabilityError extends FSError {
    constructor(capability: keyof FSCapabilities, moduleId: string) {
        super(
            'CAPABILITY_MISSING',
            `Module '${moduleId}' does not support capability '${capability}'`
        );
        this.name = 'FSCapabilityError';
    }
}

/**
 * 无效路径
 */
export class FSInvalidPathError extends FSError {
    constructor(path: string, reason?: string) {
        super(
            'INVALID_PATH',
            `Invalid path '${path}'${reason ? ': ' + reason : ''}`,
            undefined,
            path
        );
        this.name = 'FSInvalidPathError';
    }
}

/**
 * 模块未挂载
 */
export class FSModuleNotFoundError extends FSError {
    constructor(moduleName: string) {
        super('MODULE_NOT_FOUND', `Module '${moduleName}' is not mounted`);
        this.name = 'FSModuleNotFoundError';
    }
}
