// @mdx/editor/save-manager.ts
/**
 * 保存管理器
 * 职责：脏检查 + 保存去重 + 并发控制
 */
export class SaveManager {
    private _isDirty = false;
    private currentSavePromise: Promise<void> | null = null;
    private changeVersion = 0;
    private lastSaveFailed = false;

    constructor(private onSave?: (content: string) => Promise<void>) { }

    isDirty(): boolean { return this._isDirty; }
    setDirty(dirty: boolean): void {
        this._isDirty = dirty;
        if (dirty) this.changeVersion++;
    }

    async save(
        getContent: () => string,
        onSuccess: () => void,
        onError: (err: unknown) => void
    ): Promise<void> {
        if (!this.onSave) return;
        if (this.currentSavePromise) {
            await this.currentSavePromise;
            if (this._isDirty && !this.lastSaveFailed) {
                await this.save(getContent, onSuccess, onError);
            }
            return;
        }
        if (!this._isDirty) return;

        const savingVersion = this.changeVersion;
        const content = getContent();
        this.lastSaveFailed = false;
        this.currentSavePromise = (async () => {
            try {
                await this.onSave!(content);
                // A change may arrive while onSave is pending. Only mark the
                // document clean when the saved snapshot is still current.
                if (this.changeVersion === savingVersion) {
                    this._isDirty = false;
                }
                onSuccess();
            } catch (error) {
                this.lastSaveFailed = true;
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
        while (this._isDirty) {
            await this.save(getContent, onSuccess, onError);
            // A failed save deliberately remains dirty. Avoid retrying forever;
            // the error has already been reported and a later save may retry.
            if (this.lastSaveFailed) break;
        }
    }
}
