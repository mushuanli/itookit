/**
 * @file vfs-ui/contracts/ports.ts
 * @desc Interfaces that decouple layers. Kept minimal — one per boundary, not per component.
 */
import type { VFSUIState, VFSNodeUI } from './types';
import type { CommandName, CommandPayload } from './commands';
import type { PublicEventName, PublicEventPayload } from './events';
import type { EditorFactory } from '@itookit/common';

/**
 * Port for state reads + writes (Store boundary).
 * Services layer implements this; Components and Interaction layers consume it.
 */
export interface IStatePort {
  getState(): VFSUIState;
  dispatch(action: { type: string; payload?: any }): void;
  subscribe(listener: (state: VFSUIState) => void): () => void;
}

/**
 * Port for executing typed commands (Interaction boundary).
 * Interaction layer implements this; Components layer consumes it.
 */
export interface ICommandPort {
  execute<T extends CommandName>(command: T, payload: CommandPayload<T>): void;
}

/**
 * Port for public events (Shell boundary).
 * Shell layer implements this; external consumers subscribe.
 */
export interface IEventPort {
  emit<T extends PublicEventName>(event: T, payload: PublicEventPayload<T>): void;
  on<T extends PublicEventName>(event: T, handler: (payload: PublicEventPayload<T>) => void): () => void;
}

/**
 * Port for data operations (Engine boundary).
 * Services layer implements this; Interaction layer consumes it.
 */
export interface IDataOperationPort {
  createFile(options: { title?: string; parentPath?: string | null; content?: string | ArrayBuffer }): Promise<any>;
  createFiles(options: { parentPath?: string | null; files: { title: string; content: string | ArrayBuffer }[] }): Promise<any[]>;
  createDirectory(options: { title?: string; parentPath?: string | null }): Promise<any>;
  renameItem(nodeId: string, newTitle: string): Promise<void>;
  deleteItems(nodeIds: string[]): Promise<void>;
  moveItems(options: { itemIds: string[]; targetId: string | null }): Promise<void>;
  updateMultipleItemsTags(options: { itemIds: string[]; tags: string[] }): Promise<void>;
  findItemById(itemId: string): Promise<any>;
}

/**
 * Port for file type resolution (Registry boundary).
 */
export interface IFileTypePort {
  getIcon(filename: string, isDirectory?: boolean): string;
  resolveEditorFactory(node: VFSNodeUI): EditorFactory;
  resolveContentParser(filename: string): ((content: string, ext: string) => any) | undefined;
}

/**
 * Port for data loading and engine synchronization.
 */
export interface IDataSyncPort {
  loadData(): Promise<void>;
  connectEngineEvents(): () => void;
}
