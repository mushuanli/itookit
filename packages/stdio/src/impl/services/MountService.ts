/**
 * @file packages/stdio/src/impl/services/MountService.ts
 * @desc 挂载子服务 + 挂载路由器（最长前缀匹配）。
 *
 * 从 VFSManager 拆分（SRP）：挂载生命周期、路径解析、跨挂载判断。
 */

import type {
    IMountService,
    IMountRouter,
    IStorageBackend,
    MountPoint,
    MountOptions,
    ResolvedMount,
} from '../../protocol';
import { FSError } from '../../protocol';
import type { VFSEngine } from '../engine/vfs-engine';
import { detectCapabilities } from '../engine/capabilities';
import * as P from '../../utils/path';

export class MountService implements IMountService {
    readonly router: IMountRouter;
    private readonly engine: VFSEngine;

    constructor(engine: VFSEngine) {
        this.engine = engine;
        this.router = new InlineMountRouter(engine);
    }

    async mountBackend(
        mountPath: string,
        backend: IStorageBackend,
        options?: MountOptions,
    ): Promise<MountPoint> {
        const mount = await this.router.mount(mountPath, backend, options);
        this.engine.events.emit('mount:added', {
            mountPath: mount.mountPath,
            mountId: mount.mountId,
            label: mount.options.label,
        });
        return mount;
    }

    async unmountBackend(mountPath: string, force?: boolean): Promise<void> {
        const mount = this.router.getMountByPath(mountPath);
        await this.router.unmount(mountPath, force);
        if (mount) {
            this.engine.events.emit('mount:removed', {
                mountPath: mount.mountPath,
                mountId: mount.mountId,
                label: mount.options.label,
            });
        }
    }

    listMounts(): MountPoint[] {
        return this.router.listMounts();
    }

    getMountForPath(absolutePath: string): MountPoint {
        return this.router.resolve(absolutePath).mount;
    }
}

class InlineMountRouter implements IMountRouter {
    private readonly mounts = new Map<string, MountPoint>();
    private nextId = 1;

    constructor(engine: VFSEngine) {
        const backend = engine.getBackend();
        this.mounts.set('/', {
            mountId: 'mount_0',
            mountPath: '/',
            backend,
            options: { label: 'Root' },
            mountedAt: Date.now(),
            capabilities: detectCapabilities(backend, { deviceFiles: true, mount: true }),
        });
    }

    async mount(
        mountPath: string,
        backend: IStorageBackend,
        options?: MountOptions,
    ): Promise<MountPoint> {
        const norm = P.normalize(mountPath);
        if (this.mounts.has(norm)) {
            throw new FSError('EEXIST', 'mount already exists: ' + norm, 'mount', norm);
        }

        await backend.init();

        // Bootstrap root in the mounted backend if absent
        const existingRoot = await backend.stat('/');
        if (!existingRoot) {
            await backend.mkdir('/');
        }

        const mp: MountPoint = {
            mountId: 'mount_' + this.nextId++,
            mountPath: norm,
            backend,
            options: options ?? {},
            mountedAt: Date.now(),
            capabilities: detectCapabilities(backend, {
                readonly: options?.readonly ?? false,
                syncable: options?.syncable ?? false,
            }),
        };
        this.mounts.set(norm, mp);
        return mp;
    }

    async unmount(mountPath: string, _force?: boolean): Promise<void> {
        const norm = P.normalize(mountPath);
        if (norm === '/') {
            throw new FSError('EINVAL', 'cannot unmount root', 'unmount', '/');
        }
        const mp = this.mounts.get(norm);
        if (!mp) {
            throw new FSError('ENOENT', 'mount not found: ' + norm, 'unmount', norm);
        }
        await mp.backend.close();
        this.mounts.delete(norm);
    }

    resolve(absolutePath: string): ResolvedMount {
        const norm = P.normalize(absolutePath);
        let bestMatch: MountPoint | null = null;
        let bestLen = 0;

        for (const [path, mp] of this.mounts) {
            if (P.isUnder(norm, path) && path.length > bestLen) {
                bestMatch = mp;
                bestLen = path.length;
            }
        }

        if (!bestMatch) bestMatch = this.mounts.get('/')!;

        const relativePath = bestLen <= 1
            ? norm.slice(1)
            : P.relative(bestMatch.mountPath, norm);

        return { mount: bestMatch, relativePath };
    }

    isCrossMount(srcPath: string, destPath: string): boolean {
        return this.resolve(srcPath).mount.mountId !== this.resolve(destPath).mount.mountId;
    }

    listMounts(): MountPoint[] {
        return Array.from(this.mounts.values());
    }

    getMount(mountId: string): MountPoint | null {
        for (const mp of this.mounts.values()) {
            if (mp.mountId === mountId) return mp;
        }
        return null;
    }

    getMountByPath(mountPath: string): MountPoint | null {
        return this.mounts.get(P.normalize(mountPath)) ?? null;
    }
}
