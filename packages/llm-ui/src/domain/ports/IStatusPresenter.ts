// @file: llm-ui/domain/ports/IStatusPresenter.ts

export interface IStatusPresenter {
    update(status: string): void;
    updateFromSnapshot(snapshot: any): void;
    updateBackground(payload: { running: number; queued: number }): void;
    cacheElements(): void;
    destroy(): void;
}
