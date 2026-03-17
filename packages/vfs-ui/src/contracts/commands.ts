/**
 * @file vfs-ui/contracts/commands.ts
 * @desc Strongly-typed command definitions. Replaces stringly-typed Coordinator channels
 *       for ALL internal UI → Data mutations.
 */

import type { UISettings } from './types';

/**
 * 全部命令的类型映射表
 * 
 * 命名规范: 'domain:verb'
 * - file:     文件/目录 CRUD
 * - nav:      导航
 * - select:   选择
 * - ui:       纯 UI 状态
 * - bulk:     批量操作
 */
export interface CommandMap {
  // --- File Operations ---
  'file:create': { type: 'file' | 'directory'; title: string; parentId: string | null };
  'file:delete': { itemIds: string[] };
  'file:rename': { itemId: string; newTitle: string };
  'file:move': { itemIds: string[]; targetId: string | null; position?: 'before' | 'after' | 'into' };
  'file:import': { parentId: string | null };
  'file:updateTags': { itemIds: string[]; tags: string[] };

  // --- Navigation ---
  'nav:selectSession': { sessionId: string | null };
  'nav:toggleFolder': { folderId: string };
  'nav:navigateToHeading': { elementId: string };

  // --- UI State ---
  'ui:toggleSidebar': void;
  'ui:updateSettings': { settings: Partial<UISettings> };
  'ui:startCreating': { type: 'file' | 'directory'; parentId: string | null };
  'ui:cancelCreating': void;
  'ui:updateSearch': { query: string };
  'ui:toggleOutline': { itemId: string };
  'ui:toggleOutlineH1': { elementId: string };

  // --- Selection ---
  'selection:update': { ids: string[]; mode: 'toggle' | 'replace' };
  'selection:clear': void;
  'selection:selectAll': { visibleItemIds: string[] };

  // --- Move Modal ---
  'move:start': { itemIds: string[] };
  'move:end': void;

  // --- Bulk ---
  'bulk:delete': { itemIds: string[] };
  'bulk:move': { itemIds: string[] };
  'bulk:editTags': { itemIds: string[]; position: { x: number; y: number } };

  // --- Custom ---
  'custom:menuAction': { action: string; item: any };
}

export type CommandName = keyof CommandMap;
export type CommandPayload<T extends CommandName> = CommandMap[T];
