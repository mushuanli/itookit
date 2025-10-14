// #sidebar/core/SessionUIConfig.js
// JSDoc types for VS Code IntelliSense
/** @typedef {import('../types/types.js')._UISettings} UISettings */

/**
 * Custom error class for configuration-related issues.
 */
class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigError';
    }
}

/**
 * A robust configuration management class for the SessionUI library.
 * It merges user-provided configuration with defaults and validates the result.
 */
export class SessionUIConfig {
    /**
     * Creates an instance of SessionUIConfig.
     * @param {object} userConfig - User-provided configuration overrides.
     */
    constructor(userConfig = {}) {
        /**
         * The final, merged configuration object.
         * @type {object}
         * @private
         */
        this.config = this._mergeWithDefaults(userConfig);
        this._validateConfig();
    }

    /**
     * Merges user configuration with the default configuration.
     * @param {object} userConfig - The user-provided config.
     * @returns {object} The merged configuration.
     * @private
     */
    _mergeWithDefaults(userConfig) {
        const defaults = {
            features: {
                search: true,
                dragAndDrop: true,
                contextMenu: true,
                settings: true
            },
            ui: {
                density: 'comfortable',
                theme: 'light',
                animations: true,
            },
            persistence: {
                enabled: true,
                adapter: 'localStorage' // Future proofing for other adapters
            }
        };

        // A simple deep merge utility
        const deepMerge = (target, source) => {
            const output = { ...target };
            if (isObject(target) && isObject(source)) {
                Object.keys(source).forEach(key => {
                    if (isObject(source[key])) {
                        if (!(key in target)) {
                            Object.assign(output, { [key]: source[key] });
                        } else {
                            output[key] = deepMerge(target[key], source[key]);
                        }
                    } else {
                        Object.assign(output, { [key]: source[key] });
                    }
                });
            }
            return output;
        };
        const isObject = item => (item && typeof item === 'object' && !Array.isArray(item));
        
        return deepMerge(defaults, userConfig);
    }

    /**
     * Validates the final configuration.
     * @throws {ConfigError} if the configuration is invalid.
     * @private
     */
    _validateConfig() {
        const validDensities = ['comfortable', 'compact'];
        const density = this.get('ui.density');
        if (!validDensities.includes(density)) {
            throw new ConfigError(`Invalid density: "${density}". Must be one of [${validDensities.join(', ')}].`);
        }
        
        // Add more validation rules as needed
    }

    /**
     * Gets a configuration value using a dot-notation path.
     * @param {string} keyPath - The path to the configuration value (e.g., 'ui.density').
     * @returns {*} The configuration value, or undefined if not found.
     * @example
     * const density = config.get('ui.density');
     */
    get(keyPath) {
        return keyPath.split('.').reduce((obj, key) => obj && obj[key], this.config);
    }
}
