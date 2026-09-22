// @file: llm-ui/components/input/plugins/SlashCommandPlugin.ts

import type { InputPlugin, InputPluginContext } from './InputPlugin';
import { PopupPanel, PopupItem } from './PopupPanel';
import type { SkillInfo, SkillInvocation } from '../../../domain/types';
import { parseSkillArgs } from '../SkillInvocationParser';
import { injectStyle } from '../../../utils/styleInjector';
import { insertBeforeWrapper } from '../../../utils/domInsertion';
import { Toast } from '@itookit/ui-common';
import { SLASH_ICONS, ENTITY_ICONS, t, type LocaleKey } from '@itookit/common';

// ── Tool arg parser ──────────────────────────────────────────────────────────
// Parses slash command args: positionals and --flag value pairs.
// Handles quoted strings ("foo bar") as single tokens.

interface ToolArgResult {
    positionals: string[];
    flags: Record<string, string | number | boolean>;
}

function parseToolArgs(raw: string): ToolArgResult {
    const tokens: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (const ch of (raw ?? '').trim()) {
        if (inQuote) {
            if (ch === quoteChar) { inQuote = false; if (current) { tokens.push(current); current = ''; } }
            else current += ch;
        } else if (ch === '"' || ch === "'") {
            inQuote = true; quoteChar = ch;
        } else if (ch === ' ') {
            if (current) { tokens.push(current); current = ''; }
        } else {
            current += ch;
        }
    }
    if (current) tokens.push(current);

    const flags: Record<string, string | number | boolean> = {};
    const positionals: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].startsWith('--')) {
            const key = tokens[i].slice(2);
            const next = tokens[i + 1];
            if (next !== undefined && !next.startsWith('--')) {
                const num = Number(next);
                flags[key] = isNaN(num) ? next : num;
                i++;
            } else {
                flags[key] = true;
            }
        } else {
            positionals.push(tokens[i]);
        }
    }

    // Resolve @path and [name](path) in both positionals and flag values.
    return {
        positionals: positionals.map(resolveAtPath),
        flags: Object.fromEntries(
            Object.entries(flags).map(([k, v]) => [k, typeof v === 'string' ? resolveAtPath(v) : v]),
        ),
    };
}

/**
 * Resolve @path and [name](path) tokens to bare file paths.
 *
 * ChatInput's MentionPlugin inserts mentions as:
 *   @src/index.ts            → bare @-prefixed path (pre-autocomplete)
 *   [src/index.ts](./path)   → Markdown link format (post-autocomplete)
 *
 * Strips the decoration so tool args receive clean paths:
 *   /read @src/index.ts      → { path: "src/index.ts" }
 *   /read [src/index.ts](./src/index.ts) → { path: "./src/index.ts" }
 */
function resolveAtPath(token: string): string {
    // [name](path) → extract path from markdown link
    const mdLink = token.match(/^\[.*?\]\((.+?)\)$/);
    if (mdLink) return mdLink[1];
    // @path → strip @ prefix
    if (token.startsWith('@')) return token.slice(1);
    return token;
}

/**
 * Slash 命令定义
 */
export interface SlashCommandDef {
    /** 命令名（不含 /），小写 kebab-case，可用对象前缀（branch-*、context-*、message-*） */
    name: string;
    /** 显示标签 */
    label: string;
    /** 描述 */
    description: string;
    /**
     * 兼容别名（不含 /）。用于旧命令名与短写法；解析、面板搜索与 `/help` 都走同一张表，
     * 因此别名不会绕过 `name` 的执行路径。
     */
    aliases?: string[];
    /** 图标；必须取自 `@itookit/common` 的 SLASH_ICONS */
    icon?: string;
    /** 分组 */
    group?: string;
    /** 执行函数 */
    execute: (args: string, ctx: InputPluginContext) => void | Promise<void>;
    /** 是否需要参数 */
    hasArgs?: boolean;
    /** 参数占位符 */
    argsPlaceholder?: string;
    /** 执行后是否保留输入框内容（默认 false = 清空） */
    preserveInput?: boolean;
}

/** Panel/help group keys, in display order. Dynamic skill groups reuse the same keys. */
export const SLASH_GROUP_ORDER = ['chat', 'refine', 'context', 'view', 'export', 'branch', 'agent', 'skills', 'skills-active', 'tools', 'files', 'task', 'help'] as const;

/** Group label for display; unknown group keys (custom plugins) render as-is. */
export function slashGroupLabel(group?: string): string | undefined {
    if (!group) return undefined;
    return (SLASH_GROUP_ORDER as readonly string[]).includes(group)
        ? t(`slash.group.${group}` as LocaleKey) : group;
}

