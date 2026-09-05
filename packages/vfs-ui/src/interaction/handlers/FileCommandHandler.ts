/**
 * @file vfs-ui/interaction/handlers/FileCommandHandler.ts
 * @desc Handles file CRUD commands. Bridges Commands → Services.
 */
import type { CommandBus } from '../CommandBus';
import type { IStatePort, IDataOperationPort } from '../../contracts/ports';
import { buildRenamedFilename } from '@itookit/common';
import { findNodeById } from '../../utils/helpers';

export interface FileCommandOptions {
  newFileContent?: string;
  defaultFileName?: string;
  defaultFileContent?: string;
  readContent?: (id: string) => Promise<string | ArrayBuffer>;
  getDuplicateTransformer?: (extension: string) => ((content: string) => string | Promise<string>) | undefined;
}

export class FileCommandHandler {
  private unsubs: (() => void)[] = [];

  constructor(
    private readonly commandBus: CommandBus,
    private readonly store: IStatePort,
    private readonly service: IDataOperationPort,
    private readonly options: FileCommandOptions = {}
  ) {
    this.register();
  }

  private register(): void {
    this.unsubs.push(
      this.commandBus.on('file:create', async ({ type, title, parentPath }) => {
        try {
          if (type === 'file') {
            await this.service.createFile({
              title,
              parentPath: parentPath ?? null,
              content: this.options.newFileContent || '',
            });
          } else {
            await this.service.createDirectory({ title, parentPath: parentPath ?? null });
          }
        } catch (e) {
          console.error(`[FileCommandHandler] Create ${type} failed:`, e);
          this.commandBus.execute('ui:cancelCreating', undefined as any);
          alert(`创建失败: ${(e as Error).message}`);
        }
      }),

      this.commandBus.on('file:delete', async ({ itemIds }) => {
        await this.service.deleteItems(itemIds);
      }),

      this.commandBus.on('file:rename', async ({ itemId, newTitle }) => {
        try {
          const item = findNodeById(this.store.getState().items, itemId);
          const requestedTitle = newTitle.trim();
          const originalName = item?.metadata.custom?._originalName as string | undefined;
          const finalName = item?.type === 'file' && originalName
            ? buildRenamedFilename(requestedTitle, originalName).filename
            : requestedTitle;

          await this.service.renameItem(itemId, finalName);
        } catch (e: any) {
          alert(`重命名失败: ${e.message}`);
        }
      }),

      this.commandBus.on('file:move', async ({ itemIds, targetId }) => {
        await this.service.moveItems({ itemIds, targetId });
      }),

      this.commandBus.on('file:updateTags', async ({ itemIds, tags }) => {
        await this.service.updateMultipleItemsTags({ itemIds, tags });
      }),

      this.commandBus.on('file:duplicate', async ({ itemId }) => {
        try {
          const item = findNodeById(this.store.getState().items, itemId);
          if (!item || item.type !== 'file') return;

          const ext = (item.metadata.custom?._extension as string) || '';
          const raw = await this.options.readContent?.(itemId);
          if (raw === undefined) return;

          const transformer = typeof raw === 'string'
            ? this.options.getDuplicateTransformer?.(ext)
            : undefined;
          const content = transformer ? await transformer(raw as string) : raw;

          await this.service.createFile({
            title: `${item.metadata.title} (copy)${ext}`,
            parentPath: item.metadata.parentPath ?? null,
            content,
          });
        } catch (e: any) {
          console.error('[FileCommandHandler] Duplicate failed:', e);
        }
      })
    );
  }

  destroy(): void {
    this.unsubs.forEach(u => u());
  }
}
