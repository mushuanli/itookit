// mdx/plugins/cloze/memory.plugin.ts
import type { MDxPlugin, PluginContext, ScopedPersistenceStore } from '../../core/plugin';

export interface MemoryPluginOptions {
  gradingTimeout?: number;
  className?: string;
  /** 冷却时间（毫秒），点击 Again 后多久才能再次评分 */
  coolingPeriod?: number;
  /** 严重过期的天数阈值 */
  dangerThresholdDays?: number;
  /** 是否启用调试日志 */
  debug?: boolean;
}

interface SRSCardState {
  /** Due date for next review */
  dueAt: string | null;
  /** Last review date */
  lastReviewedAt: string | null;
  /** Last grade given (1-4) */
  lastGrade: number | null;
  /** Number of times reviewed */
  reviewCount: number;
  /** Current interval in days */
  interval: number;
  /** Ease factor for SM-2 algorithm */
  easeFactor: number;
}

type ClozeStateClass = 'is-new' | 'is-cooling' | 'is-learning' | 'is-due' | 'is-danger' | 'is-cleared';

export class MemoryPlugin implements MDxPlugin {
  name = 'cloze:memory';
  private options: Required<MemoryPluginOptions>;
  private cleanupFns: Array<() => void> = [];
  private clozeStatesCache = new WeakMap<PluginContext, Map<string, SRSCardState>>();
  private storeRef: ScopedPersistenceStore | null = null;

  constructor(options: MemoryPluginOptions = {}) {
    this.options = {
      gradingTimeout: options.gradingTimeout || 300000,
      className: options.className || 'mdx-memory',
      coolingPeriod: options.coolingPeriod || 60000, // 默认1分钟冷却
      dangerThresholdDays: options.dangerThresholdDays || 7, // 超过7天为严重过期
      debug: options.debug ?? true, // 🟢 默认开启调试，生产环境可关闭
    };
  }

  private log(message: string, ...args: any[]) {
    if (this.options.debug) {
      console.log(`🧠 [MemoryPlugin] ${message}`, ...args);
    }
  }

  private getCache(context: PluginContext): Map<string, SRSCardState> {
    if (!this.clozeStatesCache.has(context)) {
      this.clozeStatesCache.set(context, new Map());
    }
    return this.clozeStatesCache.get(context)!;
  }

  install(context: PluginContext): void {
    this.storeRef = context.getScopedStore();

    // 监听 Cloze 打开事件
    const removeClozeRevealed = context.listen('clozeRevealed', (data: any) => {
      const stateClass = data.element.dataset.stateClass as ClozeStateClass;
      
      // 冷却中的卡片不显示评分面板
      if (stateClass === 'is-cooling') {
        this.log('Card is cooling, skip grading panel', data.clozeId);
        return;
      }
      
      const isLocked = data.element.closest('.is-global-override');
      const timeout = isLocked ? 0 : this.options.gradingTimeout;
      this.showGradingPanel(data.element, context, timeout);
    });
    if (removeClozeRevealed) this.cleanupFns.push(removeClozeRevealed);

    // 批量评分
    const removeBatchToggle = context.listen('clozeBatchGradeToggle', (data: { container?: HTMLElement }) => {
      this.showBatchGrading(context, data.container);
    });
    if (removeBatchToggle) this.cleanupFns.push(removeBatchToggle);

    // DOM 更新时应用状态
    const removeDomUpdated = context.on('domUpdated', async ({ element }: { element: HTMLElement }) => {
      this.log('DOM updated, starting sync...');
      await this.syncWithStore(context);
      this.applyVisualsAndState(element, context);
    });
    if (removeDomUpdated) this.cleanupFns.push(removeDomUpdated);
  }

  /**
   * ✨ [重构] 同步逻辑
   * 优先使用 Engine.getSRSStatus，否则回退到 storeRef (metadata)
   */
  private async syncWithStore(context: PluginContext): Promise<void> {
    const engine = context.getSessionEngine?.();
    const fileId = context.getCurrentNodeId();
    const cache = this.getCache(context);
    cache.clear();

    this.log(`Syncing store. FileID: ${fileId || 'N/A'}, Engine Available: ${!!engine}`);

    // 1. 尝试使用 Engine 加载 SRS (VFS SRS Store)
    if (engine && engine.getSRSStatus && fileId) {
        try {
            const srsItems = await engine.getSRSStatus(fileId);
            const count = Object.keys(srsItems).length;
            this.log(`Loaded ${count} items from Engine VFS.`);

            // 转换为 plugin 内部格式 (Timestamp -> ISO String)
            for (const [clozeId, item] of Object.entries(srsItems)) {
                cache.set(clozeId, {
                    dueAt: new Date(item.dueAt).toISOString(),
                    lastReviewedAt: new Date(item.lastReviewedAt).toISOString(),
                    lastGrade: 0, // VFS 未存储上一次评分具体数值
                    reviewCount: item.reviewCount,
                    interval: item.interval,
                    easeFactor: item.ease
                });
            }
            return;
        } catch (e) {
            console.warn('[MemoryPlugin] Failed to sync from Engine, falling back to Metadata store.', e);
        }
    } else {
        this.log('Skipping Engine sync (Conditions not met). Fallback to metadata?');
    }

    // 2. 降级：使用旧的元数据存储
    if (this.storeRef) {
      try {
        const srsData = (await this.storeRef.get('_mdx_srs')) || {};
        const count = Object.keys(srsData).length;
        this.log(`Loaded ${count} items from Metadata Store (Fallback).`);
        
        for (const [key, value] of Object.entries(srsData)) {
          cache.set(key, value as SRSCardState);
        }
      } catch (error) {
        console.warn('[MemoryPlugin] Metadata sync error:', error);
      }
    }
  }

