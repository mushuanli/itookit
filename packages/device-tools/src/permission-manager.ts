// @file: device-tools/src/permission-manager.ts
// 三层权限管理器。

import type {
    ToolMeta,
    ToolPermission,
    ToolPermissionRule,
} from '@itookit/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 三层权限管理器。
 *
 * 评估顺序：
 * 1. 全局规则（硬编码的安全基线）
 * 2. 项目规则（.executor/permissions.json）
 * 3. 会话记忆（用户在本次会话中已授权的同类操作）
 * 4. 副作用推断（无副作用的读操作默认放行）
 * 5. 默认策略（兜底）
 *
 * 设计原则：
 * - 无副作用的读操作默认放行（减少用户打断）
 * - 有副作用的写操作默认询问用户
 * - 危险操作硬拒绝（不可覆盖）
 */
export class PermissionManager {
    private sessionGrants = new Map<string, ToolPermission>();

    constructor(
        private globalRules: ToolPermissionRule[] = [],
        private defaultPolicy: ToolPermission = 'ask_user',
    ) {}

    check(
        meta: ToolMeta,
        args: Record<string, unknown>,
        cwd?: string,
    ): ToolPermission {
        // 1. 全局规则
        for (const rule of this.globalRules) {
            if (this.matches(rule, meta, args)) {
                return rule.action;
            }
        }

        // 2. 项目规则
        if (cwd) {
            for (const rule of this.loadProjectRules(cwd)) {
                if (this.matches(rule, meta, args)) {
                    return rule.action;
                }
            }
        }

        // 3. 会话记忆
        const sessionKey = this.makeSessionKey(meta, args);
        const sessionGrant = this.sessionGrants.get(sessionKey);
        if (sessionGrant !== undefined) {
            return sessionGrant;
        }

        // 4. 无副作用默认放行
        if (meta.sideEffect === 'none') {
            return 'allowed';
        }

        // 5. 默认策略
        return this.defaultPolicy;
    }

    /**
     * 记录用户在本次会话中的授权决定。
     * 同类操作后续不再询问，减少交互打断。
     */
    grantSession(toolId: string, scope = '*'): void {
        this.sessionGrants.set(`${toolId}:${scope}`, 'allowed');
    }

    denySession(toolId: string, scope = '*'): void {
        this.sessionGrants.set(`${toolId}:${scope}`, 'denied');
    }

    /**
     * 记住针对特定工具+参数的授权
     */
    rememberGrant(meta: ToolMeta, args: Record<string, unknown>): void {
        const key = this.makeSessionKey(meta, args);
        this.sessionGrants.set(key, 'allowed');
    }

    /**
     * 重置会话级授权记忆
     */
    resetSessionGrants(): void {
        this.sessionGrants.clear();
    }

    private matches(
        rule: ToolPermissionRule,
        meta: ToolMeta,
        args: Record<string, unknown>,
    ): boolean {
        if (!this.globMatch(meta.id, rule.toolPattern)) return false;

        if (rule.argPatterns) {
            for (const [key, pattern] of Object.entries(rule.argPatterns)) {
                if (!(key in args)) return false;
                if (!this.globMatch(String(args[key]), pattern)) return false;
            }
        }

        return true;
    }

    private makeSessionKey(meta: ToolMeta, args: Record<string, unknown>): string {
        // 文件操作按目录粒度记忆授权
        if ('path' in args && typeof args.path === 'string') {
            const directory = path.dirname(args.path as string);
            return `${meta.id}:${directory}`;
        }
        return `${meta.id}:*`;
    }

    private loadProjectRules(cwd: string): ToolPermissionRule[] {
        const rulesPath = path.join(cwd, '.executor', 'permissions.json');
        if (!fs.existsSync(rulesPath)) return [];

        try {
            const data = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
            return (data.rules ?? []) as ToolPermissionRule[];
        } catch {
            return [];
        }
    }

    private globMatch(value: string, pattern: string): boolean {
        if (pattern === '*') return true;
        if (!pattern.includes('*') && !pattern.includes('?')) return value === pattern;

        const regex = new RegExp(
            '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
                          .replace(/\*/g, '.*')
                          .replace(/\?/g, '.') + '$',
        );
        return regex.test(value);
    }
}
