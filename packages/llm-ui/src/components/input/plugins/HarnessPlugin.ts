// @file: llm-ui/components/input/plugins/HarnessPlugin.ts
//
// HarnessPlugin — 在 ChatInput 区域展示 AgentLoopExecutor 的实时执行状态。
//
// 功能：
//   1. 工具执行状态条：显示正在执行的工具名称及历史记录
//   2. 预算警告横幅：token/cost 接近上限时提醒
//   3. 上下文压缩提示：发生压缩时闪现提示
//   4. 权限确认 UI：file_write 等操作需要用户批准时显示 Allow/Deny 横幅
//
// 事件订阅在 activate() 中注册（每次设置新 runtime），
// 在 setRuntime(null) 或 deactivate() 时清理。

import type { IAgentRuntime } from '@itookit/common';
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

const PLUGIN_ID = 'harness-status';
const STATUS_BAR_CLASS = 'harness-status-bar';
const PERM_BANNER_CLASS = 'harness-permission-banner';

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
    private activeTools: ActiveTool[] = [];
    private completedCount = 0;
    private pendingPermission: PendingPermission | null = null;

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
        }
    }

    deactivate(): void {
        this.cleanupSubscriptions();
        this.statusBar?.remove();
        this.permBanner?.remove();
        this.statusBar = null;
        this.permBanner = null;
        this.ctx = null;
    }

    // ── Plugin hooks (no-ops — this plugin is event-driven, not input-driven) ──

    // ── Private ──────────────────────────────────────────────────────────────

    private subscribeToRuntime(rt: IAgentRuntime): void {
        // Task lifecycle
        this.unsubs.push(rt.on('agent:task:start', () => {
            this.activeTools = [];
            this.completedCount = 0;
            this.renderStatusBar();
        }));

        this.unsubs.push(rt.on('agent:task:end', () => {
            this.activeTools = [];
            this.hideStatusBar();
            this.hidePerm();
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
            .map((t) => `<span class="${STATUS_BAR_CLASS}__chip ${STATUS_BAR_CLASS}__chip--running">⚙ ${escapeHtml(t.id)}</span>`)
            .join('');

        const stats = this.completedCount > 0
            ? `<span class="${STATUS_BAR_CLASS}__count">${this.completedCount} done</span>`
            : '';

        bar.innerHTML =
            `<span class="${STATUS_BAR_CLASS}__label">Tools</span>` +
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
        warn.textContent = `⚠ ${resource} ${pct}%`;
        bar.appendChild(warn);
        setTimeout(() => warn.remove(), 5000);
    }

    private flashCompressionHint(layerName: string, savedTokens: number): void {
        const bar = this.ensureStatusBar();
        bar.style.display = 'flex';
        const hint = document.createElement('span');
        hint.className = `${STATUS_BAR_CLASS}__compression`;
        hint.textContent = `↓ compressed (${layerName}, −${savedTokens} tokens)`;
        bar.appendChild(hint);
        setTimeout(() => hint.remove(), 3000);
    }

    private flashSkillLoaded(skillId: string): void {
        const bar = this.ensureStatusBar();
        bar.style.display = 'flex';
        const badge = document.createElement('span');
        badge.className = `${STATUS_BAR_CLASS}__skill`;
        badge.textContent = `✦ ${skillId}`;
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
`;
        document.head.appendChild(style);
    }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
