/**
 * @file common/interfaces/ISettingsWidget.ts
 * @description Defines the interface for pluggable settings components.
 */
type EventCallback = (payload?: any) => void;

export abstract class ISettingsWidget {
    protected _listeners: Record<string, EventCallback[]> = {};

    protected constructor() {
        if (this.constructor === ISettingsWidget) {
            throw new Error("ISettingsWidget is an interface and cannot be instantiated directly.");
        }
    }

    abstract readonly id: string;
    abstract readonly label: string;
    get iconHTML(): string | null { return null; }
    get description(): string | null { return null; }
    get isDirty(): boolean { return false; }
    get badge(): string | number | null { return null; }
    get isAvailable(): boolean { return true; }

    abstract mount(container: HTMLElement, dependencies?: Record<string, any>): Promise<void>;
    abstract unmount(): Promise<void>;
    abstract destroy(): Promise<void>;

    on(eventName: string, callback: EventCallback): void {
        if (!this._listeners[eventName]) this._listeners[eventName] = [];
        this._listeners[eventName].push(callback);
    }

    off(eventName: string, callback: EventCallback): void {
        if (this._listeners[eventName]) {
            this._listeners[eventName] = this._listeners[eventName].filter(cb => cb !== callback);
        }
    }

    protected emit(eventName: string, payload?: any): void {
        if (this._listeners[eventName]) {
            this._listeners[eventName].forEach(cb => cb(payload));
        }
    }
}
