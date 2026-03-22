/**
 * @file common/interfaces/fs/IDeviceFile.ts
 * @desc 设备文件处理器
 *
 * 设计：
 * - 一个 handler 对应一种设备类型（如 'llm-openai'）
 * - 一个 handler 可服务多个设备文件节点
 * - 每次 read/write/readStream 通过 DeviceContext.sessionId 区分并发连接
 * - handler 内部管理会话生命周期
 *
 * 多 LLM 示例：
 *   /dev/llm/openai  → handlerId: 'llm-openai'
 *   /dev/llm/claude  → handlerId: 'llm-claude'
 *   /dev/llm/local   → handlerId: 'llm-local'
 *
 * 多连接示例：
 *   const s1 = await handler.open(ctx);           // 会话 1
 *   const s2 = await handler.open(ctx);           // 会话 2
 *   handler.write({ ...ctx, sessionId: s1 }, prompt1);
 *   handler.write({ ...ctx, sessionId: s2 }, prompt2);
 *   for await (const chunk of handler.readStream({ ...ctx, sessionId: s1 })) { ... }
 */

/**
 * 设备文件上下文
 */
export interface DeviceContext {
    /** 设备节点 ID */
    nodeId: string;
    /** 设备节点名称 */
    name: string;
    /** 节点元数据 */
    metadata?: Record<string, unknown>;
    /**
     * 会话 ID（可选）
     *
     * 用于区分同一设备上的多个并发连接。
     * - 无状态设备（如 /dev/random）：忽略此字段
     * - 有状态设备（如 /dev/llm/*）：通过 open() 获取 sessionId
     *
     * 不传时，handler 可以选择：
     * - 使用默认/匿名会话
     * - 抛出错误要求必须先 open()
     */
    sessionId?: string;
}

export interface IDeviceHandler {
    /** 处理器唯一标识符 */
    readonly handlerId: string;
    /** 是否支持写入 */
    readonly writable: boolean;
    /** 是否支持流式读取 */
    readonly streamable?: boolean;
    /**
     * 是否支持多会话
     *
     * true: 需要先 open() 获取 sessionId，再 read/write
     * false: 无状态设备，直接 read/write
     */
    readonly sessionable?: boolean;

    /**
     * 打开会话（可选）
     *
     * 对有状态设备（如 LLM），返回会话 ID。
     * 后续 read/write/readStream 需携带此 sessionId。
     *
     * @param ctx - 不含 sessionId 的设备上下文
     * @param options - 会话初始化选项（由设备定义语义）
     * @returns 会话 ID
     *
     * @example
     * ```ts
     * const sessionId = await handler.open(ctx, {
     *     model: 'gpt-4',
     *     systemPrompt: 'You are a helpful assistant.',
     * });
     * ```
     */
    open?(
        ctx: DeviceContext,
        options?: Record<string, unknown>
    ): Promise<string>;

    /**
     * 关闭会话（可选）
     *
     * 释放会话资源（如中断流式响应、清理上下文窗口）。
     * 不调用时，handler 可在超时后自动清理。
     */
    close?(ctx: DeviceContext): Promise<void>;

    /**
     * 读取设备内容
     *
     * - 无状态设备：每次调用独立，忽略 sessionId
     * - 有状态设备：返回当前会话的响应
     */
    read(ctx: DeviceContext): Promise<string | ArrayBuffer>;

    /**
     * 写入设备
     *
     * - 无状态设备：如 /dev/null，丢弃内容
     * - 有状态设备：如 /dev/llm/*，写入作为用户消息
     */
    write(ctx: DeviceContext, content: string | ArrayBuffer): Promise<void>;

    /**
     * 流式读取
     *
     * 需要 streamable === true。
     * 对 LLM 设备，write prompt 后调用此方法获取流式响应。
     */
    readStream?(ctx: DeviceContext): AsyncIterable<string | ArrayBuffer>;

    /** 设备初始化 */
    init?(): Promise<void>;

    /**
     * 设备销毁
     * 实现应关闭所有活跃会话。
     */
    dispose?(): Promise<void>;
}