/** Resolve a command by canonical name or alias. Aliases never bypass the `name` path. */
export function findCommand(commands: SlashCommandDef[], name: string): SlashCommandDef | undefined {
    const needle = name.trim().toLowerCase();
    return commands.find(command => command.name === needle || command.aliases?.includes(needle));
}

/** Nearest commands for a mistyped slash command (prefix matches first). */
export function suggestCommands(commands: SlashCommandDef[], name: string, limit = 3): string {
    const needle = name.trim().toLowerCase();
    const matches = commands
        .map(command => ({ command, key: [command.name, ...(command.aliases ?? [])]
            .find(candidate => candidate.startsWith(needle) || (needle.length > 2 && candidate.includes(needle))) }))
        .filter((item): item is { command: SlashCommandDef; key: string } => Boolean(item.key))
        .sort((a, b) => Number(b.key.startsWith(needle)) - Number(a.key.startsWith(needle)))
        .slice(0, limit)
        .map(item => `/${item.command.name}`);
    return matches.length ? t('slash.didYouMean', { commands: matches.join(' ') }) : '';
}

/**
 * Slash Command 回调接口
 * 
 * 将命令的实际执行委托给外部（Shell 层），
 * 插件本身不依赖 SessionManager 等业务对象。
 */
export interface SlashCommandCallbacks {
    onFlow?: (args: string) => Promise<boolean>;
    // Common
    onRetry: () => void;
    onClear: () => void;
    onDeleteLast: () => void;
    onReedit: () => void;
    onNew: (args: string) => void;

    // Refine
    onShorter: () => void;
    onLonger: () => void;
    onSimplify: () => void;
    onSummarize: () => void;
    onContinue: () => void;

    // Context
    onHistory: (length: string) => void;
    onFresh: () => void;

    // View
    onFoldCurrent: () => void;
    onFoldAll: () => void;
    onUnfoldAll: () => void;
    onTop: () => void;
    onBottom: () => void;
    onNav: () => void;

    // Tools
    onExport: () => void;
    onCopyAll: () => void;
    onPrint: () => void;

    // Branch
    onCreateBranch: () => void;
    onSwitchBranch: (name: string) => void;
    onBranchPrev: () => void;
    onBranchNext: () => void;
    onListBranches: () => void;
    onRenameBranch: (args: string) => void;
    onDeleteBranch: (name: string) => void;

    // Settings
    onSwitchAgent: (agentId: string) => void;
    onModel: (modelId: string) => void;

    // Help
    onHelp: () => void;

    // ── Kernel: Skills ──────────────────────────────────────────────────────

    /**
     * 加载指定 Skill（如 `/skill docker`）。
     *
     * Load a Skill contribution for the next Agent process.
     * 仅在 kernel 模式可用时有效，否则为 undefined。
     */
    onSkill?: (skillId: string) => Promise<void>;

    /**
     * 列出所有可用 Skill（打开设置面板的 Skill 选项卡）。
     */
    onSkills?: () => void;

    /**
     * 获取当前可用 Skill 列表（含 loaded 状态）。
     *
     * 每次弹出 Slash 面板时调用，动态生成 Skill 快捷命令。
     * 未注入时不显示 Skill 命令。
     */
    getSkills?: () => SkillInfo[];

    /**
     * 弹出面板前请求宿主刷新上面的 Skill 快照。
     *
     * 快照必须是同步读取，所以列表只能在输入过程中异步补齐；未注入时忽略。
     */
    onSkillPickerOpen?: () => void;

    /**
     * 执行 Skill 调用（带参数/文件/文本）。
     *
     * 当用户发送 `/skillname [--key val]* [@file]* [text]` 时触发。
     * 与 onSkill（仅加载）不同，此回调同时加载 Skill 并构建 prompt 发送给 Agent。
     */
    onSkillInvoke?: (invocation: SkillInvocation) => Promise<void>;

    // ── Kernel: Tools ───────────────────────────────────────────────────────

    /**
     * 显示当前 kernel 会话已注册的工具列表。
     */
    onTools?: () => void;

