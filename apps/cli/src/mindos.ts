/**
 * @file apps/cli/src/mindos.ts
 *
 * MindOS profile resolution for the headless CLI.
 * Reads the shared config file ($XDG_CONFIG_HOME/mindos/mindos.json or
 * ~/.config/mindos/mindos.json) and resolves the real MindOS data root.
 * Mirrors apps/tauri-app/src-tauri/src/lib.rs `resolve_all_paths`.
 */
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    MINDOS_CONFIG_FILE,
    resolveMindOSProfile as resolveProfile,
    type MindOSProfile,
    type MindOSProfileSettings,
} from '@itookit/app-core';

/** Config dir: $XDG_CONFIG_HOME/mindos or ~/.config/mindos. */
function configDir(): string {
    const xdg = process.env.XDG_CONFIG_HOME;
    return xdg ? path.join(xdg, 'mindos') : path.join(homedir(), '.config', 'mindos');
}

function readSettings(): MindOSProfileSettings {
    try {
        const raw = JSON.parse(readFileSync(path.join(configDir(), MINDOS_CONFIG_FILE), 'utf8'));
        return {
            rootDir: typeof raw.rootDir === 'string' && raw.rootDir ? raw.rootDir : undefined,
            homeDir: typeof raw.homeDir === 'string' && raw.homeDir ? raw.homeDir : undefined,
            storageVersion: typeof raw.storageVersion === 'number' ? raw.storageVersion : undefined,
            layoutVersion: typeof raw.layoutVersion === 'number' ? raw.layoutVersion : undefined,
        };
    } catch {
        return {};
    }
}

/** Resolve the shared MindOS profile used by CLI and the desktop app. */
export function resolveMindosProfile(): MindOSProfile {
    return resolveProfile({
        configDir: configDir(),
        settings: readSettings(),
        env: { MINDOS_ROOT: process.env.MINDOS_ROOT },
        resolvePath: (base, relative) => path.resolve(base, relative),
    });
}

/** Resolve the mindos data root. Kept as the CLI's narrow convenience helper. */
export function resolveMindosRoot(): string {
    return resolveMindosProfile().dataRoot;
}

export type CliProfileKind = 'desktop' | 'path';

export interface CliProfile {
    kind: CliProfileKind;
    root: string;
}

/**
 * Resolve the CLI profile selected by `--profile`.
 * - desktop: shared ~/.config/mindos profile (default)
 * - anything else: explicit data root path
 */
export function resolveCliProfile(profile?: string): CliProfile {
    const value = profile?.trim() || 'desktop';
    if (value === 'desktop') return { kind: 'desktop', root: resolveMindosProfile().dataRoot };
    return { kind: 'path', root: path.resolve(value) };
}

/** Resolve the physical profile root. */
export function resolveProfileRoot(profile?: string): string {
    return resolveCliProfile(profile).root;
}
