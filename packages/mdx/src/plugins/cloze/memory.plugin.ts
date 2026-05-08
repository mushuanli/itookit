// mdx/plugins/cloze/memory.plugin.ts
import type { MDxPlugin, PluginContext, ScopedPersistenceStore } from '../../core/types';
import type { SRSItemData } from '@itookit/common';  // ✅ 导入类型

export interface MemoryPluginOptions {
  gradingTimeout?: number;
  className?: string;
  /** 冷却时间（毫秒），点击 Again 后多久才能再次评分 */
  coolingPeriod?: number;
  /** 严重过期的天数阈值 */
  dangerThresholdDays?: number;
  /** 是否启用调试日志 */
  debug?: boolean;

  /** 
   * 在到期前多少小时自动隐藏卡片（即使还没完全到期）。
   * @default 12 
   */
  hideBeforeDueHours?: number;
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

// 状态定义：
// is-new: 新卡片 (Hidden)
// is-cooling: 冷却中 (Visible, 无菜单)
// is-learning: 学习中/短间隔 (Hidden)
// is-due: 到期 (Hidden)
// is-danger: 严重过期 (Hidden, 红色)
// is-cleared: 已掌握/Easy (Visible, 点击关闭，再次打开显示菜单)
type ClozeStateClass = 'is-new' | 'is-cooling' | 'is-learning' | 'is-due' | 'is-danger' | 'is-cleared';

export class MemoryPlugin implements MDxPlugin {
  name = 'cloze:memory';
  private options: Required<MemoryPluginOptions>;
  private cleanupFns: Array<() => void> = [];
  private clozeStatesCache = new WeakMap<PluginContext, Map<string, SRSCardState>>();
  private storeRef: ScopedPersistenceStore | null = null;

  // [新增] 同步状态追踪
  private syncedContexts = new WeakSet<PluginContext>();
  private syncPromise: Promise<void> | null = null;

  constructor(options: MemoryPluginOptions = {}) {
    this.options = {
      gradingTimeout: options.gradingTimeout || 300000,
      className: options.className || 'mdx-memory',
      coolingPeriod: options.coolingPeriod || 60000, // 默认1分钟冷却
      dangerThresholdDays: options.dangerThresholdDays || 7, // 超过7天为严重过期
      debug: options.debug ?? false, // 🟢 默认开启调试，生产环境可关闭
      hideBeforeDueHours: options.hideBeforeDueHours ?? 12, // 默认提前12小时隐藏
    };
  }

