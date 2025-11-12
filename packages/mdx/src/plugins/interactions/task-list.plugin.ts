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
  lineNumber?: number; // 任务在 Markdown 中的行号
}

/**
 * 任务切换结果（操作后）
 */
export interface TaskToggleResult extends TaskToggleDetail {
  originalMarkdown: string;
  updatedMarkdown: string;
  wasUpdated: boolean; // 是否成功更新
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
  
  /**
   * 🔥 修复：将 taskMap 从 static 改为实例属性。
   * 这是最关键的修复。`static` 属性在所有插件实例间共享，会导致多实例场景下的
   * 状态污染和数据错误。改为实例属性后，每个 MDxEditor 实例都将拥有自己独立的
   * `taskMap`，从而实现完全隔离和多实例安全。
   */
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

      // ✅ 修正：从实例属性 `this.taskMap` 读取数据
      const taskMeta = this.taskMap.get(renderRoot)?.get(checkbox);
      const listItem = checkbox.closest('.task-list-item');
      const taskText = listItem?.textContent?.trim() || '';

      const detail: TaskToggleDetail = {
        taskText,
        isChecked: checkbox.checked,
        element: checkbox,
        lineNumber: taskMeta?.lineNumber,
      };

      // 调用 beforeTaskToggle 钩子
      const shouldProceed = await this.options.beforeTaskToggle(detail);
      if (!shouldProceed) {
        // 如果钩子返回 false，则恢复复选框的原始状态并中止操作
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

      // 自动更新 Markdown
      if (this.options.autoUpdateMarkdown && taskMeta) {
        const updated = this.updateMarkdown(taskMeta, detail.isChecked);
        if (updated) {
          result.updatedMarkdown = updated;
          result.wasUpdated = true;
          this.currentMarkdown = updated;
          
          // 保存到持久化存储
          await this.store?.set('currentMarkdown', updated);
        }
      }

      // 触发全局事件，通知编辑器等外部监听者内容已变更
      context.emit('taskToggled', result);
      
      // 调用回调
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

    // ✅ 修正：将映射表存入实例属性 `this.taskMap`
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
    // 注册 Marked 扩展（在 beforeParse 之前）
    context.registerSyntaxExtension(this.createMarkedExtension());

    // 初始化存储
    this.store = context.getScopedStore();
    
    // 恢复持久化的 Markdown
    this.store.get('currentMarkdown').then(saved => {
      if (saved) {
        this.currentMarkdown = saved;
      }
    });

    // 监听 beforeParse 钩子，捕获最新的原始 Markdown
    const removeBeforeParse = context.on('beforeParse', ({ markdown }: { markdown: string }) => {
      this.currentMarkdown = markdown;
      return { markdown };
    });
    if (removeBeforeParse) {
      this.cleanupFns.push(removeBeforeParse);
    }

    // 监听 DOM 更新，构建任务映射并绑定事件
    const removeDomUpdated = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      // 构建任务映射表
      this.buildTaskMap(element);

      // 2. ✅ 修正：实现幂等性，防止重复绑定事件监听器
      // 检查并移除任何先前附加的点击处理器（无论来自哪个实例）
      const existingHandler = (element as any)._taskListClickHandler;
      if (existingHandler) {
        element.removeEventListener('click', existingHandler);
      }

      // 绑定事件监听器
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
