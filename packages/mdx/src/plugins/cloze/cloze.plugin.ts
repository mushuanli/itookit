// mdx/plugins/cloze/cloze.plugin.ts
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import type { MarkedExtension, Tokens } from 'marked';
import * as commands from '../../editor/commands';

export interface ClozePluginOptions {
  className?: string;
  audioIconClass?: string;
}

interface ClozeState {
  clozeCounter: number;
}

export const ClozeAPIKey = Symbol('ClozeAPI');

export class ClozePlugin implements MDxPlugin {
  name = 'feature:cloze';
  private options: Required<ClozePluginOptions>;
  private cleanupFns: Array<() => void> = [];
  private contextStates = new WeakMap<PluginContext, ClozeState>();
  
  // [新增] 事件委托处理器
  private delegationHandlers = new WeakMap<HTMLElement, (e: Event) => void>();

  constructor(options: ClozePluginOptions = {}) {
    this.options = {
      className: options.className || 'mdx-cloze',
      audioIconClass: options.audioIconClass || 'fas fa-volume-up',
    };
  }

  private getContextState(context: PluginContext): ClozeState {
    if (!this.contextStates.has(context)) {
      this.contextStates.set(context, { clozeCounter: 0 });
    }
    return this.contextStates.get(context)!;
  }

  private createBeforeParseHook(context: PluginContext) {
    return (payload: any) => {
      this.getContextState(context).clozeCounter = 0;
      return payload;
    };
  }

  private createSyntaxExtension(context: PluginContext): MarkedExtension {
    return {
      extensions: [
        {
          name: 'cloze:cloze',
          level: 'inline',
          start: (src: string) => src.match(/--/)?.index,
          tokenizer: (src: string): Tokens.Generic | undefined => {
            const state = this.getContextState(context);
            const match = src.match(/^--(?:\[([^\]]+)\]\s*)?([\s\S]+?)--(?:\^\^audio:([^^]+)\^\^)?/);
            if (match) {
              return {
                type: 'cloze:cloze',
                raw: match[0],
                locator: match[1] || `auto-${state.clozeCounter++}`,
                content: match[2].trim(),
                audio: match[3]?.trim(),
              };
            }
            return undefined;
          },
          renderer: (token: Tokens.Generic) => {
            const audioHtml = token.audio
              ? `<span class="${this.options.className}__audio" data-audio-text="${this.escapeHtml(token.audio)}"><i class="${this.options.audioIconClass}"></i></span>`
              : '';

            // [修复] 对 content 属性进行转义，防止 content 包含双引号破坏 HTML 结构
            const safeContentAttr = this.escapeHtml(token.content);
            
            // [新增] 默认渲染时，将 ¶ 替换为 <br/>
            const displayContent = token.content.replace(/¶/g, '<br/>');

            return `<span class="${this.options.className} hidden" data-cloze-locator="${token.locator}" data-cloze-content="${safeContentAttr}">
              <span class="${this.options.className}__content">${displayContent}</span><span class="${this.options.className}__placeholder">[...]</span>
              ${audioHtml}
            </span>`;
          },
        },
      ],
    };
  }

  /**
   * [新增] 简单的 HTML 转义工具，用于属性值安全
   */
  private escapeHtml(str: string): string {
      if (!str) return '';
      return str
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
  }

  install(context: PluginContext): void {
    const removeBeforeParse = context.on('beforeParse', this.createBeforeParseHook(context));
    if (removeBeforeParse) this.cleanupFns.push(removeBeforeParse);

    context.registerSyntaxExtension(this.createSyntaxExtension(context));

    context.provide(ClozeAPIKey, () => ({
      toggleAll: (show: boolean, container?: HTMLElement) => {
        const scope = container || document;
        const clozes = scope.querySelectorAll(`.${this.options.className}`);
        clozes.forEach(el => {
          if (show) el.classList.remove('hidden');
          else el.classList.add('hidden');
        });
      },
    }));
    if (!context.registerCommand || !context.registerToolbarButton) {
      console.warn('ClozePlugin: Command registration is not available in this context.');
    } else {
      const { registerCommand, registerToolbarButton } = context;

      registerToolbarButton({
          id: `sep-cloze-${Date.now()}`,
          type: 'separator'
      });

      registerCommand('applyCloze', (view: any) => {
        if (view) return commands.applyCloze(view);
        return false;
      });
      registerToolbarButton({
        id: 'cloze',
        title: '挖空 (--text--)',
        icon: '<i class="fas fa-highlighter"></i>',
        command: 'applyCloze'
      });

      registerCommand('applyAudioCloze', (view: any) => {
        if (view) return commands.applyAudioCloze(view);
        return false;
      });
      registerToolbarButton({
        id: 'audioCloze',
        title: '音频挖空',
        icon: '<i class="fas fa-volume-up"></i>',
        command: 'applyAudioCloze'
      });
      
      registerCommand('insertLinebreak', (view: any) => {
            if (commands && commands.insertLinebreak) return commands.insertLinebreak(view);
        return false;
      });
      registerToolbarButton({
        id: 'linebreak',
        title: '挖空内换行 (¶)',
        icon: '<i class="fas fa-paragraph"></i>',
        command: 'insertLinebreak'
      });
    }

    const removeDomUpdated = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      this.setupEventDelegation(element, context);
    });
    if (removeDomUpdated) this.cleanupFns.push(removeDomUpdated);
  }

  /**
   * [优化] 使用事件委托替代逐个绑定
   */
  private setupEventDelegation(element: HTMLElement, context: PluginContext): void {
    // 移除旧的委托处理器
    const oldHandler = this.delegationHandlers.get(element);
    if (oldHandler) {
      element.removeEventListener('click', oldHandler);
    }

    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      
      // 检查是否点击了音频按钮
      const audioSpan = target.closest(`.${this.options.className}__audio`);
      if (audioSpan) {
        const text = audioSpan.getAttribute('data-audio-text');
        if (text && 'speechSynthesis' in window) {
          e.stopPropagation();
          const utterance = new SpeechSynthesisUtterance(text);
          speechSynthesis.speak(utterance);
        }
        return;
      }

      // 检查是否点击了 cloze 元素
      const cloze = target.closest(`.${this.options.className}`) as HTMLElement;
      if (!cloze) return;

      e.stopPropagation();
      const wasHidden = cloze.classList.contains('hidden');
      cloze.classList.toggle('hidden');

      if (wasHidden) {
        context.emit('clozeRevealed', {
          element: cloze,
          clozeId: cloze.dataset.clozeLocator,
          content: cloze.dataset.clozeContent,
          hide: () => cloze.classList.add('hidden'),
          show: () => cloze.classList.remove('hidden'),
        });
      }
    };

    element.addEventListener('click', handler);
    this.delegationHandlers.set(element, handler);
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
}
