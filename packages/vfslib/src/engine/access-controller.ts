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
    // Injected by VFSManager after construction so it can consult live module registry.
    private systemModuleChecker: ((moduleId: string) => boolean) | null = null;

    /**
     * Register a predicate that returns true for system modules.
     * Called once by VFSManager.initialize() with a closure over its module map.
     */
    setSystemModuleChecker(fn: (moduleId: string) => boolean): void {
        this.systemModuleChecker = fn;
    }

    private isSystemModule(moduleId: string): boolean {
        return this.systemModuleChecker?.(moduleId) ?? false;
    }

    checkAccess(
        caller: CallerIdentity,
        absolutePath: string,
        operation: AccessOperation,
    ): void {
        if (caller.isSystem) return;

        const normalPath = pathUtils.normalize(absolutePath);
        const segments = normalPath.split('/').filter(Boolean);
        const moduleMatch = normalPath.match(/^\/module\/([^/]+)/);
        const pathModuleId = moduleMatch?.[1];

        // Hidden-file access — Linux-like semantics:
        //   • system module paths  → only system callers may touch dot-prefix entries
        //   • own regular module   → accessible (hidden only means excluded from listings)
        //   • elsewhere (no module owner, or another module) → blocked
        const hasHiddenSegment = segments.some(s => isHiddenName(s));
        if (hasHiddenSegment) {
            const isOwnRegularModule =
                pathModuleId === caller.moduleId && !this.isSystemModule(caller.moduleId);
            if (!isOwnRegularModule) {
                throw new FSAccessDeniedError(
                    normalPath,
                    operation,
                    'hidden files require system access',
                );
            }
        }

        // Cross-module isolation (covers non-hidden files between modules).
        if (moduleMatch && pathModuleId !== caller.moduleId) {
            throw new FSAccessDeniedError(
                normalPath,
                operation,
                `module '${caller.moduleId}' cannot access module '${pathModuleId}' data`,
            );
        }

        // Top-level system directories are read-only for non-system callers.
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
