/**
 * @file mdx/plugins/interactions/task-list.plugin.ts
 * @desc 任务列表插件。支持标准 GFM 任务列表和表格内任务列表，支持双向绑定、事件通知和排序兼容。
 */

import type { MDxPlugin, PluginContext, ScopedPersistenceStore } from '../../core/plugin';
import type { MarkedExtension } from 'marked';

/**
 * 任务列表插件配置选项
 */
export interface TaskListPluginOptions {
  /**
   * 自定义复选框的选择器
   * 用于在 DOM 中查找交互元素
   * @default 'input[type="checkbox"].mdx-task-item'
   */
  checkboxSelector?: string;
  
  /**
   * 点击任务时是否自动更新 Markdown 源码
   * @default true
   */
  autoUpdateMarkdown?: boolean;
  
  /**
   * 任务切换前的钩子
   * 返回 false 或 Promise<false> 可以阻止状态切换和 Markdown 更新
   */
  beforeTaskToggle?: (detail: TaskToggleDetail) => boolean | Promise<boolean>;
  
  /**
   * 任务切换后的回调
   * 此时 Markdown 已更新（如果 autoUpdateMarkdown 为 true）
   */
  onTaskToggled?: (detail: TaskToggleResult) => void | Promise<void>;
}

/**
 * 任务切换事件详情（操作前）
 */
export interface TaskToggleDetail {
  /** 任务文本内容 */
  taskText: string;
  /** 当前复选框的状态（点击时的状态） */
  isChecked: boolean;
  /** 触发事件的 DOM 元素 */
  element: HTMLInputElement;
  /** 在 Markdown 源码中的行号 (1-based) */
  lineNumber?: number;
  /** 是否为表格内的任务 */
  isTableTask?: boolean;
}

/**
 * 任务切换结果（操作后）
 */
export interface TaskToggleResult extends TaskToggleDetail {
  /** 更新前的 Markdown 源码 */
  originalMarkdown: string;
  /** 更新后的 Markdown 源码 */
  updatedMarkdown: string;
  /** 标记 Markdown 是否实际发生了变化 */
  wasUpdated: boolean;
}

/**
 * 内部使用的位置信息结构
 * 用于将 DOM 中的唯一 ID 映射回 Markdown 源码位置
 */
interface TaskLocation {
  lineNumber: number;
  indexInLine: number;
  isTableTask: boolean;
}

export class TaskListPlugin implements MDxPlugin {
  name = 'interaction:task-list';
  private options: Required<TaskListPluginOptions>;
  private cleanupFns: Array<() => void> = [];
  private store: ScopedPersistenceStore | null = null;
  private currentMarkdown: string = '';
  
  // 存储从 Markdown 源码解析出的所有任务位置，按顺序排列
  // 索引对应 DOM 元素的 data-task-index
  private taskLocations: TaskLocation[] = [];
  
  // 渲染计数器，用于给 DOM 绑定唯一的 taskIndex
  private renderTaskCounter = 0;

  constructor(options: TaskListPluginOptions = {}) {
    this.options = {
      checkboxSelector: options.checkboxSelector || 'input[type="checkbox"].mdx-task-item',
      autoUpdateMarkdown: options.autoUpdateMarkdown !== false,
      beforeTaskToggle: options.beforeTaskToggle || (() => true),
      onTaskToggled: options.onTaskToggled || (() => {}),
    };
  }

