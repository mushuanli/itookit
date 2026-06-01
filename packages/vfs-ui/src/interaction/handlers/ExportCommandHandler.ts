/**
 * @file vfs-ui/interaction/handlers/ExportCommandHandler.ts
 * @desc Handles file export — read VFS content and trigger browser download.
 */
import type { CommandBus } from '../CommandBus';
import type { VFSService } from '../../services/VFSService';
import type { IModuleFS } from '@itookit/common';

export class ExportCommandHandler {
  private unsubs: (() => void)[] = [];

  constructor(
    private readonly commandBus: CommandBus,
    private readonly service: VFSService,
    private readonly engine: IModuleFS,
  ) {
    this.register();
  }

  private register(): void {
    this.unsubs.push(
      this.commandBus.on('file:export', async ({ itemIds }) => {
        await this.exportFiles(itemIds);
      })
    );
  }

  private async exportFiles(itemIds: string[]): Promise<void> {
    if (!itemIds.length) return;

    let exported = 0;
    for (const id of itemIds) {
      try {
        const node = await this.service.findItemById(id);
        if (!node || node.type !== 'file') continue;

        const content = await this.engine.driver.readContent(id);
        const blob = new Blob([content as BlobPart], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = node.name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        exported++;
      } catch (e) {
        console.error('[ExportCommandHandler] Export failed:', e);
      }
    }

    if (!exported) {
      alert('导出失败，请确认已选择文件');
    }
  }

  destroy(): void {
    this.unsubs.forEach(u => u());
  }
}
