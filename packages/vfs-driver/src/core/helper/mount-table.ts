// core/helper/mount-table.ts
import type { StorageBackend } from '../../interface/storage';
import type { MountEntry } from '../../interface/types';
import { PathUtils } from '../path';
import { FileSystemError } from '../errors';

interface MountPoint {
  path: string;
  backend: StorageBackend;
}

export class MountTable {
  private mounts: MountPoint[] = [];

  add(path: string, backend: StorageBackend): void {
    const norm = PathUtils.normalize(path);
    if (this.mounts.some((m) => m.path === norm)) {
      throw new FileSystemError('EEXIST', norm, 'Already mounted');
    }
    this.mounts.push({ path: norm, backend });
    this.mounts.sort((a, b) => b.path.length - a.path.length);
  }

  remove(path: string): void {
    const norm = PathUtils.normalize(path);
    const idx = this.mounts.findIndex((m) => m.path === norm);
    if (idx >= 0) this.mounts.splice(idx, 1);
  }

  resolve(path: string): { backend: StorageBackend; subPath: string } | null {
    const norm = PathUtils.normalize(path);
    for (const mount of this.mounts) {
      if (norm === mount.path || norm.startsWith(mount.path + '/')) {
        const subPath =
          norm === mount.path ? '/' : norm.slice(mount.path.length);
        return { backend: mount.backend, subPath };
      }
    }
    return null;
  }

  list(): MountEntry[] {
    return this.mounts.map((m) => ({
      path: m.path,
      backendName: m.backend.name,
    }));
  }
}