  /**
   * ✨ [重构] 保存逻辑
   * 单个卡片评分后触发
   */
  private async saveCardState(context: PluginContext, clozeId: string, newState: SRSCardState): Promise<void> {
      const engine = context.getSessionEngine?.();
      const fileId = context.getCurrentNodeId();

      this.log(`Saving card ${clozeId} to FileID: ${fileId}`);

      // 1. 尝试使用 Engine 保存 (VFS SRS Store)
      if (engine && engine.updateSRSStatus && fileId) {
          try {
              // 转换 plugin 状态 -> VFS 状态
              await engine.updateSRSStatus(fileId, clozeId, {
                  dueAt: newState.dueAt ? new Date(newState.dueAt).getTime() : Date.now(),
                  lastReviewedAt: newState.lastReviewedAt ? new Date(newState.lastReviewedAt).getTime() : Date.now(),
                  interval: newState.interval,
                  ease: newState.easeFactor,
                  reviewCount: newState.reviewCount
                  // snippet: ... (可选) 如果有 DOM 上下文，这里可以提取并传入
              });
              this.log(`Saved successfully to Engine VFS.`);
              return;
          } catch (e) {
              console.error('[MemoryPlugin] Failed to save to Engine:', e);
              // 继续执行降级保存
          }
      }

      // 2. 降级：全量保存到元数据 (旧逻辑)
      if (this.storeRef) {
          try {
            const cache = this.getCache(context);
            // 此时 cache 已经通过 gradeCard 更新了内存状态
            const data: Record<string, SRSCardState> = {};
            cache.forEach((value, key) => {
              data[key] = value;
            });
            await this.storeRef.set('_mdx_srs', data);
            this.log(`Saved successfully to Metadata Store (Fallback).`);
          } catch (error) {
            console.error('[MemoryPlugin] Metadata save error:', error);
          }
      }
  }

  /**
   * 核心状态判定逻辑
   */
  private determineStateClass(state: SRSCardState | undefined): ClozeStateClass {
    // 1. 新卡片 -> Blue
    if (!state || state.reviewCount === 0) {
      return 'is-new';
    }

    const now = new Date();
    const dueAt = state.dueAt ? new Date(state.dueAt) : now;
    const lastReviewedAt = state.lastReviewedAt ? new Date(state.lastReviewedAt) : null;

    // 2. 检查是否在冷却期 (刚点了 Again，且还没到 dueAt)
    // 注意：这里逻辑微调，只要是上次 Again 且未到期，视为冷却
    // 并且检查时间间隔，防止无限冷却
    if (state.interval * 24 * 60 * 60 * 1000 < this.options.coolingPeriod * 2 && dueAt > now) {
         if (lastReviewedAt) {
            const timeSinceReview = now.getTime() - lastReviewedAt.getTime();
            if (timeSinceReview < this.options.coolingPeriod) {
              return 'is-cooling';
            }
         }
    }

    // 3. 未到期 -> Green (已掌握)
    if (dueAt > now) {
      return 'is-cleared';
    }

    // 4. 短间隔到期 (学习中) -> Orange
    if (state.interval < 1) {
      return 'is-learning';
    }

    // 5. 长间隔到期 -> Red
    // 检查是否严重过期
    const overdueDays = (now.getTime() - dueAt.getTime()) / (24 * 60 * 60 * 1000);
    if (overdueDays >= this.options.dangerThresholdDays) {
      return 'is-danger';
    }

    return 'is-due';
  }

  /**
   * 应用视觉状态
   */
  private applyVisualsAndState(element: HTMLElement, context: PluginContext): void {
    const isGlobalLocked = element.classList.contains('is-global-override') ||
      !!element.closest('.is-global-override');
    const cache = this.getCache(context);
    const clozes = element.querySelectorAll('.mdx-cloze');

    let matchedCount = 0;

    clozes.forEach(cloze => {
      const locator = cloze.getAttribute('data-cloze-locator');
      if (!locator) return;

      const state = cache.get(locator);
      
      if (state) matchedCount++;

      const stateClass = this.determineStateClass(state);

      // 清除旧状态
      cloze.classList.remove('is-new', 'is-cooling', 'is-learning', 'is-due', 'is-danger', 'is-cleared');
      cloze.classList.add(stateClass);
      
      // 存储状态到 dataset，供事件处理使用
      (cloze as HTMLElement).dataset.stateClass = stateClass;

      // 视觉行为
      if (!isGlobalLocked) {
        if (stateClass === 'is-cleared') {
          cloze.classList.remove('hidden');
        } else if (stateClass === 'is-cooling') {
          // 冷却中的保持当前状态
        } else {
          cloze.classList.add('hidden');
        }
      }
    });

    this.log(`Applied visuals. Found ${clozes.length} clozes in DOM. Matched ${matchedCount} from Store.`);
  }

