// @file vfs/core/errors/VFSError.ts

import { ErrorCode } from './ErrorCodes';

/**
 * VFS 错误基类
 */
export class VFSError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly timestamp: number;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'VFSError';
    this.code = code;
    this.details = details;
    this.timestamp = Date.now();
    
    // 保持原型链
    Object.setPrototypeOf(this, VFSError.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp
    };
  }

  static isVFSError(error: unknown): error is VFSError {
    return error instanceof VFSError;
  }

  static wrap(error: unknown, code: ErrorCode, message?: string): VFSError {
    if (error instanceof VFSError) {
      return error;
    }
    
    const msg = message ?? (error instanceof Error ? error.message : String(error));
    return new VFSError(code, msg, error);
  }
}

// 便捷工厂函数
export const Errors = {
  notFound: (resource: string) => 
    new VFSError(ErrorCode.NOT_FOUND, `Not found: ${resource}`),
  
  alreadyExists: (resource: string) => 
    new VFSError(ErrorCode.ALREADY_EXISTS, `Already exists: ${resource}`),
  
  invalidPath: (path: string) => 
    new VFSError(ErrorCode.INVALID_PATH, `Invalid path: ${path}`),
  
  invalidOperation: (reason: string) => 
    new VFSError(ErrorCode.INVALID_OPERATION, reason),
  
  permissionDenied: (reason: string) => 
    new VFSError(ErrorCode.PERMISSION_DENIED, reason),
  
  transactionFailed: (reason: string, details?: unknown) => 
    new VFSError(ErrorCode.TRANSACTION_FAILED, reason, details),
  
  pluginError: (pluginId: string, reason: string, details?: unknown) => 
    new VFSError(ErrorCode.PLUGIN_LOAD_ERROR, `Plugin ${pluginId}: ${reason}`, details),
  
  storageError: (reason: string, details?: unknown) => 
    new VFSError(ErrorCode.STORAGE_ERROR, reason, details)
};

export { ErrorCode };
