/** Presentation port; hosts own execution, identity and authorization. */
export interface ConversationMessage {
    id: string; role: 'user' | 'assistant' | 'tool' | 'system'; text: string; status?: string;
    /** Native text array boundaries, kept separate from the plain-text preview. */
    contentParts?: string[];
    turnId?: string; name?: string; input?: string; inputLanguage?: 'bash' | 'json' | 'text';
    timestamp?: number; paths?: string[]; operation?: 'read' | 'write' | 'search' | 'list' | 'execute'; commandPreview?: string;
}
export interface ConversationRequest { id: string | number; kind: 'approval' | 'input' | 'unsupported'; detail: string; questions?: Array<{id: string; question: string; options?: Array<{label: string}>}> }
export interface ConversationSnapshot {
    active?: boolean; createdAt?: number | null; updatedAt?: number | null;
    canFork?: boolean; hasEarlier?: boolean;
    draft?: string; sessionId?: string; branchName?: string; title: string; messages: ConversationMessage[]; requests: ConversationRequest[];
    canSend: boolean; canInterrupt: boolean; canRespond: boolean; pending: boolean; disconnected: boolean; gap: boolean;
}
export interface ConversationControls {
    /** Local observation of receipts and control ownership, including while offline. */
    snapshot?(): ConversationSnapshot;
    fork?(name?: string): Promise<ConversationSnapshot>;
    branches?(): Promise<Array<{id:string; title:string; branchName?:string | null; parentSessionId?:string | null}>>;
    loadEarlier?(): Promise<ConversationSnapshot>;
    saveDraft?(text: string): Promise<void>;
    read(): Promise<ConversationSnapshot>;
    poll(): Promise<ConversationSnapshot>;
    send(text: string): Promise<ConversationSnapshot>;
    interrupt(): Promise<ConversationSnapshot>;
    respond(id: string | number, response: Record<string, unknown>): Promise<ConversationSnapshot>;
    reconcile(): Promise<ConversationSnapshot>;
    close(): Promise<void>;
}
export interface RemoteAgentControls {
    list(): Promise<Array<{id: string; name: string; icon: string; category: string; description?: string}>>;
    send(id: string, text: string): Promise<void>;
}
