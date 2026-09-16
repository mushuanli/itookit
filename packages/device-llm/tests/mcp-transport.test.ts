import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { MCPServerConnection } from '../src/skills/mcp-client';
import { parseMcpArgs } from '../src/device/mcp-manager';

let server: Server | undefined, client: MCPServerConnection | undefined;
afterEach(async () => { await client?.disconnect(); server?.closeAllConnections(); await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); });

it('Streamable HTTP negotiates a Session, lists all pages and preserves structured tool results', async () => {
    const seen: Array<{ method: string; headers: Record<string, unknown> }> = [];
    server = createServer((request, response) => {
        if (request.method !== 'POST') { response.writeHead(request.method === 'DELETE' ? 204 : 405); response.end(); return; }
        let body = ''; request.on('data', data => { body += data; });
        request.on('end', () => {
            const message = JSON.parse(body); seen.push({ method: message.method, headers: request.headers });
            if (message.id === undefined) { response.writeHead(202); response.end(); return; }
            const result = message.method === 'initialize' ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } }
                : message.method === 'tools/list' ? { tools: [{ name: message.params.cursor ? 'second' : 'first', inputSchema: { type: 'object' } }], ...(message.params.cursor ? {} : { nextCursor: 'next' }) }
                : { content: [{ type: 'text', text: 'answer' }], structuredContent: { score: 9 } };
            response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'test-session' });
            response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
        });
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
    client = new MCPServerConnection({ name: 'test', transport: 'http', url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: 'Bearer test' } });
    await client.connect(); expect((await client.listTools()).map(tool => tool.name)).toEqual(['first', 'second']);
    expect(await client.callTool('first', {})).toMatchObject({ structuredContent: { score: 9 } });
    expect(seen.find(item => item.method === 'tools/call')?.headers).toMatchObject({ authorization: 'Bearer test', 'mcp-session-id': 'test-session' });
    const abort = new AbortController(); abort.abort();
    await expect(client.callTool('first', {}, { signal: abort.signal })).rejects.toThrow();
});

it('preserves quoted and JSON argument vectors without invoking a shell', () => {
    expect(parseMcpArgs('["server file.mjs","--option"]')).toEqual(['server file.mjs', '--option']);
    expect(parseMcpArgs('"server file.mjs" --option')).toEqual(['server file.mjs', '--option']);
    expect(() => parseMcpArgs('[1]')).toThrow();
});
