interface DocumentLink { path: string; anchor?: string }

/** Resolve raw Markdown hrefs against the live document path, never the application's URL. */
export function resolveDocumentLink(href: string, source: string): DocumentLink | undefined {
    const value = href.trim();
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|@asset\/)/i.test(value)) return;
    const [address, ...fragment] = value.split('#');
    const relative = decodeURIComponent(address!.split('?')[0]!);
    const segments = relative.startsWith('/') ? [] : source.split('/').slice(0, -1).filter(Boolean);
    if (!relative) return { path: source, anchor: fragment.length ? decodeURIComponent(fragment.join('#')) : undefined };
    for (const segment of relative.split('/')) {
        if (segment === '..') segments.pop();
        else if (segment && segment !== '.') segments.push(segment);
    }
    return { path: '/' + segments.join('/'), anchor: fragment.length ? decodeURIComponent(fragment.join('#')) : undefined };
}

export function bindDocumentLinks(container: HTMLElement, source: () => string | undefined,
    open: (path: string, anchor?: string) => Promise<void>, anchor: (id: string) => Promise<void>): () => void {
    const click = (event: MouseEvent) => {
        const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
        if (event.defaultPrevented || event.button !== 0 || !link || !container.contains(link) || link.hasAttribute('download') || link.hasAttribute('data-mdx-uri')) return;
        const path = source(); if (!path) return;
        let target: DocumentLink | undefined;
        try { target = resolveDocumentLink(link.getAttribute('href')!, path); }
        catch { event.preventDefault(); return; }
        if (!target) return;
        event.preventDefault();
        const work = target.path === path && target.anchor ? anchor(target.anchor) : open(target.path, target.anchor);
        void work.catch(error => alert(error instanceof Error ? error.message : String(error)));
    };
    container.addEventListener('click', click);
    return () => container.removeEventListener('click', click);
}