    /**
     * 直接调用 kernel 工具（绕过 LLM，立即执行，结果用 Modal 展示）。
     *
     * 由 `/read` `/grep` `/glob` 等只读 slash 命令触发。
     * 文件：   /read src/index.ts --offset 1 --limit 50
     * 搜索：   /grep "TODO" --glob *.ts
     * 文件搜：/glob "**\/*.test.ts"
     */
    /**
     * 直接调用 kernel 工具。
     * @param displayCmd  用于 UI 显示的原始命令字符串（如 "/read src/index.ts"）
     */
    onToolInvoke?: (toolId: string, args: Record<string, unknown>, displayCmd: string) => Promise<void>;

    // ── Durable privileged task commands ────────────────────────────────────
    onPlan?: (goal: string) => Promise<void>;
    onCancelTask?: () => Promise<void>;
    onResumeTask?: () => Promise<void>;
    onApproveTask?: (note: string) => Promise<void>;
    onAddDirectory?: (args: string) => Promise<void>;
    onSetHome?: (args: string) => Promise<void>;
    onExec?: (command: string) => Promise<void>;

    // ── By the way ────────────────────────────────────────────────────────────

    /** /btw 命令：发送不记入历史的旁注请求 */
    onBtw: (args: string) => void;
}

/**
 * Slash Command 插件
 * 
 * 交互设计（参考 Notion/Discord）：
 * - 输入框开头输入 `/`：触发命令面板
 * - 实时模糊搜索
 * - Enter/Tab 执行选中命令
 * - Esc 关闭并保留输入
 * - 带参数命令：选中后填入命令+占位符
 * 
 * 设计要点：
 * - 命令注册是声明式的
 * - 执行逻辑通过回调委托给 Shell
 * - 不直接依赖 SessionManager（DIP）
 */
export class SlashCommandPlugin implements InputPlugin {
    readonly id = 'slash-commands';
    readonly priority = 40;

    private ctx: InputPluginContext | null = null;
    private panel: PopupPanel | null = null;
    private commands: SlashCommandDef[] = [];
    private readonly cb: SlashCommandCallbacks;

    constructor(callbacks: SlashCommandCallbacks) {
        this.cb = callbacks;
        this.commands = this.buildDefaultCommands(callbacks);
    }

    activate(ctx: InputPluginContext): void {
        this.ctx = ctx;

        this.panel = new PopupPanel(ctx.textarea, {
            maxVisible: 12,
            showSearch: false,
            emptyText: t('slash.panel.empty'),
            footerHint: t('slash.panel.footer'),
            variant: 'slash',
            animated: true,
        });
    }

    /** Read-only command list for the help panel (single source of truth). */
    getCommandList(): SlashCommandDef[] {
        return [...this.commands];
    }

    // ================================================================
    // 注册自定义命令
    // ================================================================

    /**
     * 注册额外命令（供外部扩展）
     */
    registerCommand(command: SlashCommandDef): void {
        this.commands = this.commands.filter(c => c.name !== command.name);
        this.commands.push(command);
    }

    /**
     * 批量注册
     */
    registerCommands(commands: SlashCommandDef[]): void {
        commands.forEach(cmd => this.registerCommand(cmd));
    }

    // ================================================================
    // 键盘钩子
    // ================================================================

    onKeyDown(e: KeyboardEvent): boolean {
        if (this.panel?.isVisible) {
            if (this.panel.handleKeyDown(e)) {
                return true;
            }
            if (e.key === 'Escape') {
                this.closePanel();
                return true;
            }
            return false;
        }
        return false;
    }

    onInput(text: string, _cursorPos: number): void {
        if (!text.startsWith('/')) {
            if (this.panel?.isVisible) this.closePanel();
            return;
        }

        const afterSlash = text.slice(1);
        // Close the popup once the user has moved past the command name
        // (a space means they're now typing args / @files)
        if (afterSlash.includes(' ')) {
            if (this.panel?.isVisible) this.closePanel();
            return;
        }

        this.showCommands(afterSlash);
    }

    onBeforeSend(text: string): boolean | void {
        if (!text.startsWith('/')) return;

        const match = text.match(/^\/(\S+)\s*(.*)/s);
        if (!match) return;

        const [, cmdName, argsStr] = match;

        // Static commands (name or alias) first, then dynamic skill commands.
        const command = findCommand(this.commands, cmdName)
            ?? findCommand(this.buildSkillCommands(), cmdName);
        if (command) {
            this.executeCommand(command, argsStr.trim());
            return false;
        }

        // A bare unknown command is a mistyped command, not chat text: report it instead of
        // silently sending `/foo` to the model. Path-like input (`/etc/hosts`) is left alone.
        if (/^[a-z][a-z0-9-]*$/i.test(cmdName)) {
            Toast.error(`${t('slash.unknown', { name: cmdName })} ${suggestCommands(this.commands, cmdName)}`.trim());
            return false;
        }
    }

