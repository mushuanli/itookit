// @file: llm-kernel/src/utils/validators.ts

import { ExecutorConfig } from '../core/interfaces';
import { ExecutorType } from '../core/types';

/**
 * 验证结果
 */
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export interface ValidationError {
    path: string;
    message: string;
    code: string;
}

export interface ValidationWarning {
    path: string;
    message: string;
    code: string;
}

/**
 * 验证执行器配置
 */
export function validateExecutorConfig(config: ExecutorConfig): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    
    // 基础字段验证
    if (!config.id) {
        errors.push({
            path: 'id',
            message: 'Executor ID is required',
            code: 'MISSING_ID'
        });
    } else if (!/^[a-zA-Z0-9_-]+$/.test(config.id)) {
        errors.push({
            path: 'id',
            message: 'Executor ID contains invalid characters',
            code: 'INVALID_ID'
        });
    }
    
    if (!config.name) {
        warnings.push({
            path: 'name',
            message: 'Executor name is recommended',
            code: 'MISSING_NAME'
        });
    }
    
    if (!config.type) {
        errors.push({
            path: 'type',
            message: 'Executor type is required',
            code: 'MISSING_TYPE'
        });
    } else if (!isValidExecutorType(config.type)) {
        errors.push({
            path: 'type',
            message: `Invalid executor type: ${config.type}`,
            code: 'INVALID_TYPE'
        });
    }
    
    // 约束验证
    if (config.constraints) {
        if (config.constraints.timeout !== undefined && config.constraints.timeout <= 0) {
            errors.push({
                path: 'constraints.timeout',
                message: 'Timeout must be positive',
                code: 'INVALID_TIMEOUT'
            });
        }
        
        if (config.constraints.maxRetries !== undefined && config.constraints.maxRetries < 0) {
            errors.push({
                path: 'constraints.maxRetries',
                message: 'Max retries cannot be negative',
                code: 'INVALID_MAX_RETRIES'
            });
        }
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * 检查是否为有效的执行器类型
 */
export function isValidExecutorType(type: string): type is ExecutorType {
    const validTypes: string[] = ['agent', 'http', 'tool', 'script'];
    return validTypes.includes(type);
}

/**
 * 验证输入值
 */
export function validateInput(
    input: unknown,
    schema?: Record<string, any>
): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    
    if (input === null || input === undefined) {
        if (schema?.required) {
            errors.push({
                path: '',
                message: 'Input is required',
                code: 'REQUIRED'
            });
        }
        return { valid: errors.length === 0, errors, warnings };
    }
    
    if (!schema) {
        return { valid: true, errors: [], warnings: [] };
    }
    
    // 类型验证
    if (schema.type) {
        const actualType = Array.isArray(input) ? 'array' : typeof input;
        
        if (schema.type !== actualType && schema.type !== 'any') {
            errors.push({
                path: '',
                message: `Expected ${schema.type}, got ${actualType}`,
                code: 'TYPE_MISMATCH'
            });
        }
    }
    
    // 字符串验证
    if (typeof input === 'string') {
        if (schema.minLength !== undefined && input.length < schema.minLength) {
            errors.push({
                path: '',
                message: `String length must be at least ${schema.minLength}`,
                code: 'MIN_LENGTH'
            });
        }
        
        if (schema.maxLength !== undefined && input.length > schema.maxLength) {
            errors.push({
                path: '',
                message: `String length must be at most ${schema.maxLength}`,
                code: 'MAX_LENGTH'
            });
        }
        
        if (schema.pattern) {
            const regex = new RegExp(schema.pattern);
            if (!regex.test(input)) {
                errors.push({
                    path: '',
                    message: `String does not match pattern: ${schema.pattern}`,
                    code: 'PATTERN_MISMATCH'
                });
            }
        }
    }
    
    // 数字验证
    if (typeof input === 'number') {
        if (schema.minimum !== undefined && input < schema.minimum) {
            errors.push({
                path: '',
                message: `Value must be at least ${schema.minimum}`,
                code: 'MINIMUM'
            });
        }
        
        if (schema.maximum !== undefined && input > schema.maximum) {
            errors.push({
                path: '',
                message: `Value must be at most ${schema.maximum}`,
                code: 'MAXIMUM'
            });
        }
    }
    
    // 数组验证
    if (Array.isArray(input)) {
        if (schema.minItems !== undefined && input.length < schema.minItems) {
            errors.push({
                path: '',
                message: `Array must have at least ${schema.minItems} items`,
                code: 'MIN_ITEMS'
            });
        }
        
        if (schema.maxItems !== undefined && input.length > schema.maxItems) {
            errors.push({
                path: '',
                message: `Array must have at most ${schema.maxItems} items`,
                code: 'MAX_ITEMS'
            });
        }
        
        // 验证数组项
        if (schema.items) {
            input.forEach((item, index) => {
                const itemResult = validateInput(item, schema.items);
                for (const error of itemResult.errors) {
                    errors.push({
                        ...error,
                        path: `[${index}]${error.path ? '.' + error.path : ''}`
                    });
                }
            });
        }
    }
    
    // 对象验证
    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
        const obj = input as Record<string, any>;
        
        // 必填属性验证
        if (schema.required && Array.isArray(schema.required)) {
            for (const field of schema.required) {
                if (obj[field] === undefined) {
                    errors.push({
                        path: field,
                        message: `Field '${field}' is required`,
                        code: 'REQUIRED_FIELD'
                    });
                }
            }
        }
        
        // 属性验证
        if (schema.properties) {
            for (const [key, value] of Object.entries(obj)) {
                const propSchema = schema.properties[key];
                if (propSchema) {
                    const propResult = validateInput(value, propSchema);
                    for (const error of propResult.errors) {
                        errors.push({
                            ...error,
                            path: `${key}${error.path ? '.' + error.path : ''}`
                        });
                    }
                } else if (schema.additionalProperties === false) {
                    warnings.push({
                        path: key,
                        message: `Unknown property: ${key}`,
                        code: 'UNKNOWN_PROPERTY'
                    });
                }
            }
        }
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * 验证 URL
 */
export function isValidURL(url: string): boolean {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * 验证 JSON 字符串
 */
export function isValidJSON(str: string): boolean {
    try {
        JSON.parse(str);
        return true;
    } catch {
        return false;
    }
}

/**
 * 验证表达式语法（简单检查）
 */
export function isValidExpression(expr: string): boolean {
    if (!expr || typeof expr !== 'string') {
        return false;
    }
    
    // 检查括号匹配
    let depth = 0;
    for (const char of expr) {
        if (char === '(' || char === '[' || char === '{') depth++;
        if (char === ')' || char === ']' || char === '}') depth--;
        if (depth < 0) return false;
    }
    
    return depth === 0;
}

/**
 * 创建验证器链
 */
export class ValidatorChain {
    private validators: Array<(input: unknown) => ValidationResult> = [];
    
    add(validator: (input: unknown) => ValidationResult): ValidatorChain {
        this.validators.push(validator);
        return this;
    }
    
    addRequired(): ValidatorChain {
        return this.add((input) => {
            if (input === null || input === undefined) {
                return {
                    valid: false,
                    errors: [{ path: '', message: 'Value is required', code: 'REQUIRED' }],
                    warnings: []
                };
            }
            return { valid: true, errors: [], warnings: [] };
        });
    }
    
    addType(type: string): ValidatorChain {
        return this.add((input) => {
            const actualType = Array.isArray(input) ? 'array' : typeof input;
            if (actualType !== type) {
                return {
                    valid: false,
                    errors: [{ path: '', message: `Expected ${type}, got ${actualType}`, code: 'TYPE_MISMATCH' }],
                    warnings: []
                };
            }
            return { valid: true, errors: [], warnings: [] };
        });
    }
    
    addCustom(fn: (input: unknown) => boolean, message: string, code: string): ValidatorChain {
        return this.add((input) => {
            if (!fn(input)) {
                return {
                    valid: false,
                    errors: [{ path: '', message, code }],
                    warnings: []
                };
            }
            return { valid: true, errors: [], warnings: [] };
        });
    }
    
    validate(input: unknown): ValidationResult {
        const allErrors: ValidationError[] = [];
        const allWarnings: ValidationWarning[] = [];
        
        for (const validator of this.validators) {
            const result = validator(input);
            allErrors.push(...result.errors);
            allWarnings.push(...result.warnings);
            
            // 如果有错误，可以选择提前终止
            if (result.errors.length > 0) {
                break;
            }
        }
        
        return {
            valid: allErrors.length === 0,
            errors: allErrors,
            warnings: allWarnings
        };
    }
}

/**
 * 创建验证器链的便捷函数
 */
export function createValidator(): ValidatorChain {
    return new ValidatorChain();
}
