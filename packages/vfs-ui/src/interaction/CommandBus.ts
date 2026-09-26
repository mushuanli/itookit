/**
 * @file vfs-ui/interaction/CommandBus.ts
 * @desc Type-safe command bus implementing ICommandPort.
 */
import type { ICommandPort } from '../contracts/ports';
import type { CommandName, CommandPayload } from '../contracts/commands';

type Handler<T extends CommandName> = (payload: CommandPayload<T>) => void | Promise<void>;

export class CommandBus implements ICommandPort {
  private handlers = new Map<string, Set<Handler<any>>>();

  execute<T extends CommandName>(command: T, payload: CommandPayload<T>): Promise<void> {
    const handlers = this.handlers.get(command);
    if (!handlers?.size) return Promise.resolve();
    const tasks: Promise<void>[] = [];
    for (const handler of handlers) {
      try { tasks.push(Promise.resolve(handler(payload))); }
      catch (error) { tasks.push(Promise.reject(error)); }
    }
    const work = Promise.all(tasks).then(() => {});
    void work.catch(error => console.error(`[CommandBus] ${command} failed`, error));
    return work;
  }

  on<T extends CommandName>(
    command: T,
    handler: Handler<T>
  ): () => void {
    if (!this.handlers.has(command)) {
      this.handlers.set(command, new Set());
    }
    const set = this.handlers.get(command)!;
    set.add(handler);
    return () => set.delete(handler);
  }

  clear(): void {
    this.handlers.clear();
  }
}
