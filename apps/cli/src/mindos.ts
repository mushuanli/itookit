/**
 * @file apps/cli/src/mindos.ts
 *
 * MindOS desktop config resolution for `-b / --boot`: read the shared config
 * (~/.config/mindos/settings.json) and resolve the real mindos data root.
 * Mirrors the tauri side `resolve_all_paths` in apps/tauri-app/src-tauri/src/lib.rs.
 */
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface MindosSettings {
    /** Raw value from settings.json#rootDir — may be relative or absolute. */
    rootDir?: string;
    homeDir?: string;
}

/** Config dir: $XDG_CONFIG_HOME/mindos or ~/.config/mindos. */
function configDir(): string {
    const xdg = process.env.XDG_CONFIG_HOME;
    return xdg ? path.join(xdg, 'mindos') : path.join(homedir(), '.config', 'mindos');
}

function readSettings(): MindosSettings {
    try {
        const raw = JSON.parse(readFileSync(path.join(configDir(), 'settings.json'), 'utf8'));
        return {
            rootDir: typeof raw.rootDir === 'string' && raw.rootDir ? raw.rootDir : undefined,
            homeDir: typeof raw.homeDir === 'string' && raw.homeDir ? raw.homeDir : undefined,
        };
    } catch {
        return {};
    }
}

/**
 * Resolve the mindos data root. Order matches tauri `resolve_all_paths`:
 *   MINDOS_ROOT env → settings.json#rootDir → <configDir>/data (never ~/.mindos).
 * Relative rootDir values are resolved against the config dir.
 */
export function resolveMindosRoot(): string {
    const env = process.env.MINDOS_ROOT;
    if (env) return env;
    const rootDir = readSettings().rootDir;
    if (rootDir) {
        return path.isAbsolute(rootDir) ? rootDir : path.resolve(configDir(), rootDir);
    }
    return path.join(configDir(), 'data');
}
