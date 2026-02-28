// common/interfaces/fs/ISRSService.ts
/**
 * @file common/interfaces/fs/ISRSService.ts
 * @desc SRS（间隔重复）服务接口
 *
 * 从 IModuleFS 中分离，遵循 SRP。
 * SRS 是领域特定功能，不属于通用文件系统。
 *
 * 存储约定:
 * 对于文件 /notes/hello.md，其 SRS 数据存储在资产目录中：
 *   /notes/.hello.md/srs    (seqfile 格式)
 *
 * seqfile 内容示例:
 *   cloze_1.dueAt=1700000000000
 *   cloze_1.lastReviewedAt=1699900000000
 *   cloze_1.reviewCount=5
 *   cloze_1.interval=7
 *   cloze_1.ease=2.5
 *   cloze_1.snippet=这是一段摘要
 *   cloze_2.dueAt=1700100000000
 *   ...
 *
 * 当底层支持 seqfile 能力时（capabilities.seqFiles === true），
 * 每个字段可独立索引，getDueCards 可通过 DB 查询高效实现。
 * 当不支持时，降级为读取整个文件 + 文本解析。
 *
 * 实现方通过 DI 注入 IModuleFS，组合使用 seqfile / readContent 能力。
 */

// ═══════════════════════════════════════════════════════════════
// 数据结构
// ═══════════════════════════════════════════════════════════════

/**
 * SRS 卡片状态数据
 */
export interface SRSItemData {
    /** 下次复习时间 (Unix 时间戳 ms) */
    dueAt: number;

    /** 上次复习时间 (Unix 时间戳 ms) */
    lastReviewedAt: number;

    /** 复习次数 */
    reviewCount: number;

    /** 当前间隔 (天) */
    interval: number;

    /** 难度系数 */
    ease: number;

    /** 内容摘要片段 */
    snippet?: string;
}

/**
 * SRS 卡片引用（定位到具体文件中的具体卡片）
 */
export interface SRSCardRef {
    /** 文件节点 ID */
    fileId: string;

    /** 卡片 ID（如 'cloze_1'） */
    clozeId: string;

    /** 卡片状态 */
    status: SRSItemData;
}

/**
 * SRS 统计信息
 */
export interface SRSStats {
    /** 总卡片数 */
    totalCards: number;

    /** 当前到期卡片数 */
    dueCards: number;

    /** 今日已复习数 */
    reviewedToday: number;

    /** 平均难度系数 */
    averageEase: number;
}

// ═══════════════════════════════════════════════════════════════
// 服务接口
// ═══════════════════════════════════════════════════════════════

/**
 * SRS 服务接口
 *
 * 独立于文件系统接口，通过组合 IModuleFS 实现。
 * 生命周期由 DI 容器管理，绑定到特定模块。
 *
 * 实现方:
 * - SRSServiceImpl: 基于 IModuleFS + seqfile 的标准实现
 * - MemorySRSService: 纯内存实现（用于测试）
 *
 * 消费方:
 * - SRS 复习 UI
 * - BackgroundBrain（自动安排复习）
 */
export interface ISRSService {
    /**
     * 获取指定文件的所有 SRS 卡片状态
     *
     * @param fileId - 文件节点 ID
     * @returns clozeId → SRSItemData 的映射，无卡片时返回空对象
     */
    getStatus(fileId: string): Promise<Record<string, SRSItemData>>;

    /**
     * 更新单个卡片的 SRS 状态
     *
     * 如果卡片不存在则创建，存在则覆盖。
     *
     * @param fileId - 文件节点 ID
     * @param clozeId - 卡片 ID
     * @param status - 新状态
     */
    updateStatus(
        fileId: string,
        clozeId: string,
        status: SRSItemData
    ): Promise<void>;

    /**
     * 获取到期的 SRS 卡片
     *
     * @param options - 查询选项
     * @returns 到期卡片列表，按 dueAt 升序排列
     */
    getDueCards(options?: {
        /** 最大返回数量 */
        limit?: number;
        /** 截止时间（默认 Date.now()），获取此时间前到期的卡片 */
        before?: number;
    }): Promise<SRSCardRef[]>;

    /**
     * 批量更新卡片状态
     *
     * 用于一次复习会话结束后的批量提交。
     * 实现可以优化为单次事务。
     *
     * @param updates - 更新列表
     */
    updateStatusBatch(
        updates: Array<{
            fileId: string;
            clozeId: string;
            status: SRSItemData;
        }>
    ): Promise<void>;

    /**
     * 删除文件关联的所有 SRS 数据
     *
     * 通常在文件被删除时由事件监听器调用。
     *
     * @param fileId - 文件节点 ID
     */
    removeAllForFile(fileId: string): Promise<void>;

    /**
     * 获取 SRS 统计信息
     */
    getStats?(): Promise<SRSStats>;
}
