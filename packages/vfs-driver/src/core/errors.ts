// @vfs-driver/core/errors.ts

import type { ErrorCode } from '../interface/types.js';

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ENOENT: 'No such file or directory',
  EEXIST: 'File or directory already exists',
  EISDIR: 'Is a directory',
  ENOTDIR: 'Not a directory',
  ENOTEMPTY: 'Directory not empty',
  EACCES: 'Permission denied',
  ENOSPC: 'No space left on device',
  ENOTTY: 'Inappropriate ioctl for device',
  EINVAL: 'Invalid argument',
  ELOOP: 'Too many levels of symbolic links',
  EIO: 'Input/output error',
  EPLUGIN: 'Plugin error',
  ENOTRECORD: 'Not a record file',
};

export class FileSystemError extends Error {
  public readonly code: ErrorCode;
  public readonly path: string;

  constructor(code: ErrorCode, path: string, detail?: string) {
    const base = ERROR_MESSAGES[code] ?? code;
    const message = detail
      ? `${code}: ${base} '${path}' - ${detail}`
      : `${code}: ${base} '${path}'`;
    super(message);
    this.name = 'FileSystemError';
    this.code = code;
    this.path = path;
  }
}
