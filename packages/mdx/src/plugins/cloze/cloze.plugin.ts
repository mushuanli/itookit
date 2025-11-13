// mdx/plugins/cloze/cloze.plugin.ts
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import type { MarkedExtension, Tokens } from 'marked';
import * as commands from '../../editor/commands';
import type { MDxEditor } from '../../editor/editor';

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

  // 在 beforeParse 钩子中重置计数器，确保每次渲染都从0开始
  private createBeforeParseHook(context: PluginContext) {
    return () => {
      this.getContextState(context).clozeCounter = 0;
    };
  }

  private createSyntaxExtension(context: PluginContext): MarkedExtension {
    return {
      extensions: [
        {
          name: 'cloze',
          level: 'inline',
          start: (src: string) => src.match(/--/)?.index,
          tokenizer: (src: string): Tokens.Generic | undefined => {
            // 获取当前上下文的状态
            const state = this.getContextState(context);
            // 正则匹配：--[可选id] 挖空内容 --^^可选音频:文本^^
            const match = src.match(/^--(?:\[([^\]]+)\]\s*)?([\s\S]+?)--(?:\^\^audio:([^^]+)\^\^)?/);
            if (match) {
              return {
                type: 'cloze',
                raw: match[0],
                locator: match[1] || `auto-${state.clozeCounter++}`,
                content: match[2].trim(),
                audio: match[3]?.trim(),
              };
            }
            return undefined; // 明确返回 undefined
          },
          renderer: (token: Tokens.Generic) => {
            const audioHtml = token.audio
              ? `<span class="${this.options.className}__audio" data-audio-text="${token.audio}"><i class="${this.options.audioIconClass}"></i></span>`
              : '';

            return `<span class="${this.options.className} hidden" data-cloze-locator="${token.locator}" data-cloze-content="${token.content}">
              <span class="${this.options.className}__content">${token.content}</span><span class="${this.options.className}__placeholder">[...]</span>
              ${audioHtml}
            </span>`;
          },
        },
      ],
    };
  }

  install(context: PluginContext): void {
    // 每次渲染前重置自动ID计数器
    const removeBeforeParse = context.on('beforeParse', this.createBeforeParseHook(context));
    if (removeBeforeParse) this.cleanupFns.push(removeBeforeParse);

    context.registerSyntaxExtension(this.createSyntaxExtension(context));

    // 提供 API
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
      // 如果上下文不是编辑器环境（例如纯渲染器），则跳过
      console.warn('ClozePlugin: Command registration is not available in this context.');
    } else {
      const { registerCommand, registerToolbarButton } = context;

      // 添加一个分隔符，将 Cloze 功能与其他功能分开
      registerToolbarButton({
          id: `sep-cloze-${Date.now()}`,
          type: 'separator'
      });

      // 注册标准 Cloze 命令和按钮
      registerCommand('applyCloze', (view: any) => {
        if (view) return commands.applyCloze(view);
        return false;
      });
      registerToolbarButton({
        id: 'cloze',
        title: '挖空 (--text--)',
        icon: '<i class="fas fa-highlighter"></i>', // 使用更形象的图标
        command: 'applyCloze'
      });

      // 注册带音频的 Cloze 命令和按钮
      registerCommand('applyAudioCloze', (view: any) => {
        if (view) return commands.applyAudioCloze(view);
        return false;
      });
      registerToolbarButton({
        id: 'audioCloze',
        title: '音频挖空',
        icon: '<i class="fas fa-volume-up"></i>', // 保持与旧版一致
        command: 'applyAudioCloze'
      });
      
      // 注册插入换行符的命令和按钮（对多行 Cloze 非常有用）
      registerCommand('insertLinebreak', (view: any) => {
        if (view) return commands.insertLinebreak(view);
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
      this.attachEventListeners(element, context);
    });
    if (removeDomUpdated) this.cleanupFns.push(removeDomUpdated);
  }

  private attachEventListeners(element: HTMLElement, context: PluginContext): void {
    const clozes = element.querySelectorAll<HTMLElement>(`.${this.options.className}`);
    
    clozes.forEach(cloze => {
      const oldHandler = (cloze as any)._clozeClickHandler;
      if (oldHandler) {
        cloze.removeEventListener('click', oldHandler);
      }

      const handler = (e: Event) => {
        // 防止点击音频图标时也触发切换
        const target = e.target as HTMLElement;
        if (target.closest(`.${this.options.className}__audio`)) {
          const audioSpan = target.closest(`.${this.options.className}__audio`)!;
          const text = audioSpan.getAttribute('data-audio-text');
          if (text && 'speechSynthesis' in window) {
            e.stopPropagation(); // 阻止事件冒泡到上层 cloze 元素
            const utterance = new SpeechSynthesisUtterance(text);
            speechSynthesis.speak(utterance);
          }
          return;
        }

        e.stopPropagation();
        const wasHidden = cloze.classList.contains('hidden');
        cloze.classList.toggle('hidden');

        // 仅在第一次展开时触发事件
        if (wasHidden) {
          // 触发事件，通知 MemoryPlugin
          context.emit('clozeRevealed', {
            element: cloze,
            locator: cloze.getAttribute('data-cloze-locator'),
            content: cloze.getAttribute('data-cloze-content'),
          });
        }
      };

      cloze.addEventListener('click', handler);
      (cloze as any)._clozeClickHandler = handler; // 缓存处理器以便移除
    });
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
}
