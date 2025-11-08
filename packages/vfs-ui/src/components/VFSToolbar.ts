/**
 * @file vfs-ui/components/VFSToolbar.ts
 */
import { EventBus } from '../core/EventBus';

interface ToolbarOptions {
  container: HTMLElement;
  actions?: ToolbarAction[];
}

export interface ToolbarAction {
  id: string;
  icon: string;
  label: string;
  tooltip?: string;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
}

export class VFSToolbar {
  private container: HTMLElement;
  private actions: ToolbarAction[];
  private eventBus: EventBus;

  constructor(options: ToolbarOptions) {
    this.container = options.container;
    this.actions = options.actions || [];
    this.eventBus = new EventBus();
    
    this._bindEvents();
    this.render();
  }

  /**
   * 添加操作
   */
  addAction(action: ToolbarAction): void {
    this.actions.push(action);
    this.render();
  }

  /**
   * 移除操作
   */
  removeAction(actionId: string): void {
    this.actions = this.actions.filter(a => a.id !== actionId);
    this.render();
  }

  /**
   * 更新操作
   */
  updateAction(actionId: string, updates: Partial<ToolbarAction>): void {
    const action = this.actions.find(a => a.id === actionId);
    if (action) {
      Object.assign(action, updates);
      this.render();
    }
  }

  /**
   * 设置操作禁用状态
   */
  setActionDisabled(actionId: string, disabled: boolean): void {
    this.updateAction(actionId, { disabled });
  }

  /**
   * 渲染
   */
  render(): void {
    const html = `
      <div class="vfs-toolbar">
        ${this.actions.map(action => this._renderAction(action)).join('')}
      </div>
    `;
    
    this.container.innerHTML = html;
  }

  /**
   * 渲染单个操作
   */
  private _renderAction(action: ToolbarAction): string {
    const disabledClass = action.disabled ? 'disabled' : '';
    const tooltip = action.tooltip || action.label;
    
    return `
      <button 
        class="toolbar-button ${disabledClass}"
        data-action-id="${action.id}"
        title="${this._escapeHtml(tooltip)}"
        ${action.disabled ? 'disabled' : ''}
      >
        <span class="button-icon">${action.icon}</span>
        <span class="button-label">${this._escapeHtml(action.label)}</span>
      </button>
    `;
  }

  /**
   * 绑定事件
   */
  private _bindEvents(): void {
    this.container.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest('.toolbar-button');
      
      if (button && !button.hasAttribute('disabled')) {
        const actionId = (button as HTMLElement).dataset.actionId!;
        const action = this.actions.find(a => a.id === actionId);
        
        if (action) {
          try {
            await action.onClick();
            this.eventBus.emit('actionClick', { actionId });
          } catch (error) {
            console.error(`Error executing action ${actionId}:`, error);
            this.eventBus.emit('actionError', { actionId, error });
          }
        }
      }
    });
  }

  /**
   * HTML 转义
   */
  private _escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 订阅事件
   */
  on(event: string, callback: (data: any) => void): () => void {
    return this.eventBus.on(event, callback);
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.eventBus.clear();
    this.container.innerHTML = '';
  }
}
