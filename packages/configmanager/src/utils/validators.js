// #configManager/utils/validators.js

/**
 * @fileoverview 参数验证工具函数
 */

import { ValidationError } from './errors.js';

export function validateString(value, paramName) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ValidationError(`${paramName} must be a non-empty string`);
    }
}

export function validateObject(value, paramName) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ValidationError(`${paramName} must be an object`);
    }
}

export function validateArray(value, paramName) {
    if (!Array.isArray(value)) {
        throw new ValidationError(`${paramName} must be an array`);
    }
}

export function validateNumber(value, paramName) {
    if (typeof value !== 'number' || isNaN(value)) {
        throw new ValidationError(`${paramName} must be a valid number`);
    }
}

export function validateBoolean(value, paramName) {
    if (typeof value !== 'boolean') {
        throw new ValidationError(`${paramName} must be a boolean`);
    }
}

export function validateEnum(value, allowedValues, paramName) {
    if (!allowedValues.includes(value)) {
        throw new ValidationError(
            `${paramName} must be one of: ${allowedValues.join(', ')}`
        );
    }
}

export function validateDate(value, paramName) {
    if (!(value instanceof Date) || isNaN(value.getTime())) {
        throw new ValidationError(`${paramName} must be a valid Date object`);
    }
}