  /**
   * 创建 Marked 扩展
   * 核心逻辑：给每个生成的 checkbox 绑定一个全局递增的 data-task-index
   */
  private createMarkedExtension(): MarkedExtension {
    // 捕获 this 上下文
    const self = this;
    
    return {
      // 钩子：在解析 Markdown 之前重置渲染计数器
      hooks: {
        preprocess(markdown: string) {
          self.renderTaskCounter = 0;
          return markdown;
        }
      },
      renderer: {
        // 1. 处理标准列表项任务 (- [ ])
        listitem(text: string): string {
          // 检查文本是否以 [ ] 或 [x] 开头（可能被其他扩展处理过，或者还是纯文本）
          // 为了稳健性，我们处理标准 Markdown 文本模式
          const taskRegex = /^\[([ xX])\]/;
          const match = text.match(taskRegex);
          
          if (match) {
            const isChecked = match[1] !== ' ';
            const index = self.renderTaskCounter++;
            
            // 生成带索引的 input
            const checkbox = `<input type="checkbox" class="mdx-task-item" ${isChecked ? 'checked' : ''} data-task-index="${index}">`;
            
            // 移除 [ ] 部分，保留剩余文本
            const remainingText = text.substring(match[0].length);
            return `<li class="task-list-item">${checkbox}${remainingText}</li>\n`;
          }
          
          // 兼容性处理：如果 marked 配置已经将 [ ] 转为了 <input>
          if (text.startsWith('<input')) {
             const index = self.renderTaskCounter++;
             // 注入 class 和 data-task-index
             const newTag = `<input class="mdx-task-item" data-task-index="${index}"`;
             return `<li class="task-list-item">${text.replace('<input', newTag)}</li>\n`;
          }
          
          return `<li>${text}</li>\n`;
        },

        // 2. 处理表格单元格内的任务 (| [ ] |)
        tablecell(content: string, flags): string {
          const type = flags.header ? 'th' : 'td';
          const tag = flags.align ? `<${type} align="${flags.align}">` : `<${type}>`;
          
          // 全局替换当前单元格内的所有 [ ] 或 [x]
          // 使用 replace 的回调函数，确保每次匹配时 index 都能递增
          const processedContent = content.replace(/\[([ xX])\]/gi, (match, state) => {
            const isChecked = state.toLowerCase() === 'x';
            const index = self.renderTaskCounter++;
            
            return `<input type="checkbox" class="mdx-task-item mdx-table-task" ${isChecked ? 'checked' : ''} data-task-index="${index}">`;
          });
          
          return `${tag}${processedContent}</${type}>\n`;
        }
      }
    };
  }

  /**
   * 预处理 Markdown，提取所有任务的确切行号位置
   * 必须在渲染前执行，以确保 taskLocations 数组的顺序与 renderTaskCounter 一致
   */
  private parseTaskLocations(markdown: string): void {
    this.taskLocations = [];
    const lines = markdown.split('\n');
    
    lines.forEach((line, lineIdx) => {
      const lineNumber = lineIdx + 1;
      
      // 1. 检查标准列表任务 (以 - [ ] 开头)
      if (/^\s*[-*+]\s+\[[ xX]\]/.test(line)) {
        this.taskLocations.push({
          lineNumber,
          indexInLine: 0,
          isTableTask: false
        });
      } 
      // 2. 检查表格行任务 (包含 | 且包含 [ ])
      else if (line.includes('|') && /\[[ xX]\]/.test(line)) {
        // 表格行可能包含多个任务，例如 | [ ] A | [ ] B |
        const matches = line.match(/\[[ xX]\]/g);
        if (matches) {
          matches.forEach((_, idx) => {
            this.taskLocations.push({
              lineNumber,
              indexInLine: idx, // 记录它是这一行里的第几个匹配项
              isTableTask: true
            });
          });
        }
      }
    });
    console.log(`[TaskListPlugin] Parsed ${this.taskLocations.length} task locations.`);
  }

