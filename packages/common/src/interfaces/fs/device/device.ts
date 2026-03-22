/**
 * @file common/interfaces/fs/device/device.ts
 * @desc 虚拟设备驱动
 *
 * 设计：
 * - sessionable 设备（如 LLM）：open → write/read → close
 * - 无状态设备（如 /dev/null）：直接 read/write
 * - readStream 用于流式 LLM 响应
 * - ioctl 用于设备特定控制命令
 */

import type { FileContent } from '../core/types';

export interface DeviceContext {
    /** 设备节点 ID */
    nodeId: string;
    /** 设备节点名称 */
    name: string;
    /** 节点元数据 */
    metadata?: Record<string, unknown>;
    /** 会话 ID（sessionable 设备需要） */
    sessionId?: string;
}

export interface IDeviceDriver {
    /** 处理器唯一标识符 */
    readonly handlerId: string;
    /** 人类可读描述 */
    readonly description?: string;
    /** 是否支持写入 */
    readonly writable: boolean;
    /** 是否支持流式读取 */
    readonly streamable?: boolean;
    /** 是否支持多会话 */
    readonly sessionable?: boolean;

    /** 打开会话 @returns 会话 ID */
    open?(ctx: DeviceContext, options?: Record<string, unknown>): Promise<string>;

    /** 关闭会话 */
    close?(ctx: DeviceContext): Promise<void>;

    /** 读取 */
    read(ctx: DeviceContext): Promise<FileContent>;

    /** 写入 */
    write(ctx: DeviceContext, content: FileContent): Promise<void>;

    /** 流式读取 */
    readStream?(ctx: DeviceContext): AsyncIterable<string | ArrayBuffer>;

    /** 设备控制命令 */
    ioctl?(ctx: DeviceContext, command: string | number, arg?: unknown): Promise<unknown>;

    /** 设备初始化 */
    init?(): Promise<void>;

    /** 设备销毁（应关闭所有活跃会话） */
    dispose?(): Promise<void>;
}

export interface IDeviceManager {
    register(driver: IDeviceDriver): void;
    unregister(handlerId: string): void;
    has(handlerId: string): boolean;
    get(handlerId: string): IDeviceDriver;
    list(): string[];
}