  private showGradingPanel(clozeElement: HTMLElement, context: PluginContext, timeoutDuration: number = 0): void {
    const existing = clozeElement.querySelector(`.${this.options.className}__panel`);
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.className = `${this.options.className}__panel`;
    panel.innerHTML = `
      <button data-grade="1" title="忘记 (1分钟后重试)">Again</button>
      <button data-grade="2" title="困难 (10分钟后)">Hard</button>
      <button data-grade="3" title="一般 (明天)">Good</button>
      <button data-grade="4" title="简单 (4天后)">Easy</button>
    `;

    panel.addEventListener('click', (e) => e.stopPropagation());

    let timeout: ReturnType<typeof setTimeout> | null = null;
    if (timeoutDuration > 0) {
      timeout = setTimeout(() => panel.remove(), timeoutDuration);
    }

    panel.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      if (timeout) clearTimeout(timeout);

      const grade = parseInt(btn.getAttribute('data-grade') || '3', 10);
      await this.gradeCard(clozeElement, grade, context);
      panel.remove();
    });

    clozeElement.appendChild(panel);
  }

  private showBatchGrading(context: PluginContext, container?: HTMLElement): void {
    const scope = container || document;
    // 排除冷却中的卡片
    const clozes = scope.querySelectorAll('.mdx-cloze:not(.hidden):not(.is-cooling)');
    clozes.forEach(cloze => {
      this.showGradingPanel(cloze as HTMLElement, context, 0);
    });
  }

  /**
   * SM-2 变种算法
   */
  private calculateNextReview(currentState: SRSCardState | undefined, grade: number): SRSCardState {
    const now = new Date();

    const state: SRSCardState = currentState ? { ...currentState } : {
      dueAt: null,
      lastReviewedAt: null,
      lastGrade: null,
      reviewCount: 0,
      interval: 0,
      easeFactor: 2.5,
    };

    const ONE_MINUTE = 1 / 1440;
    const TEN_MINUTES = 10 / 1440;

    let nextInterval: number;

    if (grade === 1) {
      state.easeFactor = Math.max(1.3, state.easeFactor - 0.2);
      nextInterval = ONE_MINUTE;
    } else if (state.interval < 1) {
      switch (grade) {
        case 2: nextInterval = ONE_MINUTE * 5; break;
        case 3: nextInterval = state.interval >= TEN_MINUTES * 0.9 ? 1 : TEN_MINUTES; break;
        case 4: nextInterval = 4; break;
        default: nextInterval = ONE_MINUTE;
      }
    } else {
      switch (grade) {
        case 2:
          state.easeFactor = Math.max(1.3, state.easeFactor - 0.15);
          nextInterval = state.interval * 1.2;
          break;
        case 3:
          nextInterval = state.interval * state.easeFactor;
          break;
        case 4:
          state.easeFactor += 0.15;
          nextInterval = state.interval * state.easeFactor * 1.3;
          break;
        default:
          nextInterval = 1;
      }
    }

    state.lastReviewedAt = now.toISOString();
    state.lastGrade = grade;
    state.reviewCount++;
    state.interval = nextInterval;
    state.dueAt = new Date(now.getTime() + nextInterval * 24 * 60 * 60 * 1000).toISOString();

    return state;
  }

  private async gradeCard(clozeElement: HTMLElement, grade: number, context: PluginContext): Promise<void> {
    const locator = clozeElement.getAttribute('data-cloze-locator');
    if (!locator) return;

    try {
      const cache = this.getCache(context);
      const currentState = cache.get(locator);
      const newState = this.calculateNextReview(currentState, grade);

      // 1. 更新内存缓存
      cache.set(locator, newState);
      
      // 2. ✨ [重构] 调用新的保存逻辑
      await this.saveCardState(context, locator, newState);

      // 3. 立即更新视觉
      clozeElement.classList.remove('is-new', 'is-cooling', 'is-learning', 'is-due', 'is-danger', 'is-cleared');
      const stateClass = this.determineStateClass(newState);
      clozeElement.classList.add(stateClass);
      clozeElement.dataset.stateClass = stateClass;

      if (stateClass === 'is-cleared' || stateClass === 'is-cooling') {
        clozeElement.classList.remove('hidden');
      }

      this.log(`Graded "${locator}" with ${grade}. State: ${stateClass}`);

    } catch (error) {
      console.error('[MemoryPlugin] grading error:', error);
    }
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.storeRef = null;
  }
}
