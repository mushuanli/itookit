export interface SessionLogger {
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
}

/** Process-wide presentation ports, matching the conversation singleton lifecycle. */
export interface SessionHostPorts {
    translate?: (key: SessionTextKey) => string;
    logger?: SessionLogger;
    traceBoot?: <T>(label: string, operation: () => Promise<T>) => Promise<T>;
}

const messages = {
    'chatInput.executionMode.locked': 'The execution mode is locked for this conversation.',
    'chatInput.executionMode.noTools': 'No tools are available for agent execution.',
    'flow.rerun.sessionClosed': 'The session is closed.',
    'flow.rerun.sessionClosing': 'The session is closing.',
    'flow.history.conditionMet': 'Stop condition met',
    'flow.history.roundLimit': 'Round limit reached',
    'flow.history.continue': 'Continue',
};
export type SessionTextKey = keyof typeof messages;
let ports: SessionHostPorts = {};

/** Configure before creating a conversation runtime; omit ports to reset defaults. */
export function configureSessionHostPorts(next: SessionHostPorts = {}): void {
    ports = { ...next };
}

export function t(key: SessionTextKey): string {
    return ports.translate?.(key) ?? messages[key];
}

export function traceBoot<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return ports.traceBoot ? ports.traceBoot(label, operation) : operation();
}

export function createModuleLogger(_module: string): SessionLogger {
    return {
        debug: (message, data) => ports.logger?.debug(message, data),
        info: (message, data) => ports.logger?.info(message, data),
        warn: (message, data) => ports.logger?.warn(message, data),
        error: (message, data) => ports.logger?.error(message, data),
    };
}
