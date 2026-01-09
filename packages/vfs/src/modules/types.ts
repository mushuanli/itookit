// @file packages/vfs-modules/src/types.ts

/**
 * 模块信息
 */
export interface ModuleInfo {
  name: string;
  rootNodeId: string;
  description?: string;
  isProtected?: boolean;
  syncEnabled?: boolean;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * 模块挂载选项
 */
export interface MountOptions {
  description?: string;
  isProtected?: boolean;
  syncEnabled?: boolean;
  metadata?: Record<string, unknown>;
}
