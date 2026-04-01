import { initApp } from '@itookit/app-shell';
import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { WORKSPACES } from './config/modules';

import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import '@itookit/memory-manager/style.css';
import '@itookit/llm-ui/style.css';
import '@itookit/app-settings/style.css';
import './styles/index.css';

initApp({
    backend: new IndexedDBBackend({ dbName: 'MindOS-v3' }),
    workspaces: WORKSPACES,
    defaultSlug: 'chat',
    routeAliases: { home: 'llm-workspace' },
}).catch(err => console.error('[Bootstrap] Fatal:', err));
