// @file: harness/src/domain/errors.ts
// Harness 统一错误契约：可机器判别的错误码，供上层按 code 分支处理。

export enum HarnessErrorCode {
    SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
    TASK_NOT_FOUND = 'TASK_NOT_FOUND',
    BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
    BUDGET_INVALID = 'BUDGET_INVALID',
    STALE_EFFECT_CLAIM = 'STALE_EFFECT_CLAIM',
    HANDLE_LACKS_RIGHT = 'HANDLE_LACKS_RIGHT',
    HANDLE_REVOKED = 'HANDLE_REVOKED',
    EFFECT_TIMEOUT = 'EFFECT_TIMEOUT',
    EFFECT_CANCELLED = 'EFFECT_CANCELLED',
    INVALID_SPEC = 'INVALID_SPEC',
    CONFLICT = 'CONFLICT',
}

export class HarnessError extends Error {
    readonly code: HarnessErrorCode;

    constructor(code: HarnessErrorCode, message: string) {
        super(message);
        this.name = 'HarnessError';
        this.code = code;
    }
}

export function harnessError(code: HarnessErrorCode, message: string): HarnessError {
    return new HarnessError(code, message);
}
