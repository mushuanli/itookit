/**
 * @file mdx/src/types/srs.ts
 * SRS (Spaced Repetition System) interfaces — used only by the cloze/memory plugin.
 *
 * Storage convention:
 *   /notes/hello.md SRS data → /notes/.hello.md/srs (seqfile)
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
