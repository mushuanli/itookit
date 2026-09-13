import { t } from '@itookit/common';
import { DirectorySourceUnavailableError, SessionUnfinishedTasksError } from '@itookit/app-core';

/**
 * Map platform-agnostic mount errors to localized copy.
 *
 * `@itookit/app-core` raises structured errors and owns no user-facing text (see its
 * AGENTS.md); the host decides how to phrase them. Unknown errors pass through unchanged
 * so their message is not swallowed.
 */
export function localizeMountError(error: unknown): unknown {
    if (error instanceof SessionUnfinishedTasksError) return new Error(t('error.sessionUnfinishedTasks'));
    if (error instanceof DirectorySourceUnavailableError) return new Error(t('error.directorySourceUnavailable'));
    return error;
}
