// tests/plugin.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileSystem } from '../src/core/filesystem.js';
import { MemoryBackend } from '../src/backend/memory.js';
import { FileSystemError } from '../src/core/errors.js';
import type { MiddlewarePlugin, OperationContext, Plugin } from '../src/interface';
import { MiddlewarePipeline } from '../src/plugin/middleware.js';
import { PluginManager } from '../src/plugin/manager.js';
import { loggerPlugin } from '../src/plugin/builtins.js';

describe('Plugin System', () => {
  let fs: FileSystem;

  beforeEach(async () => {
    const backend = new MemoryBackend();
    fs = new FileSystem(backend);
    await fs.init();
  });

  describe('middleware plugin', () => {
    it('should intercept operations', async () => {
      const log: string[] = [];

      const plugin: MiddlewarePlugin = {
        name: 'test-logger',
        version: '1.0.0',
        type: 'middleware',
        middleware() {
          return async (ctx, next) => {
            log.push(`before:${ctx.operation}:${ctx.path}`);
            await next();
            log.push(`after:${ctx.operation}:${ctx.path}`);
          };
        },
      };

      await fs.use(plugin);
      await fs.create('/test.txt', 'hello');

      expect(log).toContain('before:create:/test.txt');
      expect(log).toContain('after:create:/test.txt');
    });

    it('should execute in priority order', async () => {
      const order: number[] = [];

      const pluginA: MiddlewarePlugin = {
        name: 'plugin-a',
        version: '1.0.0',
        type: 'middleware',
        priority: 10,
        middleware() {
          return async (_ctx, next) => {
            order.push(10);
            await next();
          };
        },
      };

      const pluginB: MiddlewarePlugin = {
        name: 'plugin-b',
        version: '1.0.0',
        type: 'middleware',
        priority: 1,
        middleware() {
          return async (_ctx, next) => {
            order.push(1);
            await next();
          };
        },
      };

      // 注册顺序与执行顺序无关
      await fs.use(pluginA);
      await fs.use(pluginB);

      await fs.create('/t.txt', 'data');
      expect(order).toEqual([1, 10]);
    });

    it('should use default priority 100 when not specified', async () => {
      const order: number[] = [];

      const lowPriority: MiddlewarePlugin = {
        name: 'low',
        version: '1.0.0',
        type: 'middleware',
        priority: 50,
        middleware() {
          return async (_ctx, next) => {
            order.push(50);
            await next();
          };
        },
      };

      const defaultPriority: MiddlewarePlugin = {
        name: 'default',
        version: '1.0.0',
        type: 'middleware',
        // 不设置 priority，默认为 100
        middleware() {
          return async (_ctx, next) => {
            order.push(100);
            await next();
          };
        },
      };

      await fs.use(defaultPriority);
      await fs.use(lowPriority);

      await fs.create('/t.txt', 'data');
      expect(order).toEqual([50, 100]);
    });

    it('should allow middleware to modify result', async () => {
      const upperPlugin: MiddlewarePlugin = {
        name: 'upper',
        version: '1.0.0',
        type: 'middleware',
        middleware() {
          return async (ctx, next) => {
            await next();
            if (ctx.operation === 'read' && typeof ctx.result === 'string') {
              ctx.result = (ctx.result as string).toUpperCase();
            }
          };
        },
      };

      await fs.use(upperPlugin);
      await fs.create('/hello.txt', 'hello world');
      const content = await fs.read('/hello.txt');
      expect(content).toBe('HELLO WORLD');
    });

    it('should allow middleware to block operations', async () => {
      const readonlyPlugin: MiddlewarePlugin = {
        name: 'readonly',
        version: '1.0.0',
        type: 'middleware',
        middleware() {
          return async (ctx, next) => {
            if (['write', 'create', 'unlink', 'rename'].includes(ctx.operation)) {
              if (ctx.path.startsWith('/protected/')) {
                throw new FileSystemError('EACCES', ctx.path, 'Read-only area');
              }
            }
            await next();
          };
        },
      };

      await fs.use(readonlyPlugin);
      await fs.mkdir('/protected');

      await expect(
        fs.create('/protected/file.txt', 'data'),
      ).rejects.toThrow(FileSystemError);

      // 非保护区域正常
      await fs.create('/normal.txt', 'ok');
      expect(await fs.read('/normal.txt')).toBe('ok');
    });

    it('should handle middleware errors gracefully', async () => {
      const badPlugin: MiddlewarePlugin = {
        name: 'bad',
        version: '1.0.0',
        type: 'middleware',
        middleware() {
          return async (_ctx, _next) => {
            throw new Error('Plugin crashed');
          };
        },
      };

      await fs.use(badPlugin);
      await expect(fs.create('/test.txt', 'data')).rejects.toThrow(
        'Plugin crashed',
      );
    });

    it('should intercept all operation types', async () => {
      const ops: string[] = [];

      const spy: MiddlewarePlugin = {
        name: 'spy',
        version: '1.0.0',
        type: 'middleware',
        middleware() {
          return async (ctx, next) => {
            ops.push(ctx.operation);
            await next();
          };
        },
      };

      await fs.use(spy);

      await fs.create('/file.txt', 'data');
      await fs.read('/file.txt');
      await fs.write('/file.txt', 'updated');
      await fs.append('/file.txt', ' more');
      await fs.stat('/file.txt');
      await fs.exists('/file.txt');
      await fs.getMetadata('/file.txt');
      await fs.setMetadata('/file.txt', { mimeType: 'text/plain' });
      await fs.copy('/file.txt', '/copy.txt');
      await fs.rename('/copy.txt', '/renamed.txt');
      await fs.mkdir('/dir');
      await fs.readdir('/dir');
      await fs.rmdir('/dir');
      await fs.unlink('/renamed.txt');

      expect(ops).toContain('create');
      expect(ops).toContain('read');
      expect(ops).toContain('write');
      expect(ops).toContain('append');
      expect(ops).toContain('stat');
      expect(ops).toContain('exists');
      expect(ops).toContain('getMetadata');
      expect(ops).toContain('setMetadata');
      expect(ops).toContain('copy');
      expect(ops).toContain('rename');
      expect(ops).toContain('mkdir');
      expect(ops).toContain('readdir');
      expect(ops).toContain('rmdir');
      expect(ops).toContain('unlink');
    });

    it('should provide correct context fields', async () => {
      let capturedCtx: OperationContext | null = null;

      const inspector: MiddlewarePlugin = {
        name: 'inspector',
        version: '1.0.0',
        type: 'middleware',
        middleware() {
          return async (ctx, next) => {
            if (ctx.operation === 'create') {
              capturedCtx = { ...ctx, state: new Map(ctx.state) };
            }
            await next();
          };
        },
      };

      await fs.use(inspector);
      await fs.create('/inspected.txt', 'hello');

      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx!.operation).toBe('create');
      expect(capturedCtx!.path).toBe('/inspected.txt');
      expect(capturedCtx!.startTime).toBeGreaterThan(0);
      expect(capturedCtx!.args).toBeDefined();
    });

    it('should not call next middleware if previous does not call next', async () => {
      const secondCalled = vi.fn();

      const blocker: MiddlewarePlugin = {
        name: 'blocker',
        version: '1.0.0',
        type: 'middleware',
        priority: 1,
        middleware() {
          return async (_ctx, _next) => {
            // 故意不调用 next()
          };
        },
      };

      const observer: MiddlewarePlugin = {
        name: 'observer',
        version: '1.0.0',
        type: 'middleware',
        priority: 2,
        middleware() {
          return async (_ctx, next) => {
            secondCalled();
            await next();
          };
        },
      };

      await fs.use(blocker);
      await fs.use(observer);

      // blocker 不调用 next，所以 observer 不会执行，core 也不会执行
      await fs.exists('/anything');
      expect(secondCalled).not.toHaveBeenCalled();
    });
  });

  describe('plugin management', () => {
    it('should list registered plugins', async () => {
      const plugin: MiddlewarePlugin = {
        name: 'test-plugin',
        version: '2.0.0',
        type: 'middleware',
        middleware: () => async (_ctx, next) => next(),
      };

      await fs.use(plugin);
      const list = fs.plugins.list();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('test-plugin');
      expect(list[0].version).toBe('2.0.0');
      expect(list[0].type).toBe('middleware');
    });

    it('should prevent duplicate plugin registration', async () => {
      const plugin: MiddlewarePlugin = {
        name: 'dup',
        version: '1.0.0',
        type: 'middleware',
        middleware: () => async (_ctx, next) => next(),
      };

      await fs.use(plugin);
      await expect(fs.use(plugin)).rejects.toThrow(FileSystemError);
    });

    it('should remove plugins', async () => {
      const calls: string[] = [];

      const plugin: MiddlewarePlugin = {
        name: 'removable',
        version: '1.0.0',
        type: 'middleware',
        middleware() {
          return async (ctx, next) => {
            calls.push(ctx.operation);
            await next();
          };
        },
      };

      await fs.use(plugin);
      await fs.create('/a.txt', 'a');
      expect(calls).toHaveLength(1);

      await fs.plugins.remove('removable', fs);
      await fs.create('/b.txt', 'b');
      // 移除后不再调用
      expect(calls).toHaveLength(1);
    });

    it('should call install and uninstall hooks', async () => {
      const installed = vi.fn();
      const uninstalled = vi.fn();

      const plugin: MiddlewarePlugin = {
        name: 'lifecycle',
        version: '1.0.0',
        type: 'middleware',
        middleware: () => async (_ctx, next) => next(),
        install: installed,
        uninstall: uninstalled,
      };

      await fs.use(plugin);
      expect(installed).toHaveBeenCalledOnce();
      expect(installed).toHaveBeenCalledWith(fs);

      await fs.plugins.remove('lifecycle', fs);
      expect(uninstalled).toHaveBeenCalledOnce();
      expect(uninstalled).toHaveBeenCalledWith(fs);
    });

    it('should check plugin existence via has()', async () => {
      const plugin: MiddlewarePlugin = {
        name: 'checkable',
        version: '1.0.0',
        type: 'middleware',
        middleware: () => async (_ctx, next) => next(),
      };

      expect(fs.plugins.has('checkable')).toBe(false);
      await fs.use(plugin);
      expect(fs.plugins.has('checkable')).toBe(true);
      await fs.plugins.remove('checkable');
      expect(fs.plugins.has('checkable')).toBe(false);
    });

    it('should retrieve plugin via get()', async () => {
      const plugin: MiddlewarePlugin = {
        name: 'gettable',
        version: '3.0.0',
        type: 'middleware',
        middleware: () => async (_ctx, next) => next(),
      };

      expect(fs.plugins.get('gettable')).toBeUndefined();
      await fs.use(plugin);
      const retrieved = fs.plugins.get<MiddlewarePlugin>('gettable');
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('gettable');
      expect(retrieved!.version).toBe('3.0.0');
    });

    it('should not throw when removing nonexistent plugin', async () => {
      await expect(fs.plugins.remove('nonexistent')).resolves.toBeUndefined();
    });

    it('should list multiple plugins', async () => {
      for (let i = 0; i < 5; i++) {
        const plugin: MiddlewarePlugin = {
          name: `plugin-${i}`,
          version: '1.0.0',
          type: 'middleware',
          middleware: () => async (_ctx, next) => next(),
        };
        await fs.use(plugin);
      }
      const list = fs.plugins.list();
      expect(list).toHaveLength(5);
    });
  });

  describe('middleware state sharing', () => {
    it('should allow middleware to share state via context', async () => {
      const pluginA: MiddlewarePlugin = {
        name: 'state-setter',
        version: '1.0.0',
        type: 'middleware',
        priority: 1,
        middleware() {
          return async (ctx, next) => {
            ctx.state.set('requestId', 'req-123');
            await next();
          };
        },
      };

      let capturedId: string | undefined;

      const pluginB: MiddlewarePlugin = {
        name: 'state-reader',
        version: '1.0.0',
        type: 'middleware',
        priority: 2,
        middleware() {
          return async (ctx, next) => {
            capturedId = ctx.state.get('requestId') as string;
            await next();
          };
        },
      };

      await fs.use(pluginA);
      await fs.use(pluginB);
      await fs.create('/state.txt', 'data');

      expect(capturedId).toBe('req-123');
    });

    it('should have fresh state for each operation', async () => {
      const states: Map<string, unknown>[] = [];

      const tracker: MiddlewarePlugin = {
        name: 'state-tracker',
        version: '1.0.0',
        type: 'middleware',
        middleware() {
          return async (ctx, next) => {
            ctx.state.set('op', ctx.operation);
            states.push(new Map(ctx.state));
            await next();
          };
        },
      };

      await fs.use(tracker);
      await fs.create('/a.txt', 'a');
      await fs.create('/b.txt', 'b');

      expect(states).toHaveLength(2);
      expect(states[0].get('op')).toBe('create');
      expect(states[1].get('op')).toBe('create');
      // 每次调用的 state 是独立的
      expect(states[0]).not.toBe(states[1]);
    });
  });
});

