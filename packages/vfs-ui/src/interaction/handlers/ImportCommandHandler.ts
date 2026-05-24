/**
 * @file vfs-ui/interaction/handlers/ImportCommandHandler.ts
 * @desc Handles file import operations.
 */
import type { CommandBus } from '../CommandBus';
import type { IStatePort } from '../../contracts/ports';
import type { VFSService } from '../../services/VFSService';

export class ImportCommandHandler {
  private unsubs: (() => void)[] = [];

  constructor(
    private readonly commandBus: CommandBus,
    private readonly store: IStatePort,
    private readonly service: VFSService,
    private readonly reloadData: () => Promise<void>
  ) {
    this.register();
  }

  private register(): void {
    this.unsubs.push(
      this.commandBus.on('file:import', ({ parentPath }) => {
        this.showFilePicker(parentPath);
      })
    );
  }

  private showFilePicker(parentPath: string | null): void {
    const input = Object.assign(document.createElement('input'), {
      type: 'file',
      multiple: true,
      accept: '*/*',
      style: 'display:none',
    });

    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files?.length) return;

      try {
        const filesWithContent = await Promise.all(
          [...files].map(async file => ({
            title: file.name,
            content: await this.readFileContent(file),
          }))
        );

        const created = await this.service.createFiles({
          parentPath,
          files: filesWithContent,
        });

        await this.reloadData();

        if (created.length && created[0].type === 'file') {
          setTimeout(() => {
            this.store.dispatch({
              type: 'SESSION_SELECT',
              payload: { sessionId: created[0].id },
            });
          }, 50);
        }
      } catch (e) {
        console.error('[ImportCommandHandler] Import failed:', e);
        alert('导入失败: ' + (e as Error).message);
      } finally {
        input.remove();
      }
    };

    document.body.appendChild(input);
    input.click();
  }

  private readFileContent(file: File): Promise<string | ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string | ArrayBuffer);
      reader.onerror = () => reject(new Error(`读取失败: ${file.name}`));

      const textExts = ['.md', '.txt', '.json', '.html', '.css', '.js', '.ts', '.yaml', '.yml'];
      const isText =
        file.type.startsWith('text/') ||
        textExts.some(ext => file.name.endsWith(ext));
      isText ? reader.readAsText(file) : reader.readAsArrayBuffer(file);
    });
  }

  destroy(): void {
    this.unsubs.forEach(u => u());
  }
}
