// @file vfs/core/errors/VFSError.ts

export enum ErrorCode {
  UNKNOWN = 'UNKNOWN',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  INVALID_PATH = 'INVALID_PATH',
  INVALID_OPERATION = 'INVALID_OPERATION',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  READ_ONLY = 'READ_ONLY',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  TRANSACTION_ABORTED = 'TRANSACTION_ABORTED',
  PLUGIN_NOT_FOUND = 'PLUGIN_NOT_FOUND',
  PLUGIN_LOAD_ERROR = 'PLUGIN_LOAD_ERROR',
  DEPENDENCY_ERROR = 'DEPENDENCY_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  SYNC_ERROR = 'SYNC_ERROR',
  CONFLICT_ERROR = 'CONFLICT_ERROR'
}

/**
 * VFS 错误基类
 */
export class VFSError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly timestamp = Date.now()
  ) {
    super(message);
    this.name = 'VFSError';
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

  static is(error: unknown): error is VFSError {
    return error instanceof VFSError;
  }

  static wrap(error: unknown, code: ErrorCode, message?: string): VFSError {
    if (VFSError.is(error)) return error;
    const msg = message ?? (error instanceof Error ? error.message : String(error));
    return new VFSError(code, msg, error);
  }
}

// 便捷工厂
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
} as const;
