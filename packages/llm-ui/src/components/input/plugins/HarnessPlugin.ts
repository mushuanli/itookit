// @file: llm-ui/components/input/plugins/HarnessPlugin.ts
//
// HarnessPlugin — 在 ChatInput 区域展示 AgentLoopExecutor 的实时执行状态。
//
// 功能：
//   1. 工具执行状态条：显示正在执行的工具名称及历史记录
//   2. 预算警告横幅：token/cost 接近上限时提醒
//   3. 上下文压缩提示：发生压缩时闪现提示
//   4. 权限确认 UI：file_write 等操作需要用户批准时显示 Allow/Deny 横幅
//   5. HITL 输入 UI：Agent 调用 human_input 工具时显示问题并收集用户响应
//
// 事件订阅在 activate() 中注册（每次设置新 runtime），
// 在 setRuntime(null) 或 deactivate() 时清理。

import type { IAgentRuntime } from '@itookit/common';
import { t, FEEDBACK_ICONS, ENTITY_ICONS, EXECUTOR_TYPE_ICONS } from '@itookit/common';
import type { InputPlugin, InputPluginContext } from './InputPlugin';

/** 单个活跃工具的状态 */
interface ActiveTool {
    id: string;       // toolId
    startTime: number;
}

/** 挂起的权限请求 */
interface PendingPermission {
    toolId: string;
    args: Record<string, unknown>;
    resolve: (allow: boolean) => void;
}

/** HITL 输入请求 */
interface HitlRequestInfo {
    requestId: string;
    question: string;
    context: string;
    options?: string[];
}

const PLUGIN_ID = 'harness-status';
const STATUS_BAR_CLASS = 'harness-status-bar';
const PERM_BANNER_CLASS = 'harness-permission-banner';
const HITL_BANNER_CLASS = 'harness-hitl-banner';

/**
 * HarnessPlugin（priority=10 — 在 history(50) 和 slash(40) 之前激活）
 */
export class HarnessPlugin implements InputPlugin {
    readonly id = PLUGIN_ID;
    readonly priority = 10;

    private ctx: InputPluginContext | null = null;
    private runtime: IAgentRuntime | null = null;
    private unsubs: Array<() => void> = [];

    private statusBar: HTMLElement | null = null;
    private permBanner: HTMLElement | null = null;
    private hitlBanner: HTMLElement | null = null;
    private activeTools: ActiveTool[] = [];
    private completedCount = 0;
    private pendingPermission: PendingPermission | null = null;
    private hitlRequests = new Map<string, HitlRequestInfo>();

    constructor(runtime?: IAgentRuntime) {
        if (runtime) this.runtime = runtime;
    }

    activate(ctx: InputPluginContext): void {
        this.ctx = ctx;
        this.injectStyles();
        if (this.runtime) this.subscribeToRuntime(this.runtime);
    }

    /**
     * Swap the runtime (called by ChatInput when Shell updates it).
     * Cleans up old subscriptions and creates new ones.
     */
    setRuntime(runtime: IAgentRuntime | null): void {
        this.cleanupSubscriptions();
        this.runtime = runtime;
        if (runtime && this.ctx) {
            this.subscribeToRuntime(runtime);
        } else {
            this.hideStatusBar();
            this.hidePerm();
            this.hideHitlBanner();
        }
    }

    deactivate(): void {
        this.cleanupSubscriptions();
        this.statusBar?.remove();
        this.permBanner?.remove();
        this.hitlBanner?.remove();
        this.statusBar = null;
        this.permBanner = null;
        this.hitlBanner = null;
        this.hitlRequests.clear();
        this.ctx = null;
    }

    // ── Plugin hooks (no-ops — this plugin is event-driven, not input-driven) ──

    // ── Private ──────────────────────────────────────────────────────────────

