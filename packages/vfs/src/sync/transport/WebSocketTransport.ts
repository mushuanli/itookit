// @file packages/vfs-sync/src/transport/WebSocketTransport.ts

import { NetworkInterface } from './NetworkInterface';
import { SyncPacket } from '../types';

export class WebSocketTransport implements NetworkInterface {
  private ws: WebSocket | null = null;
  private packetHandler?: (p: SyncPacket) => void;
  private chunkRequestHandler?: (req: any) => Promise<ArrayBuffer>;
  private pendingRequests = new Map<string, (resp: any) => void>();

  constructor(private url: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      
      this.ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'ack') {
          const resolver = this.pendingRequests.get(data.reqId);
          if (resolver) resolver(data);
        } else if (data.type === 'sync_packet') {
          this.packetHandler?.(data.payload);
        } else if (data.type === 'request_chunk') {
          // 处理服务器请求分片数据
          if (this.chunkRequestHandler) {
            const buffer = await this.chunkRequestHandler(data);
            this.sendChunk(data, buffer);
          }
        }
      };
    });
  }

  async disconnect(): Promise<void> {
    this.ws?.close();
  }

  async sendPacket(packet: SyncPacket): Promise<{ success: boolean; missingChunks?: string[] }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const reqId = crypto.randomUUID();
    return new Promise((resolve) => {
      this.pendingRequests.set(reqId, resolve);
      this.ws!.send(JSON.stringify({
        type: 'sync_packet',
        reqId,
        payload: packet
      }));
    });
  }

  async sendChunk(header: any, data: ArrayBuffer): Promise<void> {
    // 实际实现应发送二进制帧，这里简化为混合协议或专用通道
    // 在真实 WS 中，可以先发一个 JSON Header，紧接着发 Binary Frame
    this.ws!.send(JSON.stringify({ type: 'chunk_header', ...header }));
    this.ws!.send(data);
  }

  onPacket(handler: (packet: SyncPacket) => void): void {
    this.packetHandler = handler;
  }
  
  onChunkRequest(handler: (req: any) => Promise<ArrayBuffer>): void {
    this.chunkRequestHandler = handler;
  }
}