describe('MiddlewarePipeline (unit)', () => {
  let pipeline: MiddlewarePipeline;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
  });

  it('should execute core function when no middleware', async () => {
    const result = await pipeline.execute('test', '/', {}, async () => 'core-result');
    expect(result).toBe('core-result');
  });

  it('should execute middleware in priority order', async () => {
    const order: number[] = [];

    pipeline.add(async (_ctx, next) => {
      order.push(2);
      await next();
    }, 2);

    pipeline.add(async (_ctx, next) => {
      order.push(1);
      await next();
    }, 1);

    pipeline.add(async (_ctx, next) => {
      order.push(3);
      await next();
    }, 3);

    await pipeline.execute('test', '/', {}, async () => {
      order.push(999);
    });

    expect(order).toEqual([1, 2, 3, 999]);
  });

  it('should remove middleware by reference', async () => {
    const calls: string[] = [];

    const handler = async (_ctx: OperationContext, next: () => Promise<void>) => {
      calls.push('removed');
      await next();
    };

    pipeline.add(handler, 1);
    await pipeline.execute('test', '/', {}, async () => {});
    expect(calls).toEqual(['removed']);

    pipeline.remove(handler);
    await pipeline.execute('test', '/', {}, async () => {});
    expect(calls).toEqual(['removed']); // 不再调用
  });

  it('should handle middleware that does not call next', async () => {
    let coreCalled = false;

    pipeline.add(async (_ctx, _next) => {
      // 不调用 next
    }, 1);

    await pipeline.execute('test', '/', {}, async () => {
      coreCalled = true;
    });

    expect(coreCalled).toBe(false);
  });

  it('should propagate errors from middleware', async () => {
    pipeline.add(async (_ctx, _next) => {
      throw new Error('middleware error');
    }, 1);

    await expect(
      pipeline.execute('test', '/', {}, async () => {}),
    ).rejects.toThrow('middleware error');
  });

  it('should propagate errors from core function', async () => {
    await expect(
      pipeline.execute('test', '/', {}, async () => {
        throw new Error('core error');
      }),
    ).rejects.toThrow('core error');
  });
});