  /**
   * 创建点击事件处理器
   */
  private createClickHandler(context: PluginContext): (e: Event) => void {
    return async (event: Event) => {
      const target = event.target as HTMLElement;
      
      // 🔥 [DEBUG] 日志 1：确认点击事件是否被捕获
      // 如果你在控制台连这条都看不到，说明事件监听器没绑上，或者被父级/其他插件 stopPropagation 了
      // console.log('[TaskListPlugin] Click detected on:', target); 

      // 使用 matches 确保精确匹配配置的选择器
      if (!target.matches(this.options.checkboxSelector)) {
          // 🔥 [DEBUG] 日志 2：如果点击了 checkbox 但没进逻辑，可能是 class 不对
          if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
              console.warn('[TaskListPlugin] Checkbox clicked but selector mismatch.', {
                  expected: this.options.checkboxSelector,
                  actualClass: target.className
              });
          }
          return;
      }
      
      console.log('[TaskListPlugin] Valid Task Checkbox clicked.');

      const checkbox = target as HTMLInputElement;

      // 1. 获取绑定的 index
      const taskIndexStr = checkbox.getAttribute('data-task-index');
      if (taskIndexStr === null) {
        console.error('[TaskListPlugin] Checkbox missing data-task-index attribute.');
        return;
      }
      
      const taskIndex = parseInt(taskIndexStr, 10);
      
      // 2. 从预先解析的位置数组中获取行号信息
      const location = this.taskLocations[taskIndex];
      if (!location) {
        console.error('[TaskListPlugin] Task location NOT found for index:', taskIndex, 'Total locations:', this.taskLocations.length);
        return;
      }

      console.log('[TaskListPlugin] Location found:', location);

      let taskText = '';
      if (location.isTableTask) {
          taskText = checkbox.parentElement?.textContent?.trim() || '';
      } else {
          taskText = checkbox.closest('.task-list-item')?.textContent?.trim() || '';
      }

      const detail: TaskToggleDetail = {
        taskText,
        isChecked: checkbox.checked,
        element: checkbox,
        lineNumber: location.lineNumber,
        isTableTask: location.isTableTask
      };

      // 3. 触发 "before" 钩子
      const shouldProceed = await this.options.beforeTaskToggle(detail);
      if (!shouldProceed) {
        console.log('[TaskListPlugin] Toggle cancelled by beforeTaskToggle hook.');
        event.preventDefault();
        checkbox.checked = !checkbox.checked;
        return;
      }

      // 4. 准备结果对象
      let result: TaskToggleResult = {
        ...detail,
        originalMarkdown: this.currentMarkdown,
        updatedMarkdown: this.currentMarkdown,
        wasUpdated: false,
      };

      // 5. 如果启用了自动更新，则修改 Markdown
      if (this.options.autoUpdateMarkdown) {
        console.log('[TaskListPlugin] Updating Markdown...');
        const updated = this.updateMarkdown(location, detail.isChecked);
        if (updated) {
          result.updatedMarkdown = updated;
          result.wasUpdated = true;
          
          // 更新当前状态
          this.currentMarkdown = updated;
          await this.store?.set('currentMarkdown', updated);
          console.log('[TaskListPlugin] Markdown updated successfully.');
        } else {
            console.warn('[TaskListPlugin] updateMarkdown returned null.');
        }
      }

      // 6. 发送事件
      console.log('[TaskListPlugin] Emitting taskToggled event:', result);
      context.emit('taskToggled', result);
      
      // 7. 触发 "after" 回调
      await this.options.onTaskToggled(result);
    };
  }

  /**
   * 更新 Markdown 源码
   */
  private updateMarkdown(loc: TaskLocation, isChecked: boolean): string | null {
    const lines = this.currentMarkdown.split('\n');
    const lineIndex = loc.lineNumber - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
      console.warn('[TaskListPlugin] Line number out of bounds:', lineIndex);
      return null;
    }

    let line = lines[lineIndex];
    const newCheckmark = isChecked ? '[x]' : '[ ]';
    
    if (loc.isTableTask) {
      // 表格任务：精确替换行内第 N 个任务标记
      let currentIndex = 0;
      // 使用正则替换回调，只替换对应索引的那一个
      line = line.replace(/\[[ xX]\]/gi, (match) => {
        if (currentIndex === loc.indexInLine) {
          currentIndex++;
          return newCheckmark;
        }
        currentIndex++;
        return match;
      });
    } else {
      // 标准列表任务：替换行首的标记
      line = line.replace(/^(\s*[-*+]\s+)\[[ xX]\]/, `$1${newCheckmark}`);
    }

    lines[lineIndex] = line;
    return lines.join('\n');
  }

  /**
   * 安装插件
   */
  install(context: PluginContext): void {
    // 注册 Marked 扩展以修改 HTML 输出
    context.registerSyntaxExtension(this.createMarkedExtension());

    // 初始化存储
    this.store = context.getScopedStore();
    this.store.get('currentMarkdown').then(saved => {
      if (saved) {
        this.currentMarkdown = saved;
      }
    });

    // 监听解析前事件：解析 Markdown 结构以建立索引
    const removeBeforeParse = context.on('beforeParse', ({ markdown }: { markdown: string }) => {
      // console.log('[TaskListPlugin] beforeParse triggered. Length:', markdown.length);
      this.currentMarkdown = markdown;
      this.parseTaskLocations(markdown);
      return { markdown };
    });
    
    if (removeBeforeParse) {
      this.cleanupFns.push(removeBeforeParse);
    }

    // 监听 DOM 更新事件：绑定点击交互
    const removeDomUpdated = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      console.log('[TaskListPlugin] domUpdated triggered. Binding click listeners.');
      
      const existingHandler = (element as any)._taskListClickHandler;
      if (existingHandler) {
        element.removeEventListener('click', existingHandler);
      }

      // 绑定新的监听器
      const clickHandler = this.createClickHandler(context);
      // 使用事件委托，将监听器绑定在根元素上
      element.addEventListener('click', clickHandler);
      (element as any)._taskListClickHandler = clickHandler;
    });

    if (removeDomUpdated) {
      this.cleanupFns.push(removeDomUpdated);
    }
  }

  /**
   * 手动设置 Markdown（例如外部编辑器内容变化时）
   */
  setMarkdown(markdown: string): void {
    this.currentMarkdown = markdown;
    this.parseTaskLocations(markdown);
    this.store?.set('currentMarkdown', markdown);
  }

  /**
   * 获取当前 Markdown
   */
  getMarkdown(): string {
    return this.currentMarkdown;
  }

  /**
   * 销毁插件
   */
  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
}
