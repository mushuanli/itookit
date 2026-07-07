// @file: device-llm/device/migration-helper.ts
//
// MigrationHelper — one-time data migrations for LLM config paths.

import type { IVFSManager, IModuleFS } from '@itookit/common';
import { VFSHelpers } from './vfs-helpers';

// ─── 存储路径（需与 llm-device-driver.ts 同步）─────────────────────────────────
const CONNECTIONS_DIR     = '/llm/.connections';
const DEFAULTS_VERSION    = '/llm/.connections_version.json';
const MCP_DIR             = '/llm/.mcp';
const OLD_CONNECTIONS_DIR = '/_llm/.connections';
const OLD_DEFAULTS_VERSION = '/_llm/.connections_version.json';

export class MigrationHelper {
    constructor(
        private readonly engine: IModuleFS,
        private readonly vfs: IVFSManager,
        private readonly helpers: VFSHelpers,
    ) {}

    /** Migrate connections from old /_llm/.connections to /llm/.connections */
    async migrateConnectionsIfNeeded(): Promise<void> {
        try {
            // Skip if new path already has data
            const newDirId = await this.engine.driver.resolvePath(CONNECTIONS_DIR);
            if (newDirId) {
                const children = await this.engine.driver.getChildren(newDirId);
                if (children.some(c => c.type === 'file' && c.name.endsWith('.json'))) return;
            }

            // Check old path
            const oldDirId = await this.engine.driver.resolvePath(OLD_CONNECTIONS_DIR);
            if (!oldDirId) return;

            console.info('[LLMDeviceDriver] Migrating connections from old path...');
            const children = await this.engine.driver.getChildren(oldDirId);
            for (const child of children) {
                if (child.type !== 'file' || !child.name.endsWith('.json')) continue;
                try {
                    const raw = await this.engine.driver.readContent(child.path);
                    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
                    await this.helpers.engineUpsert(`${CONNECTIONS_DIR}/${child.name}`, text);
                } catch { /* skip */ }
            }

            // Migrate version file
            const oldVer = await this.helpers.readJson<object>(OLD_DEFAULTS_VERSION);
            if (oldVer) await this.helpers.writeJson(DEFAULTS_VERSION, oldVer);

            console.info('[LLMDeviceDriver] Connection migration complete.');
        } catch (e) {
            console.error('[LLMDeviceDriver] Migration failed:', e);
        }
    }

    /** Migrate MCP servers from agents:/.mcp to /llm/.mcp */
    async migrateMCPIfNeeded(): Promise<void> {
        try {
            // Skip if new path already has data
            const newDirId = await this.engine.driver.resolvePath(MCP_DIR);
            if (newDirId) {
                const children = await this.engine.driver.getChildren(newDirId);
                if (children.some(c => c.type === 'file' && c.name.endsWith('.json'))) return;
            }

            // Try to read from agents module
            const agentsModule = 'agents';
            if (!this.vfs.getModule(agentsModule)) return;

            const agentsEngine = this.vfs.getEngine(agentsModule);
            const oldMcpDirId = await agentsEngine.driver.resolvePath('/.mcp');
            if (!oldMcpDirId) return;

            console.info('[LLMDeviceDriver] Migrating MCP servers from agents module...');
            const children = await agentsEngine.driver.getChildren(oldMcpDirId);
            for (const child of children) {
                if (child.type !== 'file' || !child.name.endsWith('.json')) continue;
                try {
                    const raw = await agentsEngine.driver.readContent(child.path);
                    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
                    await this.helpers.engineUpsert(`${MCP_DIR}/${child.name}`, text);
                } catch { /* skip */ }
            }
            console.info('[LLMDeviceDriver] MCP migration complete.');
        } catch (e) {
            console.error('[LLMDeviceDriver] MCP migration failed:', e);
        }
    }
}
