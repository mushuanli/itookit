// interface/options.ts
import type { Plugin, MiddlewarePlugin } from './plugin';
import type { DeviceDriver } from './device';

/**
 * 文件系统创建选项
 * 独立文件，避免 types.ts 产生循环引用
 */
export interface FileSystemOptions {
  backend?: 'indexeddb' | 'node-fs' | 'memory';
  backendConfig?: Record<string, unknown>;
  plugins?: (Plugin | MiddlewarePlugin)[];
  devices?: DeviceDriver[];
  builtinDevices?: boolean;
}
