// #configManager/utils/errors.js

/**
 * @fileoverview 自定义错误类
 */

export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}

export class NotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NotFoundError';
    }
}

export class ConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConflictError';
    }
}

export class TransactionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TransactionError';
    }
}
