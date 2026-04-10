// @file: llm-ui/components/input/plugins/MentionPlugin.ts
//
// MentionPlugin — `@` 触发的文件引用选择器。
//
// 工作流程：
//   1. 用户在输入框键入 `@` 时触发
//   2. 弹出 PopupPanel（与 slash/history 共享 UI 组件）展示文件列表
//   3. 用户继续输入进行模糊筛选（匹配文件名和路径）
//   4. 选中后将 `@query` 替换为 Markdown 链接或图片引用插入输入框
//   5. 发送时 AttachmentProcessor 解析文本中的 Markdown 链接并附加文件内容
//
// 插入格式：
//   - 图片文件：`![filename.png](./path/to/file.png)`
//   - 其他文件：`[filename.md](./path/to/file.md)`
//
// 事件处理：
//   - `@` 后跟空格/换行 → 不触发（仅 `@word` 触发）
//   - 空格/换行出现在 `@query` 中 → 关闭面板
//   - Esc / 光标移出 mention 区域 → 关闭面板
//   - ↑/↓/Enter/Tab → 委托给 PopupPanel.handleKeyDown

import type { InputPlugin, InputPluginContext } from './InputPlugin';
import { PopupPanel } from './PopupPanel';
import type { FileSuggestion } from '../../../domain/types';

const TRIGGER_CHAR = '@';
const IMAGE_MIMES = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
]);

export interface MentionPluginOptions {
    /** 根据用户输入的 query 返回文件建议列表 */
    onRequestFiles: (query: string) => Promise<FileSuggestion[]>;
}

export class MentionPlugin implements InputPlugin {
    readonly id = 'mention';
    readonly priority = 30; // 优先于 slash(40) 和 history(50)

    private ctx: InputPluginContext | null = null;
    private popup: PopupPanel | null = null;

    /** `@` 在 textarea.value 中的位置，-1 表示未在 mention 状态 */
    private mentionStart = -1;
    /** `@` 之后、光标之前的文本（用于筛选） */
    private currentQuery = '';
    /** 防抖计时器 */
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    private cachedSuggestions: FileSuggestion[] = [];

    constructor(private readonly opts: MentionPluginOptions) {}

    activate(ctx: InputPluginContext): void {
        this.ctx = ctx;
        // PopupPanel(anchor, options) — anchor is the textarea for positioning
        this.popup = new PopupPanel(ctx.textarea, {
            variant: 'slash',
            maxVisible: 10,
            emptyText: 'No files found',
            footerHint: 'Type to filter · Enter to insert · Esc to cancel',
            animated: true,
        });
    }

    onKeyDown(e: KeyboardEvent): boolean {
        if (this.mentionStart < 0 || !this.popup) return false;

        // Delegate navigation/selection to PopupPanel
        if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(e.key)) {
            return this.popup.handleKeyDown(e);
        }

        if (e.key === 'Escape') {
            this.close();
            return true;
        }

        return false;
    }

    onInput(text: string, cursorPos: number): void {
        if (this.mentionStart >= 0) {
            // Still in mention: check boundaries
            const afterAt = text.slice(this.mentionStart + 1, cursorPos);

            // Terminate on space, newline, or cursor moved before @
            if (
                afterAt.includes(' ') ||
                afterAt.includes('\n') ||
                cursorPos <= this.mentionStart
            ) {
                this.close();
                return;
            }

            this.currentQuery = afterAt;
            this.scheduleFetch();
        } else {
            // Detect new @ trigger:  character before cursor is '@'
            // and either at start or preceded by whitespace
            if (cursorPos > 0 && text[cursorPos - 1] === TRIGGER_CHAR) {
                const preceding = text[cursorPos - 2];
                if (preceding === undefined || preceding === ' ' || preceding === '\n') {
                    this.mentionStart = cursorPos - 1;
                    this.currentQuery = '';
                    this.scheduleFetch();
                }
            }
        }
    }

    deactivate(): void {
        this.clearDebounce();
        this.popup?.destroy();
        this.popup = null;
        this.ctx = null;
        this.mentionStart = -1;
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private scheduleFetch(): void {
        this.clearDebounce();
        this.debounceTimer = setTimeout(() => this.fetchAndShow(), 150);
    }

    private clearDebounce(): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    private async fetchAndShow(): Promise<void> {
        if (!this.ctx || this.mentionStart < 0) return;

        try {
            this.cachedSuggestions = await this.opts.onRequestFiles(this.currentQuery);
        } catch {
            this.cachedSuggestions = [];
        }

        if (this.cachedSuggestions.length === 0) {
            this.popup?.hide();
            return;
        }

        const items = this.cachedSuggestions.map((f) => ({
            id: f.path,
            label: f.name,
            description: f.path,
            icon: this.fileIcon(f),
        }));

        // show() automatically calls positionPanel() internally
        this.popup?.show(items, {
            onSelect: (item) => this.insertMention(item.id as string),
            onClose: () => this.close(),
        });
        this.popup?.filter(this.currentQuery);
    }

    private insertMention(filePath: string): void {
        if (!this.ctx) return;

        const suggestion = this.cachedSuggestions.find((f) => f.path === filePath);
        if (!suggestion) return;

        const name = suggestion.name;
        const isImage = suggestion.mimeType && IMAGE_MIMES.has(suggestion.mimeType);
        const markdown = isImage
            ? `![${name}](${filePath})`
            : `[${name}](${filePath})`;

        // Replace from @ to current cursor with the markdown link
        const endPos = this.ctx.getCursorPosition();
        this.ctx.replaceRange(this.mentionStart, endPos, markdown);
        this.ctx.setCursorPosition(this.mentionStart + markdown.length);

        this.close();
    }

    private close(): void {
        this.clearDebounce();
        this.popup?.hide();
        this.mentionStart = -1;
        this.currentQuery = '';
        this.cachedSuggestions = [];
    }

    private fileIcon(f: FileSuggestion): string {
        const mime = f.mimeType ?? '';
        if (mime.startsWith('image/')) return '🖼';
        if (mime === 'text/markdown' || f.name.endsWith('.md')) return '📝';
        if (mime.startsWith('text/')) return '📄';
        if (mime.startsWith('audio/')) return '🎵';
        if (mime.startsWith('video/')) return '🎬';
        return '📎';
    }
}