    private subscribeToRuntime(rt: IAgentRuntime): void {
        // Task lifecycle
        this.unsubs.push(rt.on('agent:task:start', () => {
            this.activeTools = [];
            this.completedCount = 0;
            this.hitlRequests.clear();
            this.hideHitlBanner();
            this.renderStatusBar();
        }));

        // In agent:task:end, also clean up HITL banners since the task is finished
        this.unsubs.push(rt.on('agent:task:end', () => {
            this.activeTools = [];
            this.completedCount = 0;
            this.hitlRequests.clear();
            this.hideStatusBar();
            this.hidePerm();
            this.hideHitlBanner();
        }));

        // Tool execution
        this.unsubs.push(rt.on('agent:tool:start', ({ toolId }) => {
            this.activeTools.push({ id: toolId, startTime: Date.now() });
            this.renderStatusBar();
        }));

        this.unsubs.push(rt.on('agent:tool:success', ({ toolId }) => {
            this.removeActiveTool(toolId);
            this.completedCount++;
            this.renderStatusBar();
        }));

        this.unsubs.push(rt.on('agent:tool:error', ({ toolId }) => {
            this.removeActiveTool(toolId);
            this.renderStatusBar();
        }));

        this.unsubs.push(rt.on('agent:tool:timeout', ({ toolId }) => {
            this.removeActiveTool(toolId);
            this.renderStatusBar();
        }));

        // Budget warning
        this.unsubs.push(rt.on('agent:budget:warning', ({ resource, usedRatio }) => {
            this.showBudgetWarning(resource, usedRatio);
        }));

        // Context compression
        this.unsubs.push(rt.on('agent:context:compressed', ({ layerName, beforeTokens, afterTokens }) => {
            const saved = beforeTokens - afterTokens;
            this.flashCompressionHint(layerName, saved);
        }));

        // Skill loaded
        this.unsubs.push(rt.on('agent:skill:loaded', ({ skillId }) => {
            this.flashSkillLoaded(skillId);
        }));

        // Permission request — intercept mode
        this.unsubs.push(rt.onIntercept('agent:permission:request', async (payload) => {
            return this.requestPermission(payload.toolId, payload.args);
        }));

        // HITL: Agent requests human input
        this.unsubs.push(rt.on('agent:human:input', (payload) => {
            this.showHitlRequest(payload);
        }));

        // HITL: Input resolved (cleanup from agent side)
        this.unsubs.push(rt.on('agent:human:resolved', ({ requestId }) => {
            this.removeHitlRequest(requestId);
        }));
    }

    private cleanupSubscriptions(): void {
        for (const unsub of this.unsubs) unsub();
        this.unsubs = [];
    }

    // ── Status bar ────────────────────────────────────────────────────────────

    private ensureStatusBar(): HTMLElement {
        if (!this.statusBar) {
            this.statusBar = document.createElement('div');
            this.statusBar.className = STATUS_BAR_CLASS;
            this.statusBar.style.display = 'none';
            // .llm-input__field-wrapper is inside .llm-input__main, not a direct
            // child of ctx.container — use wrapper.parentElement to insertBefore correctly.
            const wrapper = this.ctx!.container.querySelector('.llm-input__field-wrapper');
            const parent = wrapper?.parentElement ?? this.ctx!.container;
            parent.insertBefore(this.statusBar, wrapper ?? parent.firstChild);
        }
        return this.statusBar;
    }

    private renderStatusBar(): void {
        const bar = this.ensureStatusBar();

        if (this.activeTools.length === 0 && this.completedCount === 0) {
            bar.style.display = 'none';
            return;
        }

        bar.style.display = 'flex';

        const chips = this.activeTools
            .map((tool) => `<span class="${STATUS_BAR_CLASS}__chip ${STATUS_BAR_CLASS}__chip--running">${EXECUTOR_TYPE_ICONS.tool} ${escapeHtml(tool.id)}</span>`)
            .join('');

        const stats = this.completedCount > 0
            ? `<span class="${STATUS_BAR_CLASS}__count">${t('harness.statusBar.done', { count: String(this.completedCount) })}</span>`
            : '';

        bar.innerHTML =
            `<span class="${STATUS_BAR_CLASS}__label">${t('harness.statusBar.toolsLabel')}</span>` +
            chips +
            stats;
    }

    private hideStatusBar(): void {
        if (this.statusBar) this.statusBar.style.display = 'none';
    }

    private removeActiveTool(toolId: string): void {
        const idx = this.activeTools.findIndex((t) => t.id === toolId);
        if (idx >= 0) this.activeTools.splice(idx, 1);
    }

    private showBudgetWarning(resource: string, usedRatio: number): void {
        const bar = this.ensureStatusBar();
        bar.style.display = 'flex';
        const pct = Math.round(usedRatio * 100);
        const warn = document.createElement('span');
        warn.className = `${STATUS_BAR_CLASS}__budget-warn`;
        warn.textContent = `${FEEDBACK_ICONS.warning} ${t('harness.statusBar.budgetWarn', { resource, pct: String(pct) })}`;
        bar.appendChild(warn);
        setTimeout(() => warn.remove(), 5000);
    }

