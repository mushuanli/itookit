/**
 * @file vfs-ui/utils/delete-error.ts
 * @desc Turns a view error into a message a user can act on.
 *
 * FileSystemView intentionally hides provider detail ("Source operation failed: delete"),
 * so the failure code is what distinguishes "this entry is read-only" from a real fault.
 * The original error stays available as `cause` for logs.
 */
import type { FSError } from '@itookit/vfs-core';

export function describeDeleteError(error: unknown): string {
    const failure = error as Partial<FSError> | undefined;
    if (failure?.code === 'EROFS') return '该项目为只读，无法在此处删除';
    if (failure?.code === 'EBUSY') return '该项目正被占用，无法删除';
    if (failure?.code === 'ENOENT') return '该项目已不存在';
    if (failure?.code === 'EACCES') return '没有删除该项目的权限';
    return error instanceof Error ? error.message : String(error);
}
