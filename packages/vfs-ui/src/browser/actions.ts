import type { BrowserNode } from '../contracts/source';
export interface ActionContext {
  readonly selection: readonly BrowserNode[];
  readonly target: BrowserNode | null;
  readonly parent: BrowserNode | null;
}
export interface BrowserAction {
  readonly id: string;
  readonly label: string;
  readonly placements: readonly ('toolbar' | 'menu' | 'selection')[];
  state?(context: ActionContext): { visible: boolean; enabled: boolean; reason?: string };
  run(context: ActionContext, signal: AbortSignal): Promise<void>;
}
