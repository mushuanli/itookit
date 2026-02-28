// common/interfaces/fs/IDeviceFile.ts
/**
 * @file common/interfaces/fs/IDeviceFile.ts
 * @desc 设备文件处理器接口
 *
 * 设备文件的读写行为由注册的 handler 定义，
 * 而不是直接存储在文件系统中。
 *
 * 典型用途:
 * - /dev/status: 返回系统状态信息
 * - /dev/llm: 代理 LLM 调用
 * - /dev/clipboard: 剪贴板访问
 * - /dev/random: 返回随机数据
 *
 * 使用流程:
 * 1. 实现 IDeviceHandler 接口
 * 2. 调用 IModuleFS.registerDeviceHandler(handler)
 * 3. 调用 IModuleFS.createDeviceFile(name, parent, handlerId) 创建设备节点
 * 4. 对设备节点调用 readContent / writeContent 时，
 *    实现层委托给对应的 IDeviceHandler
 */

import type { FSNode } from './types';

/**
 * 设备文件处理器接口
 */
export interface IDeviceHandler {
    /** 处理器唯一标识符（对应 FSNode.deviceHandlerId） */
    readonly handlerId: string;

    /** 设备是否支持写入 */
    readonly writable: boolean;

    /**
     * 读取设备内容
     *
     * 每次调用可能返回不同结果（与普通文件不同）。
     * 例如 /dev/status 每次返回当前系统状态。
     *
     * @param node - 设备文件节点元数据
     * @returns 设备输出内容
     */
    read(node: FSNode): Promise<string | ArrayBuffer>;

    /**
     * 写入设备
     *
     * 写入的"内容"由设备定义其语义。
     * 例如 /dev/llm 可将写入内容作为 prompt 发送。
     *
     * @param node - 设备文件节点元数据
     * @param content - 写入内容
     * @throws FSReadOnlyError 当 writable === false 时
     */
    write(node: FSNode, content: string | ArrayBuffer): Promise<void>;

    /**
     * 设备初始化（可选）
     * 在设备文件首次被访问时调用
     */
    init?(): Promise<void>;

    /**
     * 设备销毁（可选）
     * 在模块 dispose 时调用，用于清理设备资源
     */
    dispose?(): Promise<void>;
}
