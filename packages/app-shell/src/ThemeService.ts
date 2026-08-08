// @file: app-shell/src/ThemeService.ts
// Manages light / dark / system theme preference.
// Persists to etc:/ui/theme.json via VFS; applies data-theme on <html>.

import type { IVFSManager } from '@itookit/stdio';
import { CONFIG_MODULE } from '@itookit/stdio';

export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_CHANGE_EVENT = 'app:theme-change';
const THEME_PATH = '/ui/theme.json';

export class ThemeService {
    private mode: ThemeMode = 'system';
    private mq: MediaQueryList;
    private mqListener: () => void;
    private vfs: IVFSManager | null = null;

    constructor() {
        this.mq = window.matchMedia('(prefers-color-scheme: dark)');
        this.mqListener = () => {
            if (this.mode === 'system') this.applyTheme();
        };
        this.mq.addEventListener('change', this.mqListener);
    }

    /** Call after VFS is ready. Loads persisted preference and applies theme. */
    async init(vfs: IVFSManager): Promise<void> {
        this.vfs = vfs;
        this.mode = await this.loadMode();
        this.applyTheme();

        // Listen for changes dispatched by AppearanceSettingsEditor
        window.addEventListener(THEME_CHANGE_EVENT, (e) => {
            const mode = (e as CustomEvent<{ mode: ThemeMode }>).detail?.mode;
            if (mode) this.applyMode(mode);
        });
    }

    getMode(): ThemeMode {
        return this.mode;
    }

    getEffective(): 'light' | 'dark' {
        return this.mode === 'system'
            ? (this.mq.matches ? 'dark' : 'light')
            : this.mode;
    }

    async setMode(mode: ThemeMode): Promise<void> {
        this.mode = mode;
        this.applyTheme();
        await this.saveMode(mode);
        window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, {
            detail: { mode, effective: this.getEffective() },
        }));
    }

    /** Apply without persisting — used internally when reacting to events */
    private applyMode(mode: ThemeMode): void {
        this.mode = mode;
        this.applyTheme();
    }

    private applyTheme(): void {
        document.documentElement.setAttribute('data-theme', this.getEffective());
    }

    private async loadMode(): Promise<ThemeMode> {
        if (!this.vfs) return 'system';
        try {
            const raw = await this.vfs.read(CONFIG_MODULE, THEME_PATH);
            const json = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer));
            const m = json?.mode;
            return m === 'light' || m === 'dark' || m === 'system' ? m : 'system';
        } catch {
            return 'system';
        }
    }

    private async saveMode(mode: ThemeMode): Promise<void> {
        if (!this.vfs) return;
        await this.vfs.write(CONFIG_MODULE, THEME_PATH, JSON.stringify({ mode }, null, 2));
    }

    destroy(): void {
        this.mq.removeEventListener('change', this.mqListener);
    }
}

export const themeService = new ThemeService();
