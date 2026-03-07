/**
 * @file common/interfaces/fs/errors.ts
 * @desc 错误类型
 *
 * 重构要点：增加 FSConflictError（乐观锁冲突）
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
    | 'QUOTA_EXCEEDED'
    | 'VERSION_CONFLICT';

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

export class FSNotFoundError extends FSError {
    constructor(idOrPath: string, operation?: string) {
        super('NOT_FOUND', `Node not found: ${idOrPath} `, operation, idOrPath);
        this.name = 'FSNotFoundError';
    }
}

export class FSAlreadyExistsError extends FSError {
    constructor(path: string, operation?: string) {
        super('ALREADY_EXISTS', `Already exists: ${path} `, operation, path);
        this.name = 'FSAlreadyExistsError';
    }
}

export class FSReadOnlyError extends FSError {
    constructor(moduleId: string, operation?: string) {
        super('READ_ONLY', `Module '${moduleId}' is read - only`, operation);
        this.name = 'FSReadOnlyError';
    }
}

export class FSCapabilityError extends FSError {
    constructor(capability: string, moduleId: string) {
        super(
            'CAPABILITY_MISSING',
            `Module '${moduleId}' does not support '${capability}'`
        );
        this.name = 'FSCapabilityError';
    }
}

export class FSInvalidPathError extends FSError {
    constructor(path: string, reason?: string) {
        super(
            'INVALID_PATH',
            `Invalid path '${path}'${reason ? ': ' + reason : ''} `,
            undefined,
            path
        );
        this.name = 'FSInvalidPathError';
    }
}

export class FSModuleNotFoundError extends FSError {
    constructor(moduleName: string) {
        super('MODULE_NOT_FOUND', `Module '${moduleName}' is not mounted`);
        this.name = 'FSModuleNotFoundError';
    }
}

/**
 * 乐观锁版本冲突
 */
export class FSConflictError extends FSError {
    constructor(
        idOrPath: string,
        public readonly expectedVersion: number,
        public readonly actualVersion: number
    ) {
        super(
            'VERSION_CONFLICT',
            `Version conflict on '${idOrPath}': expected ${expectedVersion}, actual ${actualVersion} `,
            undefined,
            idOrPath
        );
        this.name = 'FSConflictError';
    }
}
