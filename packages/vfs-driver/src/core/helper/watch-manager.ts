// core/helper/watch-manager.ts
import type {
  FileChangeEvent,
  Watcher,
  WatchOptions,
} from '../../interface/types';
import { PathUtils } from '../path';

interface WatcherEntry {
  path: string;
  recursive: boolean;
  callback: (event: FileChangeEvent) => void;
}

export class WatchManager {
  private watchers: WatcherEntry[] = [];

  add(
    path: string,
    callback: (event: FileChangeEvent) => void,
    options?: WatchOptions,
  ): Watcher {
    const entry: WatcherEntry = {
      path: PathUtils.normalize(path),
      recursive: options?.recursive ?? false,
      callback,
    };
    this.watchers.push(entry);

    return {
      close: () => {
        const idx = this.watchers.indexOf(entry);
        if (idx >= 0) this.watchers.splice(idx, 1);
      },
    };
  }

  emit(event: FileChangeEvent): void {
    const eventPath = PathUtils.normalize(event.path);
    for (const watcher of this.watchers) {
      if (this.matches(eventPath, watcher)) {
        try {
          watcher.callback(event);
        } catch {
          // 不让 watcher 回调异常影响主流程
        }
      }
    }
  }

  private matches(eventPath: string, watcher: WatcherEntry): boolean {
    if (eventPath === watcher.path) return true;

    const prefix = watcher.path === '/' ? '/' : watcher.path + '/';
    if (!eventPath.startsWith(prefix)) return false;

    if (watcher.recursive) return true;

    const relative = eventPath.slice(prefix.length);
    return !relative.includes('/');
  }
}
