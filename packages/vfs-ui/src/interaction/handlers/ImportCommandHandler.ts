/**
 * @file vfs-ui/interaction/handlers/ImportCommandHandler.ts
 * @desc Handles file import — raw file creation for regular files,
 *       YAML manifest reconstruction for vfs-export bundles.
 */
import type { CommandBus } from '../CommandBus';
import type { IStatePort } from '../../contracts/ports';
import type { VFSService } from '../../services/VFSService';
import { deserialize, decodeContent } from '@itookit/vfs-core';
import type { VFSExportManifest, VFSExportAsset } from '@itookit/vfs-core';

export class ImportCommandHandler {
    private unsubs: (() => void)[] = [];

    constructor(
        private readonly commandBus: CommandBus,
        private readonly store: IStatePort,
        private readonly service: VFSService,
        private readonly reloadData: () => Promise<void>,
    ) {
        this.register();
    }

    private register(): void {
        this.unsubs.push(
            this.commandBus.on('file:import', ({ parentPath }) => {
                this.showFilePicker(parentPath);
            }),
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
                const ymlFiles: File[] = [];
                const regularFiles: File[] = [];

                for (const file of files) {
                    if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) {
                        ymlFiles.push(file);
                    } else {
                        regularFiles.push(file);
                    }
                }

                // Process YAML manifests (vfs-export format)
                const ymlCreated = await this.importYamlFiles(ymlFiles, parentPath);

                // Process regular files
                const regularCreated = await this.importRegularFiles(regularFiles, parentPath);

                const allCreated = [...ymlCreated, ...regularCreated];

                if (allCreated.length) {
                    await this.reloadData();

                    if (allCreated[0].type === 'file') {
                        setTimeout(() => {
                            this.store.dispatch({
                                type: 'SESSION_SELECT',
                                payload: { sessionId: allCreated[0].path },
                            });
                        }, 50);
                    }
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

    private async importYamlFiles(
        ymlFiles: File[],
        parentPath: string | null,
    ): Promise<{ path: string; type: string }[]> {
        const created: { path: string; type: string }[] = [];

        for (const file of ymlFiles) {
            const yamlText = await this.readAsText(file);
            let manifest: VFSExportManifest;
            try {
                manifest = deserialize(yamlText);
            } catch (e) {
                console.error('[ImportCommandHandler] YAML parse failed:', e);
                alert(`解析 ${file.name} 失败: ${(e as Error).message}`);
                continue;
            }

            // Create the main file
            const mainContent = decodeContent(manifest.file.content);
            const [mainNode] = await this.service.createFiles({
                parentPath,
                files: [
                    {
                        title: manifest.file.name,
                        content: mainContent,
                    },
                ],
            });

            if (!mainNode || mainNode.type !== 'file') continue;
            created.push(mainNode);

            // Restore assets
            const assets = manifest.assets;
            if (assets?.length) {
                await this.restoreAssets(mainNode.path, assets);
            }
        }

        return created;
    }

    private async restoreAssets(
        ownerPath: string,
        assets: VFSExportAsset[],
    ): Promise<void> {
        for (const asset of assets) {
            try {
                const content = decodeContent(asset.content);
                await this.service.putAsset(ownerPath, asset.name, content);
            } catch (e) {
                console.error(
                    `[ImportCommandHandler] Failed to restore asset "${asset.name}":`,
                    e,
                );
            }
        }
    }

    private async importRegularFiles(
        files: File[],
        parentPath: string | null,
    ): Promise<{ path: string; type: string }[]> {
        if (!files.length) return [];

        const filesWithContent = await Promise.all(
            files.map(async file => ({
                title: file.name,
                content: await this.readFileContent(file),
            })),
        );

        return this.service.createFiles({
            parentPath,
            files: filesWithContent,
        });
    }

    private readAsText(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error(`读取失败: ${file.name}`));
            reader.readAsText(file);
        });
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
