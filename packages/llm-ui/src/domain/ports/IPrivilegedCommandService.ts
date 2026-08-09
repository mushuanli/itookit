export interface PlanCommandRequest {
    sessionId: string;
    agentId: string;
    goal: string;
}

export interface ExecCommandRequest {
    sessionId: string;
    command: string;
}

/** Application port for durable privileged commands. */
export interface IPrivilegedCommandService {
    plan(request: PlanCommandRequest): Promise<string>;
    exec(request: ExecCommandRequest): Promise<string>;
}