    private flashCompressionHint(layerName: string, savedTokens: number): void {
        const bar = this.ensureStatusBar();
        bar.style.display = 'flex';
        const hint = document.createElement('span');
        hint.className = `${STATUS_BAR_CLASS}__compression`;
        hint.textContent = t('harness.statusBar.compressed', { layerName, savedTokens: String(savedTokens) });
        bar.appendChild(hint);
        setTimeout(() => hint.remove(), 3000);
    }

    private flashSkillLoaded(skillId: string): void {
        const bar = this.ensureStatusBar();
        bar.style.display = 'flex';
        const badge = document.createElement('span');
        badge.className = `${STATUS_BAR_CLASS}__skill`;
        badge.textContent = `${ENTITY_ICONS.skill} ${t('harness.statusBar.skillLoaded', { skillId })}`;
        bar.appendChild(badge);
        setTimeout(() => badge.remove(), 3000);
    }

    // ── Permission banner ─────────────────────────────────────────────────────

    private requestPermission(
        toolId: string,
        args: Record<string, unknown>,
    ): Promise<boolean> {
        // Dismiss any existing permission banner first
        this.resolvePending(false);

        return new Promise<boolean>((resolve) => {
            this.pendingPermission = { toolId, args, resolve };
            this.showPermBanner(toolId, args);
        });
    }

    private showPermBanner(toolId: string, args: Record<string, unknown>): void {
        if (!this.permBanner) {
            this.permBanner = document.createElement('div');
            this.permBanner.className = PERM_BANNER_CLASS;
            // Same fix: use wrapper.parentElement (not ctx.container directly)
            const wrapper = this.ctx!.container.querySelector('.llm-input__field-wrapper');
            const parent = wrapper?.parentElement ?? this.ctx!.container;
            parent.insertBefore(this.permBanner, wrapper ?? parent.firstChild);
        }

        const argSummary = this.summarizeArgs(args);
        this.permBanner.innerHTML =
            `<span class="${PERM_BANNER_CLASS}__msg">Allow <b>${escapeHtml(toolId)}</b>${argSummary ? `: ${escapeHtml(argSummary)}` : ''}?</span>` +
            `<button class="${PERM_BANNER_CLASS}__allow" type="button">Allow</button>` +
            `<button class="${PERM_BANNER_CLASS}__deny" type="button">Deny</button>`;

        this.permBanner.style.display = 'flex';

        this.permBanner.querySelector(`.${PERM_BANNER_CLASS}__allow`)
            ?.addEventListener('click', () => this.resolvePending(true), { once: true });
        this.permBanner.querySelector(`.${PERM_BANNER_CLASS}__deny`)
            ?.addEventListener('click', () => this.resolvePending(false), { once: true });
    }

    private resolvePending(allow: boolean): void {
        if (!this.pendingPermission) return;
        this.pendingPermission.resolve(allow);
        this.pendingPermission = null;
        this.hidePerm();
    }

    private hidePerm(): void {
        if (this.permBanner) this.permBanner.style.display = 'none';
    }

    private summarizeArgs(args: Record<string, unknown>): string {
        const path = args['path'] ?? args['command'] ?? args['pattern'];
        if (typeof path === 'string') return path.length > 50 ? `${path.slice(0, 50)}…` : path;
        return '';
    }

    // ── HITL banner ───────────────────────────────────────────────────────

    private showHitlRequest(payload: {
        requestId: string;
        question: string;
        context: string;
        options?: string[];
    }): void {
        this.hitlRequests.set(payload.requestId, {
            requestId: payload.requestId,
            question: payload.question,
            context: payload.context,
            options: payload.options,
        });
        this.renderHitlBanner();
    }

    private removeHitlRequest(requestId: string): void {
        this.hitlRequests.delete(requestId);
        if (this.hitlRequests.size === 0) {
            this.hideHitlBanner();
        } else {
            this.renderHitlBanner();
        }
    }