  private log(_message: string, ..._args: any[]) {
    if (this.options.debug) {
      //console.log(`🧠 [MemoryPlugin] ${message}`, ...args);
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

    // --- 关键逻辑 1: 监听 Cloze 打开事件 ---
    // 这个事件只有在 Cloze 从 [隐藏] -> [显示] 状态切换时才会触发 (由 ClozePlugin 发出)
    const removeClozeRevealed = context.listen('clozeRevealed', (data: any) => {
      const stateClass = data.element.dataset.stateClass as ClozeStateClass;

      // 1. 冷却中的卡片 (Again 之后) 打开时不显示菜单，避免干扰
      if (stateClass === 'is-cooling') {
        this.log('Card is cooling, skip grading panel', data.clozeId);
        return;
      }

      // 2. is-cleared (Easy) 的卡片，如果是用户手动点击打开的，应该显示菜单
      // 这样用户可以修改之前的评分，或者重新复习

      const isLocked = data.element.closest('.is-global-override');
      const timeout = isLocked ? 0 : this.options.gradingTimeout;

      this.showGradingPanel(data.element, context, timeout);
    });
    if (removeClozeRevealed) this.cleanupFns.push(removeClozeRevealed);

    // 批量评分支持
    const removeBatchToggle = context.listen('clozeBatchGradeToggle', (data: { container?: HTMLElement }) => {
      this.showBatchGrading(context, data.container);
    });
    if (removeBatchToggle) this.cleanupFns.push(removeBatchToggle);

    // [优化] DOM 更新时的同步逻辑
    const removeDomUpdated = context.on('domUpdated', async ({ element }: { element: HTMLElement }) => {
      this.log('DOM updated, checking sync status...');

      // 只在首次加载时同步
      if (!this.syncedContexts.has(context)) {
        // 防止并发同步
        if (!this.syncPromise) {
          this.syncPromise = this.syncWithStore(context).finally(() => {
            this.syncPromise = null;
          });
        }
        await this.syncPromise;
        this.syncedContexts.add(context);
      }

      this.applyVisualsAndState(element, context);
    });
    if (removeDomUpdated) this.cleanupFns.push(removeDomUpdated);
  }

  /**
   * [新增] 强制重新同步方法（供外部调用）
   */
  async forceResync(context: PluginContext): Promise<void> {
    this.syncedContexts.delete(context);
    await this.syncWithStore(context);
    this.syncedContexts.add(context);
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
    if (engine && (engine as any).getSRSStatus && fileId) {
      try {
        const srsItems = await (engine as any).getSRSStatus(fileId);
        const count = Object.keys(srsItems).length;
        this.log(`Loaded ${count} items from Engine VFS.`);

        // ✅ 现在 item 的类型是 SRSItemData
        for (const [clozeId, item] of Object.entries(srsItems as Record<string, SRSItemData>)) {
          cache.set(clozeId, {
            dueAt: new Date(item.dueAt).toISOString(),
            lastReviewedAt: new Date(item.lastReviewedAt).toISOString(),
            lastGrade: 0,
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
        const srsData = (await this.storeRef.get('_mdx_srs')) as Record<string, SRSCardState> | undefined;
        const count = srsData ? Object.keys(srsData).length : 0;
        this.log(`Loaded ${count} items from Metadata Store (Fallback).`);

        if (srsData) {
          for (const [key, value] of Object.entries(srsData)) {
            cache.set(key, value);
          }
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
  private async saveCardState(
    context: PluginContext,
    clozeId: string,
    newState: SRSCardState
  ): Promise<void> {
    const engine = context.getSessionEngine?.();
    const fileId = context.getCurrentNodeId();

    this.log(`Saving card ${clozeId} to FileID: ${fileId}`);

    // 1. 尝试使用 Engine 保存
    // v3.3: IModuleFS doesn't have updateSRSStatus; cast to access deprecated IFSEngine method
    if (engine && (engine as any).updateSRSStatus && fileId) {
      try {
        // ✅ 构建符合 SRSItemData 类型的对象
        const srsData: SRSItemData = {
          dueAt: newState.dueAt ? new Date(newState.dueAt).getTime() : Date.now(),
          lastReviewedAt: newState.lastReviewedAt ? new Date(newState.lastReviewedAt).getTime() : Date.now(),
          interval: newState.interval,
          ease: newState.easeFactor,
          reviewCount: newState.reviewCount
        };

        await (engine as any).updateSRSStatus(fileId, clozeId, srsData);
        this.log(`Saved successfully to Engine VFS.`);
        return;
      } catch (e) {
        console.error('[MemoryPlugin] Failed to save to Engine:', e);
      }
    }

    // 2. 降级：全量保存到元数据
    if (this.storeRef) {
      try {
        const cache = this.getCache(context);
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

    // 2. 冷却逻辑
    // 如果是刚刚复习过的短间隔卡片，且在冷却期内，保持 is-cooling (显示)
    if (state.interval * 24 * 60 * 60 * 1000 < this.options.coolingPeriod * 2) {
      if (lastReviewedAt && dueAt > now) {
        const timeSinceReview = now.getTime() - lastReviewedAt.getTime();
        if (timeSinceReview < this.options.coolingPeriod) {
          return 'is-cooling';
        }
      }
    }

    // 3. 计算“提前隐藏”逻辑
    const timeRemaining = dueAt.getTime() - now.getTime();
    const safetyThreshold = this.options.hideBeforeDueHours * 60 * 60 * 1000;

    // 4. 只有当剩余时间 大于 阈值 (12小时) 时，才显示内容
    if (timeRemaining > safetyThreshold) {
      return 'is-cleared';
    }

    // 5. 否则，进入隐藏状态 (包含 Learning, Due, Danger)

    // 学习中 (间隔小于1天)
    if (state.interval < 1) {
      return 'is-learning';
    }

    // 严重过期
    const overdueDays = -timeRemaining / (24 * 60 * 60 * 1000);
    if (overdueDays >= this.options.dangerThresholdDays) {
      return 'is-danger';
    }

    // 普通到期 (或即将到期)
    return 'is-due';
  }

  /**
   * --- 关键逻辑 2: 应用视觉状态 ---
   * 负责初始化 DOM 时的显隐控制
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

      // 1. 更新 CSS 类
      cloze.classList.remove('is-new', 'is-cooling', 'is-learning', 'is-due', 'is-danger', 'is-cleared');
      cloze.classList.add(stateClass);

      // 2. 存储状态到 dataset，供点击事件使用
      (cloze as HTMLElement).dataset.stateClass = stateClass;

      // 3. 控制显隐 (仅在非全局锁定模式下)
      if (!isGlobalLocked) {
        if (stateClass === 'is-cleared') {
          // Easy 卡片：默认移除 hidden，显示内容
          cloze.classList.remove('hidden');
        } else if (stateClass === 'is-cooling') {
          // 冷却中：也保持显示，方便阅读
          cloze.classList.remove('hidden');
        } else {
          // 其他 (New, Due, Learning)：默认隐藏，等待点击
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
    // 阻止冒泡非常重要，否则点击按钮会触发 ClozePlugin 的 toggle，导致卡片立马关上
    panel.addEventListener('click', (e) => e.stopPropagation());

    panel.innerHTML = `
      <button data-grade="1" title="忘记 (1分钟后重试)">Again</button>
      <button data-grade="2" title="困难 (10分钟后)">Hard</button>
      <button data-grade="3" title="一般 (明天)">Good</button>
      <button data-grade="4" title="简单 (4天后)">Easy</button>
    `;

    let timeout: ReturnType<typeof setTimeout> | null = null;
    if (timeoutDuration > 0) {
      timeout = setTimeout(() => panel.remove(), timeoutDuration);
    }

    panel.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      if (timeout) clearTimeout(timeout);

      const grade = parseInt(btn.getAttribute('data-grade') || '3', 10);

      // 评分后移除面板
      panel.remove();

      // 执行评分逻辑
      await this.gradeCard(clozeElement, grade, context);
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

      // --- 关键逻辑 3: 评分后的显隐控制 ---
      // 如果变成了 is-cleared (Easy/Good) 或 is-cooling (Again)
      // 强制保持打开状态 (remove hidden)
      // 此时因为不是通过 ClozePlugin 的 click 触发的，所以不会发 clozeRevealed 事件，也就不会再次显示 Panel
      if (stateClass === 'is-cleared' || stateClass === 'is-cooling') {
        clozeElement.classList.remove('hidden');
      }
      // 注意：如果评分结果导致它应该隐藏 (比如某种 logic)，这里可以 add('hidden')
      // 但对于 SRS，通常评分后我们希望看到结果（或者自动跳到下一个），这里保持显示是合理的。

      this.log(`Graded "${locator}" with ${grade}. State: ${stateClass}`);

    } catch (error) {
      console.error('[MemoryPlugin] grading error:', error);
    }
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.storeRef = null;
    this.syncPromise = null;
  }
}
