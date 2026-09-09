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