    // ================================================================
    // 核心逻辑
    // ================================================================

    private showCommands(query: string): void {
        if (!this.panel) return;

        // The shell caches the Skill list for the synchronous `/sk-<id>` build below; ask it
        // to refresh so a Skill mounted after the editor opened still shows up.
        this.cb.onSkillPickerOpen?.();

        // Merge static commands with dynamic skill commands (fresh each time)
        const skillCommands = this.buildSkillCommands();
        const allCommands = [...this.commands, ...skillCommands];
        const items = this.commandsToPopupItems(allCommands);

        if (!this.panel.isVisible) {
            this.panel.show(items, {
                onSelect: (item) => this.handleSelect(item, allCommands),
                onClose: () => { },
            });
        }

        this.panel.filter(query);
    }

    /**
     * Build slash commands from the enabled skill list (called on each popup open).
     *
     * Only enabled skills appear; each gets a `/sk-<id>` command so users can type
     * `/sk` to filter skill commands distinctly from other slash commands.
     *
     * Loaded skills are grouped separately so users can see what's already active.
     */
    private buildSkillCommands(): SlashCommandDef[] {
        const cb = this.cb;
        // Manual invocation is offered for definition-enabled Skills even when the input
        // checkbox refuses to load them (action / silent), which is what `/sk-<id>` is for.
        const skills = (cb.getSkills?.() ?? []).filter((s: SkillInfo) => s.definitionEnabled);
        return skills.map((skill: SkillInfo) => {
            const cmdName = `sk-${skill.id}`;
            return {
                name: cmdName,
                label: `/sk-${skill.id}`,
                description: skill.loaded
                    ? `${skill.name} (loaded)${skill.description ? ' — ' + skill.description : ''}`
                    : `${skill.name}${skill.description ? ' — ' + skill.description : ''}`,
                icon: skill.icon ?? ENTITY_ICONS.skill,
                group: skill.loaded ? 'skills-active' : 'skills',
                hasArgs: true,
                argsPlaceholder: '@file --param value text',
                preserveInput: false,
                execute: async (args: string, ctx: InputPluginContext) => {
                    if (!cb.onSkillInvoke) {
                        await cb.onSkill?.(skill.id);
                        return;
                    }
                    const selText = (ctx.textarea.selectionStart !== ctx.textarea.selectionEnd)
                        ? ctx.textarea.value.slice(ctx.textarea.selectionStart, ctx.textarea.selectionEnd)
                        : undefined;
                    const invocation = parseSkillArgs(skill.id, args, selText);
                    await cb.onSkillInvoke(invocation);
                },
            };
        });
    }

    private handleSelect(item: PopupItem, allCommands?: SlashCommandDef[]): void {
        if (!this.ctx) return;

        const commands = allCommands ?? this.commands;
        const command = commands.find(c => c.name === item.id);
        if (!command) return;

        if (command.hasArgs) {
            // Insert "/skillname " with cursor right after the space
            // so the user can immediately start typing args / @file refs
            this.ctx.setText(`/${command.name} `);
            this.ctx?.focus();
            this.ctx.setCursorPosition(command.name.length + 2);
        } else {
            this.executeCommand(command, '');
        }
    }

    /**
     * 执行命令
     * 
     * 关键修改：先清空输入，再执行命令。
     * 命令（如 /reedit）可能在执行过程中通过 restoreInput 写入新内容，
     * 如果在执行后清空会覆盖掉命令写入的内容。
     * 
     * 对于声明了 preserveInput 的命令，不做预清空。
     */
    private async executeCommand(command: SlashCommandDef, args: string): Promise<void> {
        if (!this.ctx) return;

        // 执行前清空（除非命令声明保留输入）
        if (!command.preserveInput) {
            this.ctx.setText('');
        }

        try {
            await command.execute(args, this.ctx);
        } catch (e) {
            console.error(`[SlashCommand] Failed to execute /${command.name}:`, e);
            Toast.error(e instanceof Error ? e.message : t('slash.error.failed', { name: command.name }));
        }

        this.ctx?.focus();
    }

    private closePanel(): void {
        this.panel?.hide();
    }

    // ================================================================
    // 默认命令注册
    // ================================================================

