/**
 * @file vfs-ui/utils/error-detail.ts
 * @desc Expands wrapped view errors for logs.
 *
 * FileSystemView reports provider failures as "Source operation failed: <method>"
 * and keeps the original error as `cause`; logging only the wrapper hides whether
 * the fault was a missing path, a capability refusal or a real I/O error.
 */

/** Render an error and its `cause` chain as one line, e.g. `FSError: ... ← ENOENT: ...`. */
export function describeCauseChain(error: unknown, maxDepth = 5): string {
    const parts: string[] = [];
    let current: unknown = error;
    for (let depth = 0; current != null && depth < maxDepth; depth++) {
        if (current instanceof Error) {
            const code = (current as { code?: unknown }).code;
            parts.push(`${current.name}${code ? `[${String(code)}]` : ''}: ${current.message}`);
            current = (current as { cause?: unknown }).cause;
        } else {
            parts.push(String(current));
            break;
        }
    }
    return parts.join(' ← ');
}

/**
 * The innermost message in the chain: what a person can act on, without the
 * "Source operation failed: <method>" wrapper the view adds for privacy.
 */
export function describeErrorReason(error: unknown): string {
    const seen = new Set<unknown>();
    let current: unknown = error;
    let reason = '';
    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current);
        if (current instanceof Error && current.message) reason = current.message;
        current = (current as { cause?: unknown }).cause;
    }
    return reason || String(error);
}
