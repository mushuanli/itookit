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

    // ✅ 修改后：
    // modeChanged 的监听其实可以保留，用于处理 display: none/flex 的切换。
    // 但如果 Panel 是 append 到 this.container (渲染容器) 的，
    // 当切换到 'edit' 模式时，renderContainer 本身会被隐藏 (display: none)，
    // 所以 Panel 会自动跟随隐藏，不需要手动操作 panel.style.display。
    
    // 如果你希望代码更健壮（双重保险），保留下面这段没问题；
    // 如果想精简，这部分其实可以移除了，因为父级容器隐藏了，子级也会隐藏。
    const removeModeChanged = context.listen('modeChanged', ({ mode }: { mode: string }) => {
       // 父容器 renderContainer 在 edit 模式下会隐藏，所以这里其实是多余的，但保留也没坏处
       if (this.panel) {
         this.panel.style.display = mode === 'render' ? 'flex' : 'none';
       }
    });
    if (removeModeChanged) this.cleanupFns.push(removeModeChanged);
  }

  private createPanel(context: PluginContext, clozeApi: any): void {
    // 防止重复创建：检查当前 container 内是否已有 panel
    if (this.panel && this.container && this.container.contains(this.panel)) return;
    
    // 如果 panel 存在但不在当前 container 中（例如重新渲染），先移除旧的
    if (this.panel) this.panel.remove();
    
    // 1. 创建主容器 (Wrapper)
    this.panel = document.createElement('div');
    this.panel.className = 'mdx-cloze-controls'; // 注意这里类名的变化，不再是 __panel
    
    // 2. 构建 HTML 结构
    // 一个主 Toggle 按钮 + 一个包含功能按钮的 Menu 容器
    this.panel.innerHTML = `
      <div class="${this.options.className}__menu">
        <button class="${this.options.className}__btn" data-action="prev" title="上一个挖空">
            <i class="fas fa-arrow-up"></i>
        </button>
        <button class="${this.options.className}__btn" data-action="next" title="下一个挖空">
            <i class="fas fa-arrow-down"></i>
        </button>
        <button class="${this.options.className}__btn" data-action="toggle-expand" title="切换视图 (完整/摘要)">
            <i class="fas fa-compress-alt"></i>
        </button>
        <button class="${this.options.className}__btn" data-action="reverse" title="反转所有显示状态">
            <i class="fas fa-retweet"></i>
        </button>
        <button class="${this.options.className}__btn" data-action="toggle-visible" title="显示/隐藏所有">
            <i class="fas fa-eye"></i>
        </button>
      </div>
      
      <div class="${this.options.className}__toggle" title="挖空控制">
        <i class="fas fa-tools"></i>
      </div>
    `;

    this.panel.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn || !this.container) return;

      const action = btn.getAttribute('data-action');
      if (!action) return; // 如果点击的是 toggle 按钮本身（没有 action），则忽略，CSS处理 hover

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
          
          // 更新图标状态
          if (icon) {
            icon.className = this.isAllOpen ? 'fas fa-eye-slash' : 'fas fa-eye';
          }
          btn.title = this.isAllOpen ? "隐藏所有" : "显示所有";

          if (this.isAllOpen) {
            context.emit('clozeBatchGradeToggle', { container: this.container });
          }
          break;

        case 'reverse': {
          const clozes = this.container.querySelectorAll('.mdx-cloze');
          clozes.forEach(el => el.classList.toggle('hidden'));

          // [新增/修改] 
          // Reverse 操作可能导致部分卡片变为可见。
          // 我们发送此事件，MemoryPlugin 会扫描所有可见卡片并添加"一直显示"的评分面板。
          context.emit('clozeBatchGradeToggle', { container: this.container });
          break;
        }
      }
    });
    
    // 4. 挂载到容器 (使用 appendChild 即可，CSS float/sticky 会处理位置)
    if (this.container) {
        this.container.appendChild(this.panel);
        
        // 初始化图标状态 (Optional)
        const expandBtn = this.panel.querySelector('[data-action="toggle-expand"] i');
        if (expandBtn) {
            expandBtn.className = this.isExpanded ? 'fas fa-compress-alt' : 'fas fa-expand-alt';
        }
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
