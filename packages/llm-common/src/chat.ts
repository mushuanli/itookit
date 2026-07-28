/** A file attachment associated with a conversation message. */
export interface ChatAttachment {
    name: string;
    type: string;
    path?: string;
    size?: number;
    /** Runtime file reference; never persisted. */
    fileRef?: File | Blob;
}

/** Per-conversation UI execution preferences. */
export interface ChatSessionSettings {
    version: '1.0';
    modelId?: string;
    historyLength: number;
    temperature?: number;
    streamMode: boolean;
    updatedAt?: string;
}

export const DEFAULT_SESSION_SETTINGS: ChatSessionSettings = {
    version: '1.0',
    modelId: undefined,
    historyLength: -1,
    temperature: undefined,
    streamMode: true,
};