    private buildDefaultCommands(cb: SlashCommandCallbacks): SlashCommandDef[] {
        return [
            ...(cb.onFlow ? [{ name: 'flow', label: '/flow', description: t('flow.invoke.description'), icon: SLASH_ICONS.new,
                group: 'chat' as const, hasArgs: true, argsPlaceholder: '[id] [JSON]', preserveInput: true,
                execute: async (args: string, context: InputPluginContext) => {
                    const submitted = context.getText();
                    if (await cb.onFlow!(args) && context.getText() === submitted) context.setText('');
                } }] : []),
            // ── Common ──────────────────────────────────────────
            {
                name: 'new',
                label: '/new',
                description: t('slash.new.description'),
                icon: SLASH_ICONS.new,
                group: 'chat',
                // hasArgs 移除（默认 false）— 面板选中时直接执行，使用默认标题
                // 用户仍可手动输入 `/new my-title` 按 Enter 来指定标题
                execute: (args) => cb.onNew(args),
            },
            {
                name: 'retry',
                label: '/retry',
                description: t('slash.retry.description'),
                icon: SLASH_ICONS.retry,
                group: 'chat',
                execute: () => cb.onRetry(),
            },
            {
                name: 'continue',
                label: '/continue',
                description: t('slash.continue.description'),
                icon: SLASH_ICONS.continue,
                group: 'chat',
                execute: () => cb.onContinue(),
            },
            {
                name: 'reedit',
                label: '/reedit',
                description: t('slash.reedit.description'),
                icon: SLASH_ICONS.reedit,
                group: 'chat',
                preserveInput: true,
                execute: () => cb.onReedit(),
            },
            {
                name: 'delete',
                label: '/delete',
                aliases: ['message-delete'],
                description: t('slash.delete.description'),
                icon: SLASH_ICONS.delete,
                group: 'chat',
                execute: () => cb.onDeleteLast(),
            },
            {
                name: 'clear',
                label: '/clear',
                description: t('slash.clear.description'),
                icon: SLASH_ICONS.clear,
                group: 'chat',
                execute: () => cb.onClear(),
            },
            {
                name: 'btw',
                label: '/btw',
                description: t('slash.btw.description'),
                icon: SLASH_ICONS.btw,
                group: 'chat',
                hasArgs: true,
                argsPlaceholder: 'message...',
                execute: (args) => cb.onBtw(args),
            },

            // ── Refine ──────────────────────────────────────────
            {
                name: 'shorter',
                label: '/shorter',
                description: t('slash.shorter.description'),
                icon: SLASH_ICONS.shorter,
                group: 'refine',
                execute: () => cb.onShorter(),
            },
            {
                name: 'longer',
                label: '/longer',
                description: t('slash.longer.description'),
                icon: SLASH_ICONS.longer,
                group: 'refine',
                execute: () => cb.onLonger(),
            },
            {
                name: 'simplify',
                label: '/simplify',
                description: t('slash.simplify.description'),
                icon: SLASH_ICONS.simplify,
                group: 'refine',
                execute: () => cb.onSimplify(),
            },
            {
                name: 'summarize',
                label: '/summarize',
                description: t('slash.summarize.description'),
                icon: SLASH_ICONS.summarize,
                group: 'refine',
                execute: () => cb.onSummarize(),
            },

            // ── Context ─────────────────────────────────────────
            {
                name: 'history',
                label: '/history',
                aliases: ['context-length'],
                description: t('slash.history.description'),
                icon: SLASH_ICONS.history,
                group: 'context',
                hasArgs: true,
                argsPlaceholder: '<number>',
                execute: (args) => cb.onHistory(args),
            },
            {
                name: 'fresh',
                label: '/fresh',
                aliases: ['context-reset'],
                description: t('slash.fresh.description'),
                icon: SLASH_ICONS.fresh,
                group: 'context',
                execute: () => cb.onFresh(),
            },

            // ── View ────────────────────────────────────────────
            {
                name: 'fold',
                label: '/fold',
                description: t('slash.fold.description'),
                icon: SLASH_ICONS.fold,
                group: 'view',
                execute: () => cb.onFoldCurrent(),
            },
            {
                name: 'fold-all',
                label: '/fold-all',
                aliases: ['foldall'],
                description: t('slash.fold-all.description'),
                icon: SLASH_ICONS.foldAll,
                group: 'view',
                execute: () => cb.onFoldAll(),
            },
            {
                name: 'unfold-all',
                label: '/unfold-all',
                aliases: ['unfoldall'],
                description: t('slash.unfold-all.description'),
                icon: SLASH_ICONS.unfoldAll,
                group: 'view',
                execute: () => cb.onUnfoldAll(),
            },
            {
                name: 'top',
                label: '/top',
                description: t('slash.top.description'),
                icon: SLASH_ICONS.top,
                group: 'view',
                execute: () => cb.onTop(),
            },
            {
                name: 'bottom',
                label: '/bottom',
                description: t('slash.bottom.description'),
                icon: SLASH_ICONS.bottom,
                group: 'view',
                execute: () => cb.onBottom(),
            },
            {
                name: 'nav',
                label: '/nav',
                description: t('slash.nav.description'),
                icon: SLASH_ICONS.nav,
                group: 'view',
                execute: () => cb.onNav(),
            },

            // ── Tools ───────────────────────────────────────────
            {
                name: 'copy',
                label: '/copy',
                description: t('slash.copy.description'),
                icon: SLASH_ICONS.copy,
                group: 'export',
                execute: () => cb.onCopyAll(),
            },
            {
                name: 'export',
                label: '/export',
                aliases: ['export-chat'],
                description: t('slash.export.description'),
                icon: SLASH_ICONS.export,
                group: 'export',
                execute: () => cb.onExport(),
            },
            {
                name: 'print',
                label: '/print',
                description: t('slash.print.description'),
                icon: SLASH_ICONS.print,
                group: 'export',
                execute: () => cb.onPrint(),
            },

            // ── Branch ──────────────────────────────────────────
            {
                name: 'branch',
                label: '/branch',
                description: t('slash.branch.description'),
                icon: SLASH_ICONS.branch,
                group: 'branch',
                execute: () => cb.onCreateBranch(),
            },
            {
                name: 'switch',
                label: '/switch',
                aliases: ['branch-switch'],
                description: t('slash.switch.description'),
                icon: SLASH_ICONS.branchSwitch,
                group: 'branch',
                hasArgs: true,
                argsPlaceholder: '<branch-name>',
                execute: (args) => { if (args) cb.onSwitchBranch(args); },
            },
            {
                name: 'branch-prev',
                label: '/branch-prev',
                aliases: ['branchprev'],
                description: t('slash.branch-prev.description'),
                icon: SLASH_ICONS.branchPrev,
                group: 'branch',
                execute: () => cb.onBranchPrev(),
            },
            {
                name: 'branch-next',
                label: '/branch-next',
                aliases: ['branchnext'],
                description: t('slash.branch-next.description'),
                icon: SLASH_ICONS.branchNext,
                group: 'branch',
                execute: () => cb.onBranchNext(),
            },
            {
                name: 'branches',
                label: '/branches',
                aliases: ['branch-list'],
                description: t('slash.branches.description'),
                icon: SLASH_ICONS.branchList,
                group: 'branch',
                execute: () => cb.onListBranches(),
            },
            {
                name: 'branch-rename',
                label: '/branch-rename',
                aliases: ['renamebranch'],
                description: t('slash.branch-rename.description'),
                icon: SLASH_ICONS.branchRename,
                group: 'branch',
                hasArgs: true,
                argsPlaceholder: '<old-name> <new-name>',
                execute: (args) => cb.onRenameBranch(args),
            },
            {
                name: 'branch-delete',
                label: '/branch-delete',
                aliases: ['deletebranch'],
                description: t('slash.branch-delete.description'),
                icon: SLASH_ICONS.branchDelete,
                group: 'branch',
                hasArgs: true,
                argsPlaceholder: '<branch-name>',
                execute: (args) => { if (args) cb.onDeleteBranch(args); },
            },

            // ── Settings ────────────────────────────────────────
            {
                name: 'agent',
                label: '/agent',
                description: t('slash.agent.description'),
                icon: SLASH_ICONS.agent,
                group: 'agent',
                hasArgs: true,
                argsPlaceholder: '<agent-id>',
                execute: (args) => { if (args) cb.onSwitchAgent(args); },
            },
            {
                name: 'model',
                label: '/model',
                description: t('slash.model.description'),
                icon: SLASH_ICONS.model,
                group: 'agent',
                hasArgs: true,
                argsPlaceholder: '<model-id>',
                execute: (args) => { if (args) cb.onModel(args); },
            },

            // ── Help ────────────────────────────────────────────
            {
                name: 'help',
                label: '/help',
                description: t('slash.help.description'),
                icon: SLASH_ICONS.help,
                group: 'help',
                execute: () => cb.onHelp(),
            },

            // ── Agent Skills ──────────────────────────────────────────────────
            //
            // 这三条命令始终注册进 PopupPanel，保证用户键入 / 时能看到并发现。
            // 当 Agent Mode 未启用（回调为 undefined）时，执行给出友好提示，
            // 而不是让命令"凭空消失"引起困惑。
            {
                name: 'skill',
                label: '/skill',
                description: cb.onSkill
                    ? t('slash.skill.description')
                    : `${t('slash.skill.description')}${t('slash.hint.enableAgentMode')}`,
                icon: SLASH_ICONS.skill,
                group: 'skills',
                hasArgs: true,
                argsPlaceholder: '<skill-id>',
                execute: async (args?: string) => {
                    if (!cb.onSkill) {
                        this.showAgentModeHint('skill');
                        return;
                    }
                    const id = args?.trim();
                    if (id) await cb.onSkill(id);
                },
            },
            {
                name: 'skills',
                label: '/skills',
                description: cb.onSkills
                    ? t('slash.skills.description')
                    : `${t('slash.skills.description')}${t('slash.hint.enableAgentMode')}`,
                icon: SLASH_ICONS.skills,
                group: 'skills',
                execute: () => {
                    if (!cb.onSkills) { this.showAgentModeHint('skills'); return; }
                    cb.onSkills();
                },
            },

            // ── Agent Tools ───────────────────────────────────────────────────
            {
                name: 'tools',
                label: '/tools',
                description: cb.onTools
                    ? t('slash.tools.description')
                    : `${t('slash.tools.description')}${t('slash.hint.enableAgentMode')}`,
                icon: SLASH_ICONS.tools,
                group: 'agent',
                execute: () => {
                    if (!cb.onTools) { this.showAgentModeHint('tools'); return; }
                    cb.onTools();
                },
            },

            // ── Durable Task Control ─────────────────────────────────────────
            directoryCommand('add-dir', 'slash.add-dir.description', SLASH_ICONS.addDir, cb.onAddDirectory, '<dir> [r|w]'),
            directoryCommand('set-home', 'slash.set-home.description', SLASH_ICONS.setHome, cb.onSetHome, '<dir>'),
            privilegedCommand('plan', 'slash.plan.description', SLASH_ICONS.plan, cb.onPlan, '<goal>'),
            privilegedCommand('cancel', 'slash.cancel.description', SLASH_ICONS.cancel, cb.onCancelTask),
            privilegedCommand('resume', 'slash.resume.description', SLASH_ICONS.resume, cb.onResumeTask),
            privilegedCommand('approve', 'slash.approve.description', SLASH_ICONS.approve, cb.onApproveTask),
            privilegedCommand('exec', 'slash.exec.description', SLASH_ICONS.exec, cb.onExec, '<command>'),

            // ── Direct read-only Tool Invocation (bypasses LLM) ─────────────
            // Available when onToolInvoke is injected (kernel with toolService).
            // Result shown in a Modal — no LLM round-trip.

            ...(cb.onToolInvoke ? [
                {
                    name: 'read',
                    label: '/read',
                    description: t('slash.read.description'),
                    icon: SLASH_ICONS.read,
                    group: 'tools',
                    hasArgs: true,
                    argsPlaceholder: '<path> [--offset N] [--limit N]',
                    execute: async (args?: string) => {
                        const { positionals, flags } = parseToolArgs(args ?? '');
                        const path = positionals.join(' ');
                        if (!path) return;
                        // Only include non-positional flags in toolArgs to avoid duplication.
                        const toolArgs: Record<string, unknown> = { path, ...flags };
                        await cb.onToolInvoke!('file_read', toolArgs, `/read ${args ?? ''}`);
                    },
                },
                {
                    name: 'grep',
                    label: '/grep',
                    description: t('slash.grep.description'),
                    icon: SLASH_ICONS.grep,
                    group: 'tools',
                    hasArgs: true,
                    argsPlaceholder: '"<pattern>" [--glob *.ts] [--dir ./src]',
                    execute: async (args?: string) => {
                        const { positionals, flags } = parseToolArgs(args ?? '');
                        const pattern = positionals[0];
                        if (!pattern) return;
                        const toolArgs: Record<string, unknown> = { pattern };
                        if (flags['glob']) toolArgs['glob'] = flags['glob'];
                        if (flags['dir'])  toolArgs['base_dir'] = flags['dir'];
                        if (flags['i'])    toolArgs['case_insensitive'] = true;
                        if (flags['n'])    toolArgs['context_lines'] = Number(flags['n']) || 0;
                        await cb.onToolInvoke!('grep_search', toolArgs, `/grep ${args ?? ''}`);
                    },
                },
                {
                    name: 'glob',
                    label: '/glob',
                    description: t('slash.glob.description'),
                    icon: SLASH_ICONS.glob,
                    group: 'tools',
                    hasArgs: true,
                    argsPlaceholder: '"**/*.ts" [--dir ./src] [--limit 50]',
                    execute: async (args?: string) => {
                        const { positionals, flags } = parseToolArgs(args ?? '');
                        const pattern = positionals[0];
                        if (!pattern) return;
                        const toolArgs: Record<string, unknown> = { pattern };
                        if (flags['dir'])   toolArgs['base_dir'] = flags['dir'];
                        if (flags['limit']) toolArgs['limit'] = Number(flags['limit']) || 100;
                        await cb.onToolInvoke!('glob_search', toolArgs, `/glob ${args ?? ''}`);
                    },
                },
            ] as SlashCommandDef[] : []),
        ];
    }

