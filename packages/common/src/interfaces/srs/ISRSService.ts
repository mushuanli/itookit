/**
 * @file common/interfaces/srs/ISRSService.ts
 * @desc SRS 服务接口
 *
 * 领域特定服务，不属于 fs 基础设施。
 * 通过 DI 注入 IModuleFS，组合使用 assets + seqfile 能力实现存储。
 *
 * 存储约定：
 * 文件 /notes/hello.md 的 SRS 数据 → /notes/.hello.md/srs (seqfile)
 */

export interface SRSItemData {
    dueAt: number;
    lastReviewedAt: number;
    reviewCount: number;
    interval: number;
    ease: number;
    snippet?: string;
}

export interface SRSCardRef {
    fileId: string;
    clozeId: string;
    status: SRSItemData;
}

export interface SRSStats {
    totalCards: number;
    dueCards: number;
    reviewedToday: number;
    averageEase: number;
}

export interface ISRSService {
    getStatus(fileId: string): Promise<Record<string, SRSItemData>>;
    updateStatus(fileId: string, clozeId: string, status: SRSItemData): Promise<void>;
    getDueCards(options?: {
        limit?: number;
        before?: number;
    }): Promise<SRSCardRef[]>;
    updateStatusBatch(
        updates: Array<{ fileId: string; clozeId: string; status: SRSItemData }>
    ): Promise<void>;
    removeAllForFile(fileId: string): Promise<void>;
    getStats?(): Promise<SRSStats>;
}
