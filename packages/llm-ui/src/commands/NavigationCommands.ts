// @file: llm-ui/commands/NavigationCommands.ts

import { Command } from '../core/Command';
import { TimerManager } from '../utils/TimerManager';

export class ScrollToSessionCommand extends Command<{ sessionId: string }> {
    protected readonly name = 'Scroll To Session';
    protected severity = 'silent' as const;

    private timers = new TimerManager();

    protected async execute({ sessionId }: { sessionId: string }): Promise<void> {
        const el = this.ctx.historyView.getSessionElement(sessionId);
        if (!el) return;

        el.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // 高亮闪烁效果
        el.classList.add('llm-ui-session--highlight');
        this.timers.setTimeout(() => {
            el.classList.remove('llm-ui-session--highlight');
        }, 1500);
    }
}
