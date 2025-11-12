// mdx/plugins/cloze/cloze-control-ui.plugin.ts
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { ClozeAPIKey } from './cloze.plugin';

export interface ClozeControlsPluginOptions {
  className?: string;
}

export class ClozeControlsPlugin implements MDxPlugin {
  name = 'ui:cloze-controls';
  private options: Required<ClozeControlsPluginOptions>;
  private cleanupFns: Array<() => void> = [];
  private panel: HTMLElement | null = null;
  private currentIndex = 0;
  private isAllOpen = false;
  private container: HTMLElement | null = null; // <--- 完善：保存容器引用

  constructor(options: ClozeControlsPluginOptions = {}) {
    this.options = {
      className: options.className || 'mdx-cloze-controls',
    };
  }

  install(context: PluginContext): void {
    const clozeApi = context.inject(ClozeAPIKey);
    if (!clozeApi) {
      console.warn('ClozeControlsPlugin requires ClozePlugin to be installed.');
      return;
    }

    const removeDomUpdated = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      this.container = element; // <--- 完善：保存容器引用
      this.createPanel(context, clozeApi);
      this.currentIndex = 0; // 重置导航索引
    });
    if (removeDomUpdated) this.cleanupFns.push(removeDomUpdated);

    const removeModeChanged = context.listen('modeChanged', ({ mode }: { mode: string }) => {
      if (this.panel) {
        this.panel.style.display = mode === 'render' ? 'flex' : 'none';
      }
    });
    if (removeModeChanged) this.cleanupFns.push(removeModeChanged);
  }

  private createPanel(context: PluginContext, clozeApi: any): void {
    // 确保 panel 只创建一次或在需要时重建
    if (this.panel && document.body.contains(this.panel)) return;
    if (this.panel) this.panel.remove();
    
    this.panel = document.createElement('div');
    this.panel.className = `${this.options.className}__panel`;
    this.panel.innerHTML = `
      <button class="${this.options.className}__btn" data-action="prev" title="上一个"><i class="fas fa-arrow-up"></i></button>
      <button class="${this.options.className}__btn" data-action="next" title="下一个"><i class="fas fa-arrow-down"></i></button>
      <button class="${this.options.className}__btn" data-action="toggle" title="全部展开/折叠"><i class="fas fa-eye"></i></button>
      <button class="${this.options.className}__btn" data-action="reverse" title="反转所有"><i class="fas fa-retweet"></i></button>`;

    this.panel.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn || !this.container) return;

      const action = btn.getAttribute('data-action');
      switch (action) {
        case 'prev':
          this.navigate(-1);
          break;
        case 'next':
          this.navigate(1);
          break;
        case 'toggle':
          this.isAllOpen = !this.isAllOpen;
          // <--- 完善：在指定容器内操作
          clozeApi().toggleAll(this.isAllOpen, this.container);
          if (this.isAllOpen) {
            context.emit('clozeBatchGradeToggle', {});
          }
          break;
        case 'reverse': {
          // <--- 完善：在指定容器内操作
          const clozes = this.container.querySelectorAll('.mdx-cloze');
          clozes.forEach(el => el.classList.toggle('hidden'));
          break;
        }
      }
    });
    
    // 将 panel 添加到 body，避免受父容器 overflow:hidden 影响
    document.body.appendChild(this.panel);
  }

  private navigate(direction: number): void {
    if (!this.container) return;
    // <--- 完善：在指定容器内查找
    const hidden = Array.from(this.container.querySelectorAll('.mdx-cloze.hidden'));
    if (hidden.length === 0) return;

    this.currentIndex = (this.currentIndex + direction + hidden.length) % hidden.length;
    const target = hidden[this.currentIndex] as HTMLElement;
    
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('mdx-cloze--highlight');
    setTimeout(() => target.classList.remove('mdx-cloze--highlight'), 1000);
  }

  destroy(): void {
    if (this.panel) this.panel.remove();
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.panel = null;
    this.container = null;
  }
}
