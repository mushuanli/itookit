// mdx/plugins/cloze/cloze-control-ui.plugin.ts
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { ClozeAPIKey } from './cloze.plugin';

export interface ClozeControlsPluginOptions {
  className?: string;
}

export class ClozeControlsPlugin implements MDxPlugin {
  name = 'cloze:cloze-controls';
  private options: Required<ClozeControlsPluginOptions>;
  private cleanupFns: Array<() => void> = [];
  private panel: HTMLElement | null = null;
  private currentIndex = 0;
  private isAllOpen = false;
  
  // [修复] 补全缺失的属性定义
  private isExpanded = true; 
  
  private container: HTMLElement | null = null;

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
      this.container = element;
      this.createPanel(context, clozeApi);
      this.currentIndex = 0;
      // 初始化时应用当前的展开状态
      this.updateAllClozeContent();
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
    if (this.panel && document.body.contains(this.panel)) return;
    if (this.panel) this.panel.remove();
    
    this.panel = document.createElement('div');
    this.panel.className = `${this.options.className}__panel`;
    
    // 包含切换视图的按钮
    this.panel.innerHTML = `
      <button class="${this.options.className}__btn" data-action="prev" title="上一个"><i class="fas fa-arrow-up"></i></button>
      <button class="${this.options.className}__btn" data-action="next" title="下一个"><i class="fas fa-arrow-down"></i></button>
      <button class="${this.options.className}__btn" data-action="toggle-expand" title="切换 多行/摘要视图"><i class="fas fa-compress-alt"></i></button>
      <button class="${this.options.className}__btn" data-action="toggle-visible" title="全部展开/折叠"><i class="fas fa-eye"></i></button>
      <button class="${this.options.className}__btn" data-action="reverse" title="反转所有"><i class="fas fa-retweet"></i></button>`;

    this.panel.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn || !this.container) return;

      const action = btn.getAttribute('data-action');
      const icon = btn.querySelector('i');

      switch (action) {
        case 'prev':
          this.navigate(-1);
          break;
        case 'next':
          this.navigate(1);
          break;
        case 'toggle-expand':
          this.isExpanded = !this.isExpanded;
          // 更新图标状态
          if (icon) {
              icon.className = this.isExpanded ? 'fas fa-compress-alt' : 'fas fa-expand-alt';
          }
          btn.title = this.isExpanded ? "切换到摘要视图" : "切换到完整视图";
          this.updateAllClozeContent();
          break;
        case 'toggle-visible':
          this.isAllOpen = !this.isAllOpen;
          clozeApi().toggleAll(this.isAllOpen, this.container);
          if (this.isAllOpen) {
            context.emit('clozeBatchGradeToggle', { container: this.container });
          }
          break;
        case 'reverse': {
          const clozes = this.container.querySelectorAll('.mdx-cloze');
          clozes.forEach(el => el.classList.toggle('hidden'));
          break;
        }
      }
    });
    
    document.body.appendChild(this.panel);
    
    // 初始化图标状态
    const expandBtn = this.panel.querySelector('[data-action="toggle-expand"] i');
    if (expandBtn) {
        expandBtn.className = this.isExpanded ? 'fas fa-compress-alt' : 'fas fa-expand-alt';
    }
  }

  /**
   * 更新所有挖空内容的显示模式（多行 vs 摘要）
   */
  private updateAllClozeContent(): void {
      if (!this.container) return;
      const contentSpans = this.container.querySelectorAll('.mdx-cloze__content');
      
      contentSpans.forEach(span => {
          const parent = span.parentElement;
          if (!parent) return;
          
          // 获取原始 raw content
          const rawContent = parent.getAttribute('data-cloze-content') || '';
          
          if (this.isExpanded) {
              // 多行模式：将 ¶ 转换为 <br/>
              span.innerHTML = rawContent.replace(/¶/g, '<br/>');
          } else {
              // 单行模式：将 ¶ 变为 空格，截取前 100 字符
              // 1. 替换 ¶ 为空格
              let text = rawContent.replace(/¶/g, ' ');
              
              // 2. 截取
              if (text.length > 100) {
                  text = text.substring(0, 100) + '...';
              }
              
              // 使用 innerText 避免截断的 HTML 标签破坏 DOM
              (span as HTMLElement).innerText = text;
          }
      });
  }

  private navigate(direction: number): void {
    if (!this.container) return;
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
