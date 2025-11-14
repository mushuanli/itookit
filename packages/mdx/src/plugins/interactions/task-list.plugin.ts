// mdx/plugins/interactions/task-list.plugin.ts
import type { MDxPlugin, PluginContext, ScopedPersistenceStore } from '../../core/plugin';
import type { MarkedExtension } from 'marked';

/**
 * 任务列表插件配置选项
 */
export interface TaskListPluginOptions {
  /**
   * 自定义选择器
   * @default '.task-list-item input[type="checkbox"]'
   */
  checkboxSelector?: string;
  
  /**
   * 是否自动更新 Markdown 源码
   * @default true
   */
  autoUpdateMarkdown?: boolean;
  
  /**
   * 任务切换前的钩子（返回 false 可阻止更新）
   */
  beforeTaskToggle?: (detail: TaskToggleDetail) => boolean | Promise<boolean>;
  
  /**
   * 任务切换后的回调
   */
  onTaskToggled?: (detail: TaskToggleResult) => void | Promise<void>;
}

/**
 * 任务切换事件详情（操作前）
 */
export interface TaskToggleDetail {
  taskText: string;
  isChecked: boolean;
  element: HTMLInputElement;
  lineNumber?: number;
}

/**
 * 任务切换结果（操作后）
 */
export interface TaskToggleResult extends TaskToggleDetail {
  originalMarkdown: string;
  updatedMarkdown: string;
  wasUpdated: boolean;
}

/**
 * 任务元数据
 */
interface TaskMetadata {
  taskText: string;
  lineNumber?: number;
}

export class TaskListPlugin implements MDxPlugin {
  name = 'interaction:task-list';
  private options: Required<TaskListPluginOptions>;
  private cleanupFns: Array<() => void> = [];
  private store: ScopedPersistenceStore | null = null;
  private currentMarkdown: string = '';
  
  private taskMap = new WeakMap<HTMLElement, Map<HTMLInputElement, TaskMetadata>>();

  constructor(options: TaskListPluginOptions = {}) {
    this.options = {
      checkboxSelector: options.checkboxSelector || '.task-list-item input[type="checkbox"]',
      autoUpdateMarkdown: options.autoUpdateMarkdown !== false,
      beforeTaskToggle: options.beforeTaskToggle || (() => true),
      onTaskToggled: options.onTaskToggled || (() => {}),
    };
  }

  /**
   * 创建 Marked 扩展，移除 GFM 默认添加的 disabled 属性，使复选框可交互。
   */
  private createMarkedExtension(): MarkedExtension {
    return {
      renderer: {
        listitem(text: string): string {
          const taskMatch = text.match(/^<input\s+(?:disabled\s*=\s*"[^"]*"\s*)?type="checkbox"\s*(checked\s*=\s*"[^"]*")?\s*\/?>/);
          
          if (taskMatch) {
            const isChecked = taskMatch[1] ? ' checked' : '';
            const checkbox = `<input type="checkbox"${isChecked}>`;
            const remainingText = text.replace(taskMatch[0], checkbox);
            return `<li class="task-list-item">${remainingText}</li>\n`;
          }
          
          return `<li>${text}</li>\n`;
        }
      }
    };
  }

  private createClickHandler(context: PluginContext): (e: Event) => void {
    return async (event: Event) => {
      const target = event.target as HTMLElement;
      const checkbox = target.closest<HTMLInputElement>(this.options.checkboxSelector);
      if (!checkbox) return;

      const renderRoot = this.findRenderRoot(checkbox);
      if (!renderRoot) return;

      const taskMeta = this.taskMap.get(renderRoot)?.get(checkbox);
      const listItem = checkbox.closest('.task-list-item');
      const taskText = listItem?.textContent?.trim() || '';

      const detail: TaskToggleDetail = {
        taskText,
        isChecked: checkbox.checked,
        element: checkbox,
        lineNumber: taskMeta?.lineNumber,
      };

      const shouldProceed = await this.options.beforeTaskToggle(detail);
      if (!shouldProceed) {
        event.preventDefault();
        checkbox.checked = !checkbox.checked;
        return;
      }

      let result: TaskToggleResult = {
        ...detail,
        originalMarkdown: this.currentMarkdown,
        updatedMarkdown: this.currentMarkdown,
        wasUpdated: false,
      };

      if (this.options.autoUpdateMarkdown && taskMeta) {
        const updated = this.updateMarkdown(taskMeta, detail.isChecked);
        if (updated) {
          result.updatedMarkdown = updated;
          result.wasUpdated = true;
          this.currentMarkdown = updated;
          
          await this.store?.set('currentMarkdown', updated);
        }
      }

      context.emit('taskToggled', result);
      
      await this.options.onTaskToggled(result);
    };
  }

