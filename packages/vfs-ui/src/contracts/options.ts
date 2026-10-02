import type { ResourceListOptions } from './components';
import type { FavoriteAction, VFSNodeUI } from './types';
export type { FileCreationConfig } from './components';
export type BrowserBaseOptions = ResourceListOptions<VFSNodeUI>;

/** A fixed navigation action; its active state is independent of mutable resource selection. */
export interface DirectoryAction {
    /** Insert after the direct child with this resource ID; falls back to the end. */
    afterChildId?: (parentPath: string) => string | undefined;
    label: string;
    /** Trusted icon markup supplied by the host. */
    icon?: string;
    placement?: 'after-first';
    active?(path: string): boolean;
    visible(path: string): boolean;
    disabled?(path: string): boolean;
    run(path: string): Promise<void>;
}

/** Host-owned row actions shared by the shell and the list that renders them. */
export interface VFSRowActionOptions {
    /** Inline creation controls on writable directory rows; the host owns the target semantics. */
    rowCreation?: { visible(node: VFSNodeUI): boolean; run(node: VFSNodeUI, type: 'file' | 'directory'): Promise<void> };
    /** Favorite state and toggle; rows without state hide the control. */
    favoriteAction?: FavoriteAction;
    /** Host deletion for entries that declare `presentation.quickDelete`, after inline confirmation. */
    onQuickDelete?: (node: VFSNodeUI) => Promise<void>;
}
