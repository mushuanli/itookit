// mdx/plugins/cloze/cloze-control-ui.plugin.ts
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { ClozeAPIKey } from './cloze.plugin';
import {escapeHTML} from '@itookit/common';

export interface ClozeControlsPluginOptions {
  className?: string;
}

export class ClozeControlsPlugin implements MDxPlugin {
  name = 'cloze:cloze-controls';

  private options: Required<ClozeControlsPluginOptions>;
  private cleanupFns: Array<() => void> = [];
  
  private panel: HTMLElement | null = null;
  private container: HTMLElement | null = null;
  
  // State that persists across DOM updates
  private currentIndex = 0;
  private isAllOpen = false; 
  private isExpanded = true;
  
  // Track which clozes were manually opened (by locator)
  private manuallyOpenedClozes: Set<string> = new Set();
  private static readonly MAX_TRACKED_CLOZES = 1000;

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

    // Track when a cloze is revealed (to preserve state on DOM updates)
    const removeClozeRevealed = context.listen('clozeRevealed', (data: any) => {
      const locator = data.element.getAttribute('data-cloze-locator');
      if (locator) {
        this.trackOpenedCloze(locator);
      }
    });
    if (removeClozeRevealed) this.cleanupFns.push(removeClozeRevealed);

    // Listen for DOM updates
    const removeDomUpdated = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      this.container = element;
      
      // 1. Rebuild UI panel
      this.createPanel(context, clozeApi);
      
      // 2. Restore content display mode
      this.updateAllClozeContent();
      
      // 3. Restore open states
      this.restoreOpenStates(clozeApi, context);
    });
    if (removeDomUpdated) this.cleanupFns.push(removeDomUpdated);
  }

  /**
   * [新增] 追踪打开的 cloze，带大小限制
   */
  private trackOpenedCloze(locator: string): void {
    // 如果已存在，先删除再添加（移到末尾）
    this.manuallyOpenedClozes.delete(locator);
    this.manuallyOpenedClozes.add(locator);
    
    // 超出限制时删除最早的
    if (this.manuallyOpenedClozes.size > ClozeControlsPlugin.MAX_TRACKED_CLOZES) {
      const firstKey = this.manuallyOpenedClozes.values().next().value;
      if( firstKey )
        this.manuallyOpenedClozes.delete(firstKey);
    }
  }

  /**
   * Restore open states after DOM update
   */
  private restoreOpenStates(clozeApi: any, context: PluginContext): void {
    if (!this.container) return;

    if (this.isAllOpen) {
      // Global "Open All" mode
      this.container.classList.add('is-global-override');
      clozeApi().toggleAll(true, this.container);
      
      // Re-trigger grading panels after a short delay
      setTimeout(() => {
        context.emit('clozeBatchGradeToggle', { container: this.container });
      }, 50);
    } else {
      // Restore individually opened clozes
      const clozes = this.container.querySelectorAll('.mdx-cloze');
      clozes.forEach(cloze => {
        const locator = cloze.getAttribute('data-cloze-locator');
        if (locator && this.manuallyOpenedClozes.has(locator)) {
          cloze.classList.remove('hidden');
        }
      });
    }
  }

  private createPanel(context: PluginContext, clozeApi: any): void {
    // Remove old panel if it exists but is detached
    if (this.panel && this.container && !this.container.contains(this.panel)) {
      this.panel.remove();
      this.panel = null;
    }
    if (this.panel) return;

    this.panel = document.createElement('div');
    this.panel.className = this.options.className;
    
    const eyeIcon = this.isAllOpen ? 'fa-eye-slash' : 'fa-eye';
    const expandIcon = this.isExpanded ? 'fa-compress-alt' : 'fa-expand-alt';

    this.panel.innerHTML = `
      <div class="${this.options.className}__menu">
        <button class="${this.options.className}__btn" data-action="prev" title="上一个"><i class="fas fa-arrow-up"></i></button>
        <button class="${this.options.className}__btn" data-action="next" title="下一个"><i class="fas fa-arrow-down"></i></button>
        <button class="${this.options.className}__btn" data-action="toggle-expand" title="摘要/完整"><i class="fas ${expandIcon}"></i></button>
        <button class="${this.options.className}__btn" data-action="reverse" title="反转显示"><i class="fas fa-retweet"></i></button>
        <button class="${this.options.className}__btn" data-action="toggle-visible" title="全显/全隐"><i class="fas ${eyeIcon}"></i></button>
      </div>
      <div class="${this.options.className}__toggle"><i class="fas fa-tools"></i></div>
    `;

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
          if (icon) icon.className = this.isExpanded ? 'fas fa-compress-alt' : 'fas fa-expand-alt';
          this.updateAllClozeContent();
          break;
        
        case 'toggle-visible':
          this.isAllOpen = !this.isAllOpen;
          
          if (this.isAllOpen) {
            this.container.classList.add('is-global-override');
            clozeApi().toggleAll(true, this.container);
            context.emit('clozeBatchGradeToggle', { container: this.container });
          } else {
            this.container.classList.remove('is-global-override');
            clozeApi().toggleAll(false, this.container);
            // Clear manually opened tracking when closing all
            this.manuallyOpenedClozes.clear();
          }
          
          if (icon) icon.className = this.isAllOpen ? 'fas fa-eye-slash' : 'fas fa-eye';
          break;

        case 'reverse':
          // Reverse is a special manual intervention
          this.container.classList.add('is-global-override');
          const clozes = this.container.querySelectorAll('.mdx-cloze');
          clozes.forEach(el => {
            const wasHidden = el.classList.contains('hidden');
            el.classList.toggle('hidden');
            
            // Track newly opened clozes
            const locator = el.getAttribute('data-cloze-locator');
            if (locator) {
              if (wasHidden) {
                this.manuallyOpenedClozes.add(locator);
              } else {
                this.manuallyOpenedClozes.delete(locator);
              }
            }
          });
          context.emit('clozeBatchGradeToggle', { container: this.container });
          break;
      }
    });
    
    this.container?.appendChild(this.panel);
  }
  
  private updateAllClozeContent(): void {
    if (!this.container) return;
    const contentSpans = this.container.querySelectorAll('.mdx-cloze__content');
    if (contentSpans.length === 0) return;

    // [优化] 收集所有更新，批量应用
    const updates: Array<{ span: HTMLElement; html: string }> = [];
    
    contentSpans.forEach(span => {
      const parent = span.parentElement;
      if (!parent) return;
      
      const rawContent = parent.getAttribute('data-cloze-content') || '';
      let newContent: string;
      
      if (this.isExpanded) {
        newContent = rawContent.replace(/¶/g, '<br/>');
      } else {
        let text = rawContent.replace(/¶/g, ' ');
        if (text.length > 100) text = text.substring(0, 100) + '...';
        newContent = escapeHTML(text);
      }
      
      updates.push({ span: span as HTMLElement, html: newContent });
    });

    // 批量应用更新
    updates.forEach(({ span, html }) => {
      if (this.isExpanded) {
        span.innerHTML = html;
      } else {
        span.textContent = html;
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
    this.manuallyOpenedClozes.clear();
  }
}
