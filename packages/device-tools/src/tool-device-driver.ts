// @file: device-tools/src/tool-device-driver.ts
// 工具设备驱动器——将 ToolService 暴露为 VFS 设备。

import type {
    IDeviceDriver,
    DeviceContext,
    ToolMeta,
    ToolInvokeRequest,
    ToolInvokeResult,
    ToolBatchResult,
    ToolPermissionRule,
} from '@itookit/common';
import { ToolService } from './tool-service';
import { PermissionManager } from './permission-manager';
import { FileReadTool } from './builtin/file-read';
import { FileWriteTool } from './builtin/file-write';
import { ShellExecTool } from './builtin/shell-exec';
import { GlobSearchTool } from './builtin/glob-search';
import { GrepSearchTool } from './builtin/grep-search';

/**
 * ioctl 命令常量
 */
export const TOOL_IOCTL = {
    /** 列出所有工具 */
    LIST: 'tool:list',
    /** 获取工具元数据 */
    GET_META: 'tool:getMeta',
    /** 获取 LLM 工具定义列表 */
    GET_DEFINITIONS: 'tool:getDefinitions',
    /** 执行单个工具 */
    INVOKE: 'tool:invoke',
    /** 批量执行工具 */
    INVOKE_BATCH: 'tool:invokeBatch',
    /** 注册工具 */
    REGISTER: 'tool:register',
    /** 注销工具 */
    UNREGISTER: 'tool:unregister',
    /** 检查权限 */
    CHECK_PERMISSION: 'tool:checkPermission',
    /** 授予会话权限 */
    GRANT_PERMISSION: 'tool:grantPermission',
} as const;

/**
 * 工具设备驱动器。
 *
 * 将 ToolService 包装为 VFS 设备驱动器，
 * 通过 ioctl 暴露所有工具操作。
 *
 * 注册方式：
 *   deviceManager.register('tools', new ToolDeviceDriver());
 *
 * 使用方式（通过 IDeviceHandle）：
 *   const handle = createDeviceHandle(driver, ctx);
 *   const result = await handle.ioctl('tool:invoke', { toolId: 'file_read', args: { path: './foo.ts' } });
 */
export class ToolDeviceDriver implements IDeviceDriver {
    readonly type = 'tools';

    private service: ToolService;
    private permissions: PermissionManager;

    constructor(options?: {
        globalRules?: ToolPermissionRule[];
        defaultPolicy?: 'allowed' | 'denied' | 'ask_user';
    }) {
        this.permissions = new PermissionManager(
            options?.globalRules ?? ToolDeviceDriver.defaultGlobalRules(),
            options?.defaultPolicy ?? 'ask_user',
        );
        this.service = new ToolService(this.permissions);

        // 注册内置工具
        this.registerBuiltins();
    }

    /**
     * 注册内置工具
     */
    private registerBuiltins(): void {
        const builtins = [
            FileReadTool,
            FileWriteTool,
            ShellExecTool,
            GlobSearchTool,
            GrepSearchTool,
        ];

        for (const ToolClass of builtins) {
            this.service.registerTool(
                ToolClass.META,
                ToolClass.DEFINITION,
                ToolClass.handler,
            );
        }
    }

    /**
     * 默认全局权限规则
     */
    private static defaultGlobalRules(): ToolPermissionRule[] {
        return [
            {
                toolPattern: 'file_read',
                action: 'allowed',
                reason: 'Reading files is safe',
            },
            {
                toolPattern: 'glob_search',
                action: 'allowed',
                reason: 'Searching files is safe',
            },
            {
                toolPattern: 'grep_search',
                action: 'allowed',
                reason: 'Searching file contents is safe',
            },
            {
                toolPattern: 'shell_exec',
                action: 'ask_user',
                reason: 'Shell commands may have side effects',
            },
            {
                toolPattern: 'file_write',
                action: 'ask_user',
                reason: 'Writing files modifies local state',
            },
        ];
    }

    // ── IDeviceDriver 实现 ──

    async open(_ctx: DeviceContext, _options?: any): Promise<string> {
        // 工具设备不需要会话概念，返回固定 ID
        return 'tools-default';
    }

    async close(_ctx: DeviceContext): Promise<void> {
        // 重置会话级权限
        this.permissions.resetSessionGrants();
    }

    async ioctl(ctx: DeviceContext, command: string, params?: any): Promise<any> {
        switch (command) {
            case TOOL_IOCTL.LIST:
                return this.service.listTools();

            case TOOL_IOCTL.GET_META:
                return this.service.getToolMeta(params?.id);

            case TOOL_IOCTL.GET_DEFINITIONS:
                return this.service.getToolDefinitions();

            case TOOL_IOCTL.INVOKE:
                return this.service.invoke(params as ToolInvokeRequest);

            case TOOL_IOCTL.INVOKE_BATCH:
                return this.service.invokeBatch(params as ToolInvokeRequest[]);

            case TOOL_IOCTL.REGISTER:
                this.service.registerTool(params.meta, params.definition, params.handler);
                return { success: true };

            case TOOL_IOCTL.UNREGISTER:
                this.service.unregisterTool(params?.id);
                return { success: true };

            case TOOL_IOCTL.CHECK_PERMISSION: {
                const meta = this.service.getToolMeta(params.toolId);
                if (!meta) return 'denied';
                return this.permissions.check(meta, params.args ?? {}, params.cwd);
            }

            case TOOL_IOCTL.GRANT_PERMISSION:
                this.permissions.grantSession(params.toolId, params.scope);
                return { success: true };

            default:
                throw new Error(`[ToolDeviceDriver] Unknown ioctl command: ${command}`);
        }
    }

    /**
     * 获取内部 ToolService 实例（用于直接集成场景）
     */
    getService(): ToolService {
        return this.service;
    }

    /**
     * 获取内部 PermissionManager 实例
     */
    getPermissionManager(): PermissionManager {
        return this.permissions;
    }
}
