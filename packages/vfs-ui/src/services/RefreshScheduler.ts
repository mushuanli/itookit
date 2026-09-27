/** Coalesces invalidations; a running refresh gets at most one trailing refresh. */
export class RefreshScheduler {
  private dirty = false;
  private visible = true;
  private closed = false;
  private pending?: Promise<void>;
  constructor(private readonly refresh: () => Promise<void>, private readonly report: (error: unknown) => void) {}
  request(): void { if (!this.closed) { this.dirty = true; this.schedule(); } }
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible && this.pending) this.dirty = true;
    this.schedule();
  }
  destroy(): void { this.closed = true; this.dirty = false; }
  private schedule(): void {
    if (this.closed || !this.visible || !this.dirty || this.pending) return;
    this.pending = Promise.resolve().then(() => this.run()).finally(() => {
      this.pending = undefined;
      this.schedule();
    });
    // Reporting must not create an unhandled rejection if the observer throws.
    void this.pending.catch(error => console.error('[RefreshScheduler] Observer failed', error));
  }
  private async run(): Promise<void> {
    if (this.closed || !this.visible || !this.dirty) return;
    this.dirty = false;
    try { await this.refresh(); }
    catch (error) { if (!this.closed) this.report(error); }
  }
}