describe('PluginManager (unit)', () => {
  let pipeline: MiddlewarePipeline;
  let manager: PluginManager;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
    manager = new PluginManager(pipeline);
  });

  it('should register and list plugins', async () => {
    const plugin: Plugin = {
      name: 'test',
      version: '1.0.0',
      type: 'backend',
    };
    await manager.use(plugin);
    const list = manager.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ name: 'test', version: '1.0.0', type: 'backend' });
  });

  it('should reject duplicate names', async () => {
    const plugin: Plugin = { name: 'dup', version: '1.0.0', type: 'backend' };
    await manager.use(plugin);
    await expect(manager.use(plugin)).rejects.toThrow();
  });

  it('should handle non-middleware plugin types', async () => {
    const plugin: Plugin = { name: 'backend-plugin', version: '1.0.0', type: 'backend' };
    await manager.use(plugin);
    expect(manager.has('backend-plugin')).toBe(true);
  });

  it('should remove plugin and clean up middleware', async () => {
    let called = false;
    const plugin: MiddlewarePlugin = {
      name: 'removable',
      version: '1.0.0',
      type: 'middleware',
      middleware() {
        return async (_ctx, next) => {
          called = true;
          await next();
        };
      },
    };

    await manager.use(plugin);

    // 验证中间件已注册
    await pipeline.execute('test', '/', {}, async () => {});
    expect(called).toBe(true);

    called = false;
    await manager.remove('removable');

    // 验证中间件已移除
    await pipeline.execute('test', '/', {}, async () => {});
    expect(called).toBe(false);
  });
});

describe('builtin logger plugin', () => {
  it('should have correct metadata', () => {
    expect(loggerPlugin.name).toBe('logger');
    expect(loggerPlugin.version).toBe('1.0.0');
    expect(loggerPlugin.type).toBe('middleware');
  });

  it('should produce a middleware handler', () => {
    const handler = loggerPlugin.middleware();
    expect(typeof handler).toBe('function');
  });

  it('should call next and not block operations', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const handler = loggerPlugin.middleware();
    let nextCalled = false;
    const ctx: OperationContext = {
      operation: 'read',
      path: '/test',
      args: {},
      result: undefined,
      state: new Map(),
      startTime: Date.now(),
    };

    await handler(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should log error and rethrow on failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handler = loggerPlugin.middleware();
    const ctx: OperationContext = {
      operation: 'write',
      path: '/fail',
      args: {},
      result: undefined,
      state: new Map(),
      startTime: Date.now(),
    };

    await expect(
      handler(ctx, async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
