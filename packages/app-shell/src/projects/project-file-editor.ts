import type { ProjectService } from '@itookit/app-core';
import { buildRenamedFilename, traceBoot } from '@itookit/common';
import type { EditorFactory, EditorHostContext, IEditor } from '@itookit/ui-common';
import { FSError, type FileSystemContextOwner } from '@itookit/vfs-core';
import { fileContentFormat } from '../browser/file-format';
import { ViewLoad, ViewLoadCancelled } from '../lifecycle/view-load';

interface ProjectFileOptions {
    factory: EditorFactory;
    mount(): Promise<HTMLElement>;
    showBinary(mount: HTMLElement, path: string, bytes: ArrayBuffer): () => void;
    deferCleanup(cleanup: Promise<void>): void;
    changed(): void;
    host: EditorHostContext;
}
interface OpenedProjectFile { editor?: IEditor; context: FileSystemContextOwner; previewCleanup?: () => void }

export async function openProjectFileEditor(projects: ProjectService, target: { folder: string; path: string },
    load: ViewLoad, options: ProjectFileOptions): Promise<OpenedProjectFile | undefined> {
    let owner: Awaited<ReturnType<ProjectService['openFiles']>> | undefined;
    let editor: IEditor | undefined;
    let mount: HTMLElement | undefined;
    let previewCleanup: (() => void) | undefined;
    try {
        const source = await load.read(async () => owner = await traceBoot('projectFile.source', () => projects.openFiles(target.folder)));
        const context: FileSystemContextOwner = { context: { fs: source.fs, cwd: target.path.slice(0, target.path.lastIndexOf('/')) || '/' }, release: () => source.dispose() };
        const driver = source.fs.driver;
        const node = await load.read(() => traceBoot('projectFile.type', () => driver.getNodeType
            ? driver.getNodeType(target.path) : driver.getNode(target.path)));
        if (!node) throw new FSError('ENOENT', 'File not found');
        if (node.type === 'directory') {
            await context.release(); owner = undefined; load.check(); return undefined;
        }
        mount = await options.mount(); load.check();
        const bytes = await load.read(() => traceBoot('projectFile.read', () => driver.readContent(target.path, { encoding: 'binary' })));
        const content = decodeFile(target.path, bytes);
        if (content === undefined) previewCleanup = options.showBinary(mount, target.path, bytes);
        else editor = await load.read(async () => editor = await createTextEditor(context, target.path, content, mount!, load, options));
        load.check();
        return { editor, context, previewCleanup };
    } catch (error) {
        mount?.remove();
        const cleanup = load.drain().then(async () => { await editor?.destroy(); previewCleanup?.(); await owner?.dispose(); });
        if (error instanceof ViewLoadCancelled) options.deferCleanup(cleanup); else await cleanup;
        throw error;
    }
}

function decodeFile(path: string, bytes: ArrayBuffer): string | undefined {
    if (/\.(pdf|zip|gz|tar|7z|rar|png|jpe?g|gif|webp|avif|ico|mp[34]|wav|ogg|webm|mov|woff2?|ttf|bin|sqlite|db|docx?|xlsx?|pptx?)$/i.test(path)) return;
    try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (!text.includes('\0')) return text; }
    catch { /* Binary files are previewed or downloaded. */ }
}

async function createTextEditor(context: FileSystemContextOwner, path: string, content: string,
    mount: HTMLElement, load: ViewLoad, options: ProjectFileOptions): Promise<IEditor> {
    const { fs } = context.context;
    const readOnly = (await fs.capabilitiesAt(path)).readonly;
    load.check();
    const filename = path.split('/').pop()!;
    return traceBoot('projectFile.editor', () => options.factory(mount, {
        ...fileContentFormat(path), target: { kind: 'file', path }, files: context.context,
        initialContent: content, readOnly, title: buildRenamedFilename(filename, filename).title,
        hostContext: { ...options.host,
            saveContent: readOnly ? undefined : async (file, text) => {
                await fs.driver.writeContent(file, text); options.changed();
            },
        },
    }));
}