    // ================================================================
    // 工具
    // ================================================================

    /**
     * Agent Mode 未启用时显示引导提示。
     *
     * 告诉用户如何开启 kernel 模式，而不是静默失败。
     */
    private showAgentModeHint(command: string): void {
        const hint = document.createElement('div');
        hint.className = 'slash-cmd__agent-hint';
        hint.innerHTML =
            `<b>/${command}</b> requires <b>Agent Mode</b>.<br>` +
            `Enable it: <kbd>Settings ⚙</kbd> → <b>Agent Loop</b> toggle.`;

        // Inject hint above the textarea, auto-remove after 4s.
        // .llm-input__field-wrapper is inside .llm-input__main (not a direct
        // child of ctx.container), so we must use wrapper.parentElement.
        const container = this.ctx?.container;
        if (!container) return;

        const existing = container.querySelector('.slash-cmd__agent-hint');
        existing?.remove();

        insertBeforeWrapper(container, hint, '.llm-input__field-wrapper');

        this.injectAgentHintStyles();
        setTimeout(() => hint.remove(), 4000);
    }

    private injectAgentHintStyles(): void {
        injectStyle('slash-cmd-hint-styles', `
.slash-cmd__agent-hint {
    padding: 7px 12px;
    font-size: 12px;
    color: var(--text-primary, #333);
    background: var(--warning-bg, #fff8e1);
    border: 1px solid var(--warning-border, #ffc107);
    border-radius: 4px 4px 0 0;
    animation: slash-hint-in .15s ease;
}

.slash-cmd__agent-hint kbd {
    display: inline-block;
    padding: 1px 5px;
    background: var(--bg-secondary, #f0f0f0);
    border: 1px solid var(--border-color, #ccc);
    border-radius: 3px;
    font-size: 11px;
    font-family: inherit;
}
@keyframes slash-hint-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
`);
    }

