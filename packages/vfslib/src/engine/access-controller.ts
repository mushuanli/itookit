/**
 * @file packages/vfslib/src/engine/access-controller.ts
 * @desc 访问控制
 */

import { FSAccessDeniedError, FSReadOnlyError } from '@itookit/common';
import { isHiddenName } from '../utils/validation';
import * as pathUtils from '../utils/path';

export interface CallerIdentity {
    readonly moduleId: string;
    readonly isSystem: boolean;
}

export const SYSTEM_CALLER: CallerIdentity = {
    moduleId: '__system',
    isSystem: true,
};

export type AccessOperation = 'read' | 'write' | 'delete' | 'list';

export class AccessController {
    checkAccess(
        caller: CallerIdentity,
        absolutePath: string,
        operation: AccessOperation,
    ): void {
        if (caller.isSystem) return;

        const normalPath = pathUtils.normalize(absolutePath);

        // 检查路径所有分段：若任一段以 "." 开头（隐藏文件/目录，
        // 或位于隐藏目录内的文件），均需要 system access。
        const segments = normalPath.split('/').filter(Boolean);
        for (const seg of segments) {
            if (isHiddenName(seg)) {
                throw new FSAccessDeniedError(
                    normalPath,
                    operation,
                    'hidden files require system access',
                );
            }
        }

        const moduleMatch = normalPath.match(/^\/module\/([^/]+)/);
        if (moduleMatch) {
            const ownerModule = moduleMatch[1];
            if (caller.moduleId !== ownerModule) {
                throw new FSAccessDeniedError(
                    normalPath,
                    operation,
                    `module '${caller.moduleId}' cannot access module '${ownerModule}' data`,
                );
            }
        }

        const isSystemDir =
            pathUtils.isUnder(normalPath, '/etc') ||
            pathUtils.isUnder(normalPath, '/dev');

        if (isSystemDir && operation !== 'read' && operation !== 'list') {
            throw new FSReadOnlyError(normalPath, operation);
        }
    }

    checkCreate(caller: CallerIdentity, name: string, parentPath: string): void {
        this.checkAccess(caller, pathUtils.join(parentPath, name), 'write');
    }
}