  /**
   * 更新 Markdown 源码中的任务状态
   */
  private updateMarkdown(taskMeta: TaskMetadata, isChecked: boolean): string | null {
    if (!this.currentMarkdown || taskMeta.lineNumber === undefined) {
      return null;
    }

    const lines = this.currentMarkdown.split('\n');
    const lineIndex = taskMeta.lineNumber - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
      console.warn('Task line number out of range');
      return null;
    }

    const line = lines[lineIndex];
    const newCheckmark = isChecked ? '[x]' : '[ ]';
    
    // 匹配任务列表语法：- [ ] 或 - [x] 或 * [ ] 等
    const taskRegex = /^(\s*[-*+]\s+)\[[ xX]\]/;
    
    if (!taskRegex.test(line)) {
      console.warn('Line is not a task list item:', line);
      return null;
    }

    lines[lineIndex] = line.replace(taskRegex, `$1${newCheckmark}`);
    return lines.join('\n');
  }

  /**
   * 查找渲染根容器
   */
  private findRenderRoot(element: HTMLElement): HTMLElement | null {
    return element.closest('.mdx-editor-renderer');
  }

  /**
   * 构建任务元素映射表
   */
  private buildTaskMap(element: HTMLElement): void {
    const checkboxes = element.querySelectorAll<HTMLInputElement>(this.options.checkboxSelector);
    const taskMapForElement = new Map<HTMLInputElement, TaskMetadata>();
    const taskLines = this.findTaskLines(this.currentMarkdown);
    let taskIndex = 0;

    checkboxes.forEach(checkbox => {
      const listItem = checkbox.closest('.task-list-item');
      const taskText = listItem?.textContent?.trim() || '';
      
      // 匹配任务文本与行号
      const lineNumber = taskLines[taskIndex];
      
      taskMapForElement.set(checkbox, {
        taskText,
        lineNumber,
      });
      
      taskIndex++;
    });

    this.taskMap.set(element, taskMapForElement);
  }

  /**
   * 查找 Markdown 中所有任务列表的行号
   */
  private findTaskLines(markdown: string): number[] {
    const lines = markdown.split('\n');
    const taskLines: number[] = [];
    
    lines.forEach((line, index) => {
      if (/^\s*[-*+]\s+\[[ xX]\]/.test(line)) {
        taskLines.push(index + 1); // 行号从 1 开始
      }
    });
    
    return taskLines;
  }

  /**
   * 安装插件
   */
  install(context: PluginContext): void {
    context.registerSyntaxExtension(this.createMarkedExtension());

    this.store = context.getScopedStore();
    
    this.store.get('currentMarkdown').then(saved => {
      if (saved) {
        this.currentMarkdown = saved;
      }
    });

    const removeBeforeParse = context.on('beforeParse', ({ markdown }: { markdown: string }) => {
      this.currentMarkdown = markdown;
      return { markdown };
    });
    if (removeBeforeParse) {
      this.cleanupFns.push(removeBeforeParse);
    }

    const removeDomUpdated = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      this.buildTaskMap(element);

      const existingHandler = (element as any)._taskListClickHandler;
      if (existingHandler) {
        element.removeEventListener('click', existingHandler);
      }

      const clickHandler = this.createClickHandler(context);
      element.addEventListener('click', clickHandler);
      (element as any)._taskListClickHandler = clickHandler;
    });

    if (removeDomUpdated) {
      this.cleanupFns.push(removeDomUpdated);
    }
  }

  /**
   * 手动设置 Markdown 源码
   */
  setMarkdown(markdown: string): void {
    this.currentMarkdown = markdown;
    this.store?.set('currentMarkdown', markdown);
  }

  /**
   * 获取当前 Markdown 源码
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

/**
 * 任务元数据
 */
interface TaskMetadata {
  taskText: string;
  lineNumber?: number;
}
