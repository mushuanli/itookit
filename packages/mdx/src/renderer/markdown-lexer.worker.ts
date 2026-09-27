import { Marked } from 'marked';
import { lexicalExtension, type WorkerSyntax } from './worker-tokenizers';

self.onmessage = (event: MessageEvent<{ text: string; syntax: WorkerSyntax[]; options: Record<string, boolean> }>) => {
    try {
        const marked = new Marked(...event.data.syntax.map(lexicalExtension));
        const tokens = marked.lexer(event.data.text, { ...marked.defaults, ...event.data.options });
        self.postMessage({ tokens });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
};