    private commandsToPopupItems(commands: SlashCommandDef[]): PopupItem[] {
        return commands.map(cmd => ({
            id: cmd.name,
            label: cmd.label,
            description: cmd.description,
            icon: cmd.icon,
            group: slashGroupLabel(cmd.group),
            searchText: `${cmd.name} ${(cmd.aliases ?? []).join(' ')} ${cmd.description}`,
            hasArgs: cmd.hasArgs,
        }));
    }

    // ================================================================
    // 生命周期
    // ================================================================

    deactivate(): void {
        this.panel?.destroy();
        this.panel = null;
        this.ctx = null;
        this.commands = [];
    }
}

function privilegedCommand(
    name: string,
    descriptionKey: LocaleKey,
    icon: string,
    execute: ((args: string) => Promise<void>) | (() => Promise<void>) | undefined,
    placeholder?: string,
): SlashCommandDef {
    return {
        name,
        label: `/${name}`,
        description: execute ? t(descriptionKey) : `${t(descriptionKey)}${t('slash.hint.kernelUnavailable')}`,
        icon,
        group: 'task',
        hasArgs: Boolean(placeholder),
        argsPlaceholder: placeholder,
        execute: async args => {
            if (!execute) throw new Error(t('slash.error.kernelRequired', { name }));
            if (placeholder?.startsWith('<') && !args.trim()) {
                throw new Error(t('slash.usage', { name, placeholder }));
            }
            await execute(args.trim());
        },
    };
}

function directoryCommand(name: string, descriptionKey: LocaleKey, icon: string, execute: ((args: string) => Promise<void>) | undefined, placeholder: string): SlashCommandDef {
    return { name, label: `/${name}`, description: t(descriptionKey), icon, group: 'files', hasArgs: true, argsPlaceholder: placeholder,
        execute: async args => { if (!execute) throw new Error(t('slash.error.directoryUnavailable')); await execute(args.trim()); } };
}
