/**
 * @file packages/vfslib/src/factory.ts
 * @desc VFS 工厂
 */

import type {
    VFSFactoryOptions,
    VFSInstance,
} from '@itookit/common';

import { CONFIG_MODULE } from '@itookit/common';
import { VFSEngine } from './engine/vfs-engine';
import { VFSManager } from './services/vfs-manager';
import { ConfigService } from './services/config-service';
import { nullDevice, zeroDevice, randomDevice } from './devices';

export async function createVFS(options: VFSFactoryOptions): Promise<VFSInstance> {
    const engine = new VFSEngine(options.rootBackend, {
        maxSymlinkDepth: options.maxSymlinkDepth,
    });

    // Register user plugins (before init)
    if (options.plugins) {
        for (const plugin of options.plugins) {
            engine.plugins.register(plugin);
        }
    }

    // Create manager and initialize (bootstraps /dev/ directory)
    const manager = new VFSManager(engine);
    // Wire the mount router into the engine so all path-based operations
    // route to the correct backend (e.g. LocalFSBackend for /module/home).
    engine.setMountRouter(manager.mounts.router);
    await manager.initialize();

    // Register built-in devices → creates /dev/null, /dev/zero, /dev/random
    await manager.registerDevice(nullDevice);
    await manager.registerDevice(zeroDevice);
    await manager.registerDevice(randomDevice);

    // Register user devices → creates /dev/<handlerId> for each
    if (options.devices) {
        for (const device of options.devices) {
            await manager.registerDevice(device);
        }
    }

    // Mount additional backends
    if (options.additionalMounts) {
        for (const am of options.additionalMounts) {
            await manager.mounts.mountBackend(am.path, am.backend, am.options);
        }
    }

    // Mount modules
    if (options.modules) {
        await manager.mountAll(options.modules);
    }

    // Create config service
    const config = new ConfigService(() => manager.getEngine(CONFIG_MODULE));

    // Write initial configs (only if not already present)
    if (options.initialConfigs) {
        for (const [configName, entries] of Object.entries(options.initialConfigs)) {
            const existing = await config.getAll(configName);
            if (Object.keys(existing).length === 0) {
                await config.setBatch(configName, entries);
            }
        }
    }

    return { manager, config };
}
