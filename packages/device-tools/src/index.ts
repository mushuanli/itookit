// @file: device-tools/src/index.ts

export { ToolDeviceDriver } from './tool-device-driver';
export { ToolService } from './tool-service';
export { PermissionManager } from './permission-manager';

// 内置工具
export { FileReadTool } from './builtin/file-read';
export { FileWriteTool } from './builtin/file-write';
export { ShellExecTool } from './builtin/shell-exec';
export { GlobSearchTool } from './builtin/glob-search';
export { GrepSearchTool } from './builtin/grep-search';

// 类型重导出
export type {
    ToolMeta,
    ToolInvokeRequest,
    ToolInvokeResult,
    ToolBatchResult,
    ToolPermissionRule,
    ToolHandler,
    ToolExecutionContext,
    IToolService,
} from '@itookit/common';
