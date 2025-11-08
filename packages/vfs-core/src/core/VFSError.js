/**
 * @file vfsCore/core/VFSError.js
 * @fileoverview VFS 错误类型定义
 */

/**
 * VFS 基础错误类
 */
export class VFSError extends Error {
    constructor(message, code = 'VFS_ERROR') {
        super(message);
        this.name = 'VFSError';
        this.code = code;
    }
}

/**
 * 节点未找到错误
 */
export class VNodeNotFoundError extends VFSError {
    constructor(nodeId) {
        super(`VNode not found: ${nodeId}`, 'ENOENT');
        this.name = 'VNodeNotFoundError';
        this.nodeId = nodeId;
    }
}

/**
 * 路径已存在错误
 */
export class PathExistsError extends VFSError {
    constructor(path) {
        super(`Path already exists: ${path}`, 'EEXIST');
        this.name = 'PathExistsError';
        this.path = path;
    }
}

/**
 * 不是目录错误
 */
export class NotDirectoryError extends VFSError {
    constructor(path) {
        super(`Not a directory: ${path}`, 'ENOTDIR');
        this.name = 'NotDirectoryError';
        this.path = path;
    }
}

/**
 * 目录非空错误
 */
export class DirectoryNotEmptyError extends VFSError {
    constructor(path) {
        super(`Directory not empty: ${path}`, 'ENOTEMPTY');
        this.name = 'DirectoryNotEmptyError';
        this.path = path;
    }
}

/**
 * 验证错误
 */
export class ValidationError extends VFSError {
    constructor(message, errors = []) {
        super(message, 'EINVAL');
        this.name = 'ValidationError';
        this.errors = errors;
    }
}

/**
 * 权限错误
 */
export class PermissionError extends VFSError {
    constructor(operation, path) {
        super(`Permission denied: ${operation} on ${path}`, 'EACCES');
        this.name = 'PermissionError';
        this.operation = operation;
        this.path = path;
    }
}

/**
 * Provider 错误
 */
export class ProviderError extends VFSError {
    constructor(providerName, message) {
        super(`Provider '${providerName}': ${message}`, 'EPROVIDER');
        this.name = 'ProviderError';
        this.providerName = providerName;
    }
}
