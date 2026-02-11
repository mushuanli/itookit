// @file: llm-engine/utils/error-formatter.ts

/**
 * 格式化错误消息为用户可读文本
 */
export function formatErrorMessage(error: any): string {
    const statusCode = error.status || error.code;

    if (statusCode === 401) {
        return 'Authentication failed: Invalid API key or token expired. Please check your connection settings.';
    }
    if (statusCode === 403) {
        return 'Access denied: You do not have permission to use this API.';
    }
    if (statusCode === 429) {
        return 'Rate limit exceeded: Too many requests. Please wait and try again.';
    }
    if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
        return `Server error (${statusCode}): The LLM service is temporarily unavailable.`;
    }

    if (error.message?.includes('fetch') || error.message?.includes('network')) {
        return 'Network error: Unable to connect to the LLM service. Please check your internet connection.';
    }

    return error.message || 'An unknown error occurred';
}
