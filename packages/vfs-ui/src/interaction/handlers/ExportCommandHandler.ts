/**
 * @file vfs-ui/interaction/handlers/ExportCommandHandler.ts
 * @desc Handles file export — raw download for plain files, YAML bundle for files with assetdir.
 */
import type { CommandBus } from '../CommandBus';
import type { VFSService } from '../../services/VFSService';
import type { IModuleFS } from '@itookit/vfs-core';
import { serialize } from '@itookit/vfs-core';

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
            }),
        );
    }

    private async exportFiles(itemIds: string[]): Promise<void> {
        if (!itemIds.length) return;

        let exported = 0;
        for (const id of itemIds) {
            try {
                const node = await this.service.findItemById(id);
                if (!node || node.type !== 'file') continue;

                const hasAssets = await this.engine.meta.assets
                    .hasAssetDir(id)
                    .catch(() => false);

                if (hasAssets) {
                    await this.exportWithAssets(node);
                } else {
                    await this.exportRaw(node);
                }
                exported++;
            } catch (e) {
                console.error('[ExportCommandHandler] Export failed:', e);
            }
        }

        if (!exported) {
            alert('导出失败，请确认已选择文件');
        }
    }

    private async exportRaw(node: { path: string; name: string }): Promise<void> {
        const content = await this.engine.driver.readContent(node.path);
        this.download(
            new Blob([content as BlobPart], { type: 'application/octet-stream' }),
            node.name,
        );
    }

    private async exportWithAssets(node: {
        path: string;
        name: string;
        type: 'file';
        mimeType?: string;
        tags?: readonly string[];
        icon?: string;
        metadata?: Record<string, unknown>;
    }): Promise<void> {
        const yaml = await serialize(node as any, {
            readContent: path => this.engine.driver.readContent(path),
            listAssets: path => this.engine.meta.assets.listAssets(path),
            getAsset: (path, name) => this.engine.meta.assets.getAsset(path, name),
        });

        const ymlName = node.name.replace(/\.\w+$/, '') + '.yml';
        this.download(
            new Blob([yaml], { type: 'application/x-yaml' }),
            ymlName,
        );
    }

    private download(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    destroy(): void {
        this.unsubs.forEach(u => u());
    }
}
