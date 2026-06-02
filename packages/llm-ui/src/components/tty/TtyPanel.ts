// @file: llm-ui/components/tty/TtyPanel.ts
//
// TtyPanel — inline terminal widget for a single TTY session.
//
// Rendered inside `.llm-ui-node__tty-panels` of an agent message node.
// Shows real-time stdout/stderr output and provides a dedicated input field
// that routes directly to the process stdin via the onWrite callback,
// bypassing the LLM loop entirely.

import { escapeHTML } from '@itookit/common';

const MAX_OUTPUT_CHARS = 100_000; // prevent unbounded DOM growth

export class TtyPanel {
    readonly sessionId: string;

    private el: HTMLElement;
    private outputEl: HTMLPreElement;
    private inputEl: HTMLInputElement;
    private sendBtn: HTMLButtonElement;
    private statusEl: HTMLElement;
    private exitInfoEl: HTMLElement | null = null;
    private exited = false;

    constructor(
        container: HTMLElement,
        sessionId: string,
        command: string,
        pid: number | undefined,
        private readonly onWrite: (sessionId: string, data: string) => void,
    ) {
        this.sessionId = sessionId;
        this.el = this.render(command, pid);
        container.appendChild(this.el);

        this.outputEl  = this.el.querySelector('.llm-ui-tty-panel__output') as HTMLPreElement;
        this.inputEl   = this.el.querySelector('.llm-ui-tty-panel__input') as HTMLInputElement;
        this.sendBtn   = this.el.querySelector('.llm-ui-tty-panel__send') as HTMLButtonElement;
        this.statusEl  = this.el.querySelector('.llm-ui-tty-panel__status') as HTMLElement;

        this.bindEvents();
    }

    appendOutput(chunk: string): void {
        if (this.exited) return;
        // Guard against XSS — append as text node
        this.outputEl.appendChild(document.createTextNode(chunk));

        // Trim if output exceeds max to avoid memory pressure
        if (this.outputEl.textContent && this.outputEl.textContent.length > MAX_OUTPUT_CHARS) {
            const trimmed = this.outputEl.textContent.slice(-MAX_OUTPUT_CHARS);
            this.outputEl.textContent = trimmed;
        }

        // Auto-scroll to bottom
        this.outputEl.scrollTop = this.outputEl.scrollHeight;
    }

    finalize(exitCode: number | null): void {
        this.exited = true;
        this.inputEl.disabled = true;
        this.sendBtn.disabled = true;
        this.inputEl.placeholder = '';

        this.statusEl.className = 'llm-ui-tty-panel__status llm-ui-tty-panel__status--exited';
        this.statusEl.textContent = 'exited';

        // Append exit info bar
        this.exitInfoEl = document.createElement('div');
        this.exitInfoEl.className = 'llm-ui-tty-panel__exit-info';
        this.exitInfoEl.textContent = exitCode === 0
            ? `Process exited (code 0)`
            : `Process exited (code ${exitCode ?? '?'})`;
        this.el.appendChild(this.exitInfoEl);
    }

    destroy(): void {
        this.el.remove();
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private render(command: string, pid: number | undefined): HTMLElement {
        const el = document.createElement('div');
        el.className = 'llm-ui-tty-panel';
        el.dataset.sessionId = this.sessionId;

        const pidText = pid !== undefined ? `PID:${pid}` : '';
        el.innerHTML = `
            <div class="llm-ui-tty-panel__header">
                <span class="llm-ui-tty-panel__cmd">$ ${escapeHTML(command)}</span>
                ${pidText ? `<span class="llm-ui-tty-panel__pid">${escapeHTML(pidText)}</span>` : ''}
                <span class="llm-ui-tty-panel__status llm-ui-tty-panel__status--running">running</span>
            </div>
            <pre class="llm-ui-tty-panel__output"></pre>
            <div class="llm-ui-tty-panel__input-row">
                <input class="llm-ui-tty-panel__input" type="text"
                    placeholder="→ stdin (Enter to send)" autocomplete="off" spellcheck="false" />
                <button class="llm-ui-tty-panel__send" type="button" title="Send to stdin">↵</button>
            </div>`;
        return el;
    }

    private bindEvents(): void {
        this.sendBtn.addEventListener('click', () => this.submit());
        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.submit();
            }
        });
    }

    private submit(): void {
        if (this.exited) return;
        const text = this.inputEl.value;
        if (!text) return;
        this.inputEl.value = '';
        // Append newline so the process receives a complete line
        this.onWrite(this.sessionId, text + '\n');
    }
}

// escapeHtml removed — use import { escapeHTML } from '@itookit/common' instead

