// @mdx/editor/save-manager.ts
/**
 * 保存管理器
 * 职责：脏检查 + 保存去重 + 并发控制
 */
export class SaveManager {
    private _isDirty = false;
    private currentSavePromise: Promise<void> | null = null;

    constructor(private onSave?: (content: string) => Promise<void>) { }

    isDirty(): boolean { return this._isDirty; }
    setDirty(dirty: boolean): void { this._isDirty = dirty; }

    async save(
        getContent: () => string,
        onSuccess: () => void,
        onError: (err: unknown) => void
    ): Promise<void> {
        if (!this.onSave) return;
        if (this.currentSavePromise) return this.currentSavePromise;
        if (!this._isDirty) return;

        this.currentSavePromise = (async () => {
            try {
                await this.onSave!(getContent());
                this._isDirty = false;
                onSuccess();
            } catch (error) {
                console.error('[SaveManager] Save failed:', error);
                onError(error);
            } finally {
                this.currentSavePromise = null;
            }
        })();

        return this.currentSavePromise;
    }

    /**
     * 销毁前最终保存（等待当前 + 双重检查）
     */
    async finalSave(
        getContent: () => string,
        onSuccess: () => void,
        onError: (err: unknown) => void
    ): Promise<void> {
        if (this.currentSavePromise) {
            try { await this.currentSavePromise; }
            catch { /* already logged */ }
        }
        if (this._isDirty) {
            await this.save(getContent, onSuccess, onError);
        }
    }
}
