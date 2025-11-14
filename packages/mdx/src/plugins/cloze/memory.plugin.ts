// mdx/plugins/cloze/memory.plugin.ts
import type { MDxPlugin, PluginContext } from '../../core/plugin';

export interface MemoryPluginOptions {
  gradingTimeout?: number;
  className?: string;
}

export class MemoryPlugin implements MDxPlugin {
  name = 'feature:memory';
  private options: Required<MemoryPluginOptions>;
  private cleanupFns: Array<() => void> = [];
  private clozeStatesCache = new WeakMap<PluginContext, Map<string, any>>();

  constructor(options: MemoryPluginOptions = {}) {
    this.options = {
      gradingTimeout: options.gradingTimeout || 10000,
      className: options.className || 'mdx-memory',
    };
  }
  
  private getCache(context: PluginContext): Map<string, any> {
      if (!this.clozeStatesCache.has(context)) {
          this.clozeStatesCache.set(context, new Map());
      }
      return this.clozeStatesCache.get(context)!;
  }

  install(context: PluginContext): void {
    const removeClozeRevealed = context.listen('clozeRevealed', (data: any) => {
      this.showGradingPanel(data.element, context);
    });
    if (removeClozeRevealed) this.cleanupFns.push(removeClozeRevealed);

    const removeBatchToggle = context.listen('clozeBatchGradeToggle', (data: { container?: HTMLElement }) => {
      this.showBatchGrading(context, data.container);
    });
    if (removeBatchToggle) this.cleanupFns.push(removeBatchToggle);

    const removeDomUpdated = context.on('domUpdated', async ({ element }: { element: HTMLElement }) => {
      await this.syncWithVFS(context);
      this.updateClozeVisuals(element, context);
    });
    if (removeDomUpdated) this.cleanupFns.push(removeDomUpdated);
  }

  private async syncWithVFS(context: PluginContext): Promise<void> {
    const store = context.getScopedStore();
    try {
        const srsData = await store.get('_mdx_srs') || {};
        this.getCache(context).clear();
        for (const [key, value] of Object.entries(srsData)) {
            this.getCache(context).set(key, value);
        }
    } catch (error) {
      console.warn('MemoryPlugin: Failed to sync with persistence store:', error);
    }
  }

  private updateClozeVisuals(element: HTMLElement, context: PluginContext): void {
    const cache = this.getCache(context);
    const clozes = element.querySelectorAll('.mdx-cloze');
    clozes.forEach(cloze => {
      const locator = cloze.getAttribute('data-cloze-locator');
      if (!locator) return;

      const state = cache.get(locator);
      
      cloze.classList.remove('is-new', 'is-learning', 'is-mature', 'is-due');
      
      if (!state) {
        cloze.classList.add('is-new');
        return;
      }

      if (state.dueAt && new Date(state.dueAt) <= new Date()) {
        cloze.classList.add('is-due');
        cloze.classList.remove('hidden');
      } else if (state.status === 'mature') {
        cloze.classList.add('is-mature');
      } else {
        cloze.classList.add('is-learning');
      }
    });
  }

  private showGradingPanel(clozeElement: HTMLElement, context: PluginContext): void {
    const existing = clozeElement.querySelector(`.${this.options.className}__panel`);
    if (existing) return;

    const panel = document.createElement('div');
    panel.className = `${this.options.className}__panel`;
    panel.innerHTML = `
      <button data-grade="1">Again</button>
      <button data-grade="2">Hard</button>
      <button data-grade="3">Good</button>
      <button data-grade="4">Easy</button>
    `;

    const timeout = setTimeout(() => {
      this.gradeCard(clozeElement, 3, context);
      panel.remove();
    }, this.options.gradingTimeout);

    panel.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      
      clearTimeout(timeout);
      const grade = parseInt(btn.getAttribute('data-grade') || '3', 10);
      this.gradeCard(clozeElement, grade, context);
      panel.remove();
    });

    clozeElement.appendChild(panel);
  }

  private showBatchGrading(context: PluginContext, container?: HTMLElement): void {
      const scope = container || document;
    const clozes = scope.querySelectorAll('.mdx-cloze:not(.is-mature)');
    clozes.forEach(cloze => {
      if (!cloze.classList.contains('hidden')) {
        this.showGradingPanel(cloze as HTMLElement, context);
      }
    });
  }

  private async gradeCard(clozeElement: HTMLElement, grade: number, context: PluginContext): Promise<void> {
    const locator = clozeElement.getAttribute('data-cloze-locator');
    if (!locator) return;

    const store = context.getScopedStore();
    const srsProvider = context.inject('srsProvider');

    try {
      if (srsProvider?.gradeCard) {
        await srsProvider.gradeCard(locator, grade);
        await this.syncWithVFS(context);
        
        const container = clozeElement.closest('.mdx-editor-renderer');
        if (container) {
          this.updateClozeVisuals(container as HTMLElement, context);
        }
      } else {
          console.warn("MemoryPlugin: No 'srsProvider' found to grade card.");
      }
    } catch (error) {
      console.error('MemoryPlugin: Failed to grade card:', error);
    }
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
}