    private ensureHitlBanner(): HTMLElement {
        if (!this.hitlBanner) {
            this.hitlBanner = document.createElement('div');
            this.hitlBanner.className = HITL_BANNER_CLASS;
            this.hitlBanner.style.display = 'none';
            const wrapper = this.ctx!.container.querySelector('.llm-input__field-wrapper');
            const parent = wrapper?.parentElement ?? this.ctx!.container;
            parent.insertBefore(this.hitlBanner, wrapper ?? parent.firstChild);
        }
        return this.hitlBanner;
    }

    private renderHitlBanner(): void {
        if (this.hitlRequests.size === 0) {
            this.hideHitlBanner();
            return;
        }

        const banner = this.ensureHitlBanner();
        const entries = Array.from(this.hitlRequests.values());

        const itemsHtml = entries.map((req, idx) => {
            const optionsHtml = req.options?.length
                ? `<div class="${HITL_BANNER_CLASS}__options">${req.options
                    .map((opt, oi) => `<button class="${HITL_BANNER_CLASS}__option" data-hitl-idx="${idx}" data-hitl-opt="${oi}" type="button">${escapeHtml(opt)}</button>`)
                    .join('')}</div>`
                : '';

            return `
                <div class="${HITL_BANNER_CLASS}__item" data-hitl-idx="${idx}">
                    <div class="${HITL_BANNER_CLASS}__question">${escapeHtml(req.question)}</div>
                    <div class="${HITL_BANNER_CLASS}__context">${escapeHtml(req.context.slice(0, 200))}${req.context.length > 200 ? '...' : ''}</div>
                    ${optionsHtml}
                    <div class="${HITL_BANNER_CLASS}__input-row">
                        <input class="${HITL_BANNER_CLASS}__input" type="text" placeholder="${escapeHtml(t('hitl.inputPlaceholder'))}" data-hitl-idx="${idx}" />
                        <button class="${HITL_BANNER_CLASS}__submit" type="button" data-hitl-idx="${idx}">${escapeHtml(t('hitl.submit'))}</button>
                    </div>
                </div>`;
        }).join('');

        banner.innerHTML = itemsHtml;
        banner.style.display = 'flex';

        // Bind options click
        banner.querySelectorAll(`.${HITL_BANNER_CLASS}__option`).forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const el = e.currentTarget as HTMLElement;
                const idx = parseInt(el.dataset.hitlIdx ?? '0', 10);
                const optIdx = parseInt(el.dataset.hitlOpt ?? '0', 10);
                const req = entries[idx];
                if (req?.options?.[optIdx] !== undefined) {
                    this.submitHitlResponse(req.requestId, req.options![optIdx]);
                }
            });
        });

        // Bind submit buttons
        banner.querySelectorAll(`.${HITL_BANNER_CLASS}__submit`).forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const el = e.currentTarget as HTMLElement;
                const idx = parseInt(el.dataset.hitlIdx ?? '0', 10);
                const req = entries[idx];
                if (req) {
                    const input = banner.querySelector(`.${HITL_BANNER_CLASS}__input[data-hitl-idx="${idx}"]`) as HTMLInputElement;
                    const response = input?.value?.trim() || '';
                    if (response) {
                        this.submitHitlResponse(req.requestId, response);
                    }
                }
            });
        });

        // Bind Enter key on input fields
        banner.querySelectorAll(`.${HITL_BANNER_CLASS}__input`).forEach((input) => {
            input.addEventListener('keydown', (e) => {
                if ((e as KeyboardEvent).key === 'Enter') {
                    const el = e.currentTarget as HTMLElement;
                    const idx = parseInt(el.dataset.hitlIdx ?? '0', 10);
                    const req = entries[idx];
                    if (req) {
                        const val = (el as HTMLInputElement).value?.trim();
                        if (val) {
                            this.submitHitlResponse(req.requestId, val);
                        }
                    }
                }
            });
        });
    }

    private submitHitlResponse(requestId: string, response: string): void {
        // Delete from local Map BEFORE calling runtime, so the
        // agent:human:resolved → removeHitlRequest path becomes a no-op
        // and we avoid double-rendering the HITL banner.
        this.hitlRequests.delete(requestId);
        this.runtime?.respondToHumanInput(requestId, response);
        if (this.hitlRequests.size === 0) {
            this.hideHitlBanner();
        } else {
            this.renderHitlBanner();
        }
    }

    private hideHitlBanner(): void {
        if (this.hitlBanner) this.hitlBanner.style.display = 'none';
    }

    // ── Styles ────────────────────────────────────────────────────────────────

    private injectStyles(): void {
        if (document.getElementById('harness-plugin-styles')) return;
        const style = document.createElement('style');
        style.id = 'harness-plugin-styles';
        style.textContent = `
.${STATUS_BAR_CLASS} {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--text-secondary, #888);
    background: var(--bg-secondary, #f5f5f5);
    border-top: 1px solid var(--border-color, #e0e0e0);
    border-radius: 4px 4px 0 0;
    flex-wrap: wrap;
    min-height: 24px;
}
.${STATUS_BAR_CLASS}__label { font-weight: 500; color: var(--text-tertiary, #aaa); }
.${STATUS_BAR_CLASS}__chip {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 10px;
    font-family: monospace;
    font-size: 10px;
}
.${STATUS_BAR_CLASS}__chip--running {
    background: var(--accent-bg, #e8f0fe);
    color: var(--accent, #1967d2);
    animation: harness-pulse 1.2s ease-in-out infinite;
}
.${STATUS_BAR_CLASS}__count { color: var(--text-tertiary, #aaa); }
.${STATUS_BAR_CLASS}__budget-warn { color: #e67e22; font-weight: 500; }
.${STATUS_BAR_CLASS}__compression { color: #27ae60; font-size: 10px; }
.${STATUS_BAR_CLASS}__skill { color: var(--accent, #1967d2); font-size: 10px; }

@keyframes harness-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }

.${PERM_BANNER_CLASS} {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    font-size: 12px;
    background: var(--warning-bg, #fff8e1);
    border: 1px solid var(--warning-border, #ffc107);
    border-radius: 4px 4px 0 0;
    flex-wrap: wrap;
}
.${PERM_BANNER_CLASS}__msg { flex: 1; color: var(--text-primary, #333); }
.${PERM_BANNER_CLASS}__allow,
.${PERM_BANNER_CLASS}__deny {
    padding: 2px 10px;
    border-radius: 4px;
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
}
.${PERM_BANNER_CLASS}__allow {
    background: var(--accent, #1967d2);
    color: #fff;
    border-color: var(--accent, #1967d2);
}
.${PERM_BANNER_CLASS}__deny {
    background: transparent;
    color: var(--text-secondary, #666);
    border-color: var(--border-color, #ccc);
}
.${PERM_BANNER_CLASS}__deny:hover { background: var(--bg-hover, #f0f0f0); }

.${HITL_BANNER_CLASS} {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
    font-size: 13px;
    background: var(--bg-primary, #fff);
    border: 1px solid #e67e22;
    border-radius: 4px 4px 0 0;
    max-height: 320px;
    overflow-y: auto;
}
.${HITL_BANNER_CLASS}__item {
    padding: 8px;
    background: var(--bg-secondary, #f9f9f9);
    border-radius: 4px;
    border-left: 3px solid #e67e22;
}
.${HITL_BANNER_CLASS}__question {
    font-weight: 600;
    color: var(--text-primary, #333);
    margin-bottom: 4px;
}
.${HITL_BANNER_CLASS}__context {
    font-size: 11px;
    color: var(--text-secondary, #888);
    margin-bottom: 6px;
    max-height: 60px;
    overflow-y: auto;
}
.${HITL_BANNER_CLASS}__options {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
    flex-wrap: wrap;
}
.${HITL_BANNER_CLASS}__option {
    padding: 2px 10px;
    border-radius: 12px;
    border: 1px solid var(--accent, #1967d2);
    background: transparent;
    color: var(--accent, #1967d2);
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
}
.${HITL_BANNER_CLASS}__option:hover {
    background: var(--accent-bg, #e8f0fe);
}
.${HITL_BANNER_CLASS}__input-row {
    display: flex;
    gap: 6px;
}
.${HITL_BANNER_CLASS}__input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 4px;
    font-size: 13px;
    outline: none;
}
.${HITL_BANNER_CLASS}__input:focus {
    border-color: var(--accent, #1967d2);
}
.${HITL_BANNER_CLASS}__submit {
    padding: 4px 14px;
    border-radius: 4px;
    border: 1px solid var(--accent, #1967d2);
    background: var(--accent, #1967d2);
    color: #fff;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
}
.${HITL_BANNER_CLASS}__submit:hover {
    opacity: 0.9;
}
`;
        document.head.appendChild(style);
    }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
