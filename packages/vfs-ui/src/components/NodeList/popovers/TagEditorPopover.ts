/**
 * @file vfs-ui/components/NodeList/popovers/TagEditorPopover.ts
 * @desc Manages the tag editor popover lifecycle
 */
import type { TagEditorFactory } from '../../../types/types';

export interface TagEditorOptions {
  initialTags: string[];
  onSave: (tags: string[]) => void;
  onCancel: () => void;
  position: { x: number; y: number };
}

export class TagEditorPopover {
  private element: HTMLElement | null = null;

  constructor(private readonly tagEditorFactory: TagEditorFactory) {}

  show(options: TagEditorOptions): void {
    this.hide();

    this.element = document.createElement('div');
    this.element.className = 'vfs-tag-editor vfs-tag-editor--popover';
    document.body.appendChild(this.element);

    this.element.style.left = `${options.position.x}px`;
    this.element.style.top = `${options.position.y}px`;

    try {
      this.tagEditorFactory({
        container: this.element,
        initialTags: options.initialTags,
        onSave: (newTags: string[]) => {
          options.onSave(newTags);
          this.hide();
        },
        onCancel: () => {
          options.onCancel();
          this.hide();
        }
      });
    } catch (error) {
      console.error('[TagEditorPopover] Factory execution failed:', error);
      this.hide();
    }
  }

  hide(): void {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }

  isVisible(): boolean {
    return this.element !== null;
  }

  containsElement(target: Element): boolean {
    return this.element?.contains(target) ?? false;
  }

  destroy(): void {
    this.hide();
  }
}
