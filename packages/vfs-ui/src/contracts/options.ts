import type { ResourceListOptions } from '@itookit/ui-common';
import type { VFSNodeUI } from './types';
export type { FileCreationConfig } from '@itookit/ui-common';
export type BrowserBaseOptions = ResourceListOptions<VFSNodeUI>;

/** A fixed navigation action; its active state is independent of mutable resource selection. */
export interface DirectoryAction {
    label: string;
    /** Trusted icon markup supplied by the host. */
    icon?: string;
    placement?: 'after-first';
    active?(path: string): boolean;
    visible(path: string): boolean;
    disabled?(path: string): boolean;
    run(path: string): Promise<void>;
}
