/**
 * #mdx/editor/core/service-container.js
 * @file Implements the dependency injection container.
 */
export class ServiceContainer {
    constructor() {
        this.services = new Map();
    }

    /**
     * Provides a service instance.
     * @param {symbol | string} key - The unique key for the service.
     * @param {any} service - The service instance.
     */
    provide(key, service) {
        if (this.services.has(key)) {
            console.warn(`Service with key "${String(key)}" is already provided and will be overwritten.`);
        }
        this.services.set(key, service);
    }

    /**
     * Injects a service instance.
     * @template T
     * @param {symbol | string} key - The unique key for the service.
     * @returns {T | undefined}
     */
    inject(key) {
        return this.services.get(key);
    }
}
