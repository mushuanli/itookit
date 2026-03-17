/**
 * @file vfs-ui/contracts/events.ts
 * @desc Public event definitions emitted by VFSUIShell to external consumers.
 *       These are OUTBOUND events only. Commands are INBOUND.
 */

import type { VFSNodeUI, VFSUIState } from './types';

/**
 * 公共事件映射表
 * 
 * 外部消费者通过 shell.on('sessionSelected', ...) 监听
 * 内部通过 IEventEmitter.emit 触发
 */
export interface PublicEventMap {
  'sessionSelected': { item: VFSNodeUI | undefined };
  'navigateToHeading': { elementId: string };
  'importRequested': { parentId: string | null };
  'sidebarStateChanged': { isCollapsed: boolean };
  'menuItemClicked': { actionId: string; item: VFSNodeUI };
  'stateChanged': { state: VFSUIState };
}

export type PublicEventName = keyof PublicEventMap;
export type PublicEventPayload<T extends PublicEventName> = PublicEventMap[T];
