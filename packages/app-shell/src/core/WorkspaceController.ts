/** Workspace routing uses resource identities; each workspace defines their meaning. */
export interface WorkspaceController {
    start(): Promise<void>;
    openResource(id: string): Promise<void>;
    createResource(options?: { title?: string; content?: string; parentPath?: string | null }): Promise<string>;
    getActiveResourceId(): string | null;
    setWaitingInput(id: string, waiting: boolean): void;
    destroy(): void | Promise<void>;
}
