import { BaseSettingsEditor, type EditorFactory, type EditorOptions, type IEditor } from '@itookit/ui-common';
import { escapeHTML, t } from '@itookit/common';
import { SettingsService } from '../services/SettingsService';
import { StorageOverviewSection } from './storage/StorageOverviewSection';
import { SnapshotSection } from './storage/SnapshotSection';
import { MigrationSection } from './storage/MigrationSection';
import { DangerZoneSection } from './storage/DangerZoneSection';

interface StorageSection { init(): void | Promise<void>; destroy?(): void | Promise<void>; }

/** The host injects remote connection management without an upward app-core dependency. */
export class StorageSettingsEditor extends BaseSettingsEditor<SettingsService> {
    private sections: StorageSection[] = [];
    private remoteEditor?: IEditor;
    private initialization?: Promise<void>;
    private closed = false;
    constructor(container: HTMLElement, service: SettingsService, options: EditorOptions, private readonly remoteFiles?: EditorFactory) {
        super(container, service, options);
    }
    async render(): Promise<void> {
        if (this.closed) return;
        return this.initialization ??= this.initializeSections();
    }
    private async initializeSections(): Promise<void> {
        this.container.innerHTML = `<div class="settings-page">
            <div class="settings-page__header"><div>
                <h2 class="settings-page__title">${escapeHTML(t('storage.title'))}</h2>
                <p class="settings-page__description">${escapeHTML(t('storage.description'))}</p>
            </div></div>
            <div data-storage-section="overview"></div>
            <div data-storage-section="remote"></div>
            <div data-storage-section="snapshot"></div>
            <div data-storage-section="migration"></div>
            <div data-storage-section="danger"></div>
        </div>`;
        const section = (name: string) => this.container.querySelector<HTMLElement>(`[data-storage-section="${name}"]`)!;
        this.sections = [new StorageOverviewSection(section('overview')), new SnapshotSection(section('snapshot'), this.service),
            new MigrationSection(section('migration'), this.service), new DangerZoneSection(section('danger'), this.service)];
        await Promise.all(this.sections.map(item => item.init()));
        if (this.closed || !this.remoteFiles) return;
        const editor = await this.remoteFiles(section('remote'), this.options);
        if (this.closed) await editor.destroy(); else this.remoteEditor = editor;
    }
    async destroy(): Promise<void> {
        this.closed = true;
        await this.initialization?.catch(() => {});
        await this.remoteEditor?.destroy(); this.remoteEditor = undefined;
        await Promise.all(this.sections.map(section => section.destroy?.())); this.sections = [];
        await super.destroy();
    }
}
export default StorageSettingsEditor;
