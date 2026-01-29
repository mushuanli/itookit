export type RestoreStatus = 'missing' | 'modified' | 'ok';

export interface RestorableItem {
    id: string;
    type: 'connection' | 'agent';
    name: string;
    description?: string;
    icon?: string;
    status: RestoreStatus;
}

