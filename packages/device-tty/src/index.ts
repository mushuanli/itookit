// @file: device-tty/src/index.ts
// @itookit/device-tty — TTY device driver for interactive shell sessions.

export { NodeTTYDriver } from './node-tty-driver';
export type { NodeTTYSession } from './node-tty-driver';
export { TTYSessionManager, collectOutput } from './session-manager';
