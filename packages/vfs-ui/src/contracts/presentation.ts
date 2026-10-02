import { translate, type Translate } from '../utils/i18n';
import { ACTION_ICONS, FILE_BROWSER_ICONS, FILE_ICONS, VFS_TOOLBAR_ICONS, fileTypeIcon } from '../utils/icons';

export type VFSIconName = 'delete' | 'close' | 'favorite' | 'pin' | 'folder' | 'addFile' | 'addFolder' | 'import' | 'export';
export interface VFSPresentationOptions {
    locale?: 'zh-CN' | 'en';
    translate?: Translate;
    /** Trusted SVG or other markup, supplied by the host. */
    icons?: Partial<Record<VFSIconName, string>>;
    fileIcon?(filename: string, directory: boolean): string;
    trace?<T>(label: string, work: () => Promise<T>): Promise<T>;
}
export interface VFSPresentation {
    t: Translate;
    icon(name: VFSIconName): string;
    fileIcon(filename: string, directory?: boolean): string;
    trace<T>(label: string, work: () => Promise<T>): Promise<T>;
}
const defaults: Record<VFSIconName, string> = { delete: ACTION_ICONS.delete, close: ACTION_ICONS.close,
    favorite: ACTION_ICONS.favorite, pin: FILE_ICONS.pin, folder: FILE_ICONS.folder,
    addFile: FILE_BROWSER_ICONS.addFile, addFolder: FILE_BROWSER_ICONS.addFolder,
    import: VFS_TOOLBAR_ICONS.import, export: VFS_TOOLBAR_ICONS.export };
export function createPresentation(options: VFSPresentationOptions = {}): VFSPresentation {
    return {
        t: options.translate ?? ((key, params) => translate(key, params, options.locale)),
        icon: name => options.icons?.[name] ?? defaults[name],
        fileIcon: (name, directory = false) => options.fileIcon?.(name, directory) ?? fileTypeIcon(name, directory),
        trace: options.trace ?? (async (_label, work) => work()),
    };
}
export const defaultPresentation = createPresentation();
