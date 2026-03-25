/**
 * @file SystemFSExploreEditor.ts
 * @desc Debug settings page — read-only view of all VFS modules using MemoryManager.
 *
 * Layout (within the settings page):
 *   ┌─ settings page header ────────────────────────────────┐
 *   │  "System FS Explorer"   (read-only, debug)            │
 *   ├───────────────────────────────────────────────────────┤
 *   │ ┌── sidebar ──────┐ ┌── editor / viewer ───────────┐  │
 *   │ │ <module>/       │ │  MDX render of file content  │  │
 *   │ │   file.md       │ │                              │  │
 *   │ │   .hidden  ◁──▷ │ │  ⛔ hidden — content blocked  │  │
 *   │ └────────────────-┘ └──────────────────────────────┘  │
 *   └───────────────────────────────────────────────────────┘
 *
 * Hidden files (names starting with ".") are visible in the tree but their
 * content is replaced with a placeholder by SystemVFSEngine.readContent().
 */
import { BaseSettingsEditor } from '@itookit/common';
import { MemoryManager } from '@itookit/memory-manager';
import { SettingsService } from '../services/SettingsService';
import { SystemVFSEngine } from './system-fs/SystemVFSEngine';

export class SystemFSExploreEditor extends BaseSettingsEditor<SettingsService> {
    private manager?: MemoryManager;
    private isStructureInitialized = false;

    async init(container: HTMLElement): Promise<void> {
        await super.init(container);
    }

    async render(): Promise<void> {
        if (this.isStructureInitialized) return;

        // ── Page skeleton ─────────────────────────────────────────────────────
        this.container.innerHTML = `
            <div class="settings-page sfe-page">
                <div class="settings-page__header">
                    <div>
                        <h2 class="settings-page__title">System FS Explorer</h2>
                        <p class="settings-page__description">
                            Read-only debug view of all VFS modules and their files.
                            Hidden files (<code>.</code> prefix) are visible but their
                            content is not shown.
                        </p>
                    </div>
                    <span class="sfe-badge">debug / read-only</span>
                </div>
                <div id="sfe-mount" class="sfe-mount"></div>
            </div>
        `;

        const mount = this.container.querySelector('#sfe-mount') as HTMLElement;

        // ── Engine: cross-module read-only VFS view ───────────────────────────
        const engine = new SystemVFSEngine(this.service.vfs);

        // ── MemoryManager: sidebar (module tree) + MDX viewer ─────────────────
        this.manager = new MemoryManager({
            container: mount,
            scopeId: 'system-fs-explorer',
            customEngine: engine as any,
            uiOptions: {
                readOnly: true,
                title: 'VFS Modules',
                searchPlaceholder: 'Search files…',
                initialSidebarCollapsed: false,
            },
            // Default editor factory (createMDxEditor) displays content.
            // readOnly is enforced at the engine level — writes throw.
            editorConfig: {
                readOnly: true,
                initialMode: 'render',
            },
        });

        await this.manager.start();
        this.isStructureInitialized = true;
    }

    async destroy(): Promise<void> {
        this.manager?.destroy();
        this.manager = undefined;
        this.isStructureInitialized = false;
        await super.destroy();
    }
}
