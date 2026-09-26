/** One execution boundary for menus, toolbars, row actions and bulk actions. */
export class ActionRunner {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly abort = new AbortController();
  constructor(private readonly report: (error: unknown) => void = error => alert(String(error))) {}
  run(id: string, operation: (signal: AbortSignal) => void | Promise<void>): Promise<void> {
    if (this.abort.signal.aborted) return Promise.resolve();
    const current = this.pending.get(id);
    if (current) return current;
    const work = Promise.resolve().then(() => { if (!this.abort.signal.aborted) return operation(this.abort.signal); });
    this.pending.set(id, work);
    void work.catch(error => { if (!this.abort.signal.aborted) this.report(error); })
      .finally(() => { if (this.pending.get(id) === work) this.pending.delete(id); });
    return work;
  }
  destroy(): void { this.abort.abort(); this.pending.clear(); }
}
