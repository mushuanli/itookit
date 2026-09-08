import type { KernelAdaptersRuntimeOptions } from '@itookit/kernel-adapters';
import type { SessionFilesService } from './session-files';

type ToolFiles = Awaited<ReturnType<SessionFilesService['acquire']>>;
type RuntimeFiles = Awaited<ReturnType<NonNullable<KernelAdaptersRuntimeOptions['fileContextForSession']>>>;

/** The platform owns process grants and stops processes before releasing files. */
export interface SessionProcessMount { sourceId: string; directory: string; at: string; access: 'ro' | 'rw'; }
export type SessionProcessFactory = (sessionId: string, files: ToolFiles, mounts: SessionProcessMount[]) => Promise<{
    nativeShell: NonNullable<RuntimeFiles['nativeShell']>;
    ttyDriver?: RuntimeFiles['ttyDriver'];
    release(): Promise<void>;
}>;

export async function acquireSessionProcessContext(
    files: Pick<SessionFilesService, 'acquire'>, sessionId: string, factory?: SessionProcessFactory,
    mounts: () => Promise<SessionProcessMount[]> = async () => [],
): Promise<RuntimeFiles> {
    const context = await files.acquire(sessionId);
    if (!factory) return context;
    let processes: Awaited<ReturnType<SessionProcessFactory>>;
    try { processes = await factory(sessionId, context, await mounts()); }
    catch (error) {
        try { await context.release(); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Session process initialization and file cleanup failed'); }
        throw error;
    }
    let release: Promise<void> | undefined;
    return { ...context, nativeShell: processes.nativeShell, ttyDriver: processes.ttyDriver,
        release: () => release ??= releaseContext(processes, context) };
}

async function releaseContext(processes: { release(): Promise<void> }, files: ToolFiles): Promise<void> {
    const errors: unknown[] = [];
    try { await processes.release(); } catch (error) { errors.push(error); }
    try { await files.release(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Session process context cleanup failed');
}
