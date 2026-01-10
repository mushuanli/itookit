// @file packages/vfs-sync/src/transport/WebSocketTransport.ts

import { NetworkInterface } from './NetworkInterface';
import { SyncPacket } from '../types';

/**
 * 同步包响应
 */
export interface SyncPacketResponse {
  success: boolean;
  missingChunks?: string[];
  chunkData?: ArrayBuffer;
  error?: string;
}

export interface WebSocketConfig {
  url: string;
  heartbeatInterval?: number;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  connectionTimeout?: number;
}

export class WebSocketTransport implements NetworkInterface {
  private ws: WebSocket | null = null;
  private packetHandler?: (p: SyncPacket) => void;
  private chunkRequestHandler?: (req: any) => Promise<ArrayBuffer>;
  private pendingRequests = new Map<string, { 
    resolve: (resp: SyncPacketResponse) => void; 
    reject: (err: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  
  private heartbeatTimer: any = null;
  private reconnectTimer: any = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private isConnecting = false;

  private readonly heartbeatInterval: number;
  private readonly reconnectDelay: number;
  private readonly maxReconnectAttempts: number;
  private readonly connectionTimeout: number;
  private readonly requestTimeout = 30000;

  constructor(private config: WebSocketConfig) {
    this.heartbeatInterval = config.heartbeatInterval ?? 30000;
    this.reconnectDelay = config.reconnectDelay ?? 5000;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    this.connectionTimeout = config.connectionTimeout ?? 10000;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.isConnected || this.isConnecting) return;
    
    this.intentionalClose = false;
    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.isConnecting = false;
        reject(new Error('Connection timeout'));
      }, this.connectionTimeout);

      try {
        this.ws = new WebSocket(this.config.url);
        
        this.ws.onopen = () => {
          clearTimeout(timeoutId);
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        };

        this.ws.onerror = (_e) => {
          clearTimeout(timeoutId);
          this.isConnecting = false;
          reject(new Error('WebSocket error'));
        };

        this.ws.onclose = (event) => {
          this.stopHeartbeat();
          this.handleClose(event);
        };

        this.ws.onmessage = async (event) => {
          await this.handleMessage(event);
        };

      } catch (e) {
        clearTimeout(timeoutId);
        this.isConnecting = false;
        reject(e);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.stopHeartbeat();
    this.stopReconnect();
    
    if (this.ws) {
      this.ws.close(1000, 'Normal closure');
      this.ws = null;
    }

    // 拒绝所有待处理请求
    for (const [_reqId, { reject }] of this.pendingRequests) {
      reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
  }

  private handleClose(event: CloseEvent): void {
    console.log(`[WebSocket] Connection closed: ${event.code} ${event.reason}`);
    
    if (!this.intentionalClose) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnect attempts reached');
      return;
    }

    // 指数退避
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    const jitter = Math.random() * 1000;
    
    console.log(`[WebSocket] Reconnecting in ${delay + jitter}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect();
        console.log('[WebSocket] Reconnected successfully');
      } catch (e) {
        console.error('[WebSocket] Reconnect failed', e);
        this.scheduleReconnect();
      }
    }, delay + jitter);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.ws!.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    // 处理二进制数据（分片响应）
    if (event.data instanceof Blob) {
      const arrayBuffer = await event.data.arrayBuffer();
      this.handleBinaryMessage(arrayBuffer);
      return;
    }
    
    if (event.data instanceof ArrayBuffer) {
      this.handleBinaryMessage(event.data);
      return;
    }

    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'pong':
          // 心跳响应，可以用来计算延迟
          break;

        case 'ack':
          this.resolvePendingRequest(data.reqId, {
            success: true,
            missingChunks: data.missingChunks
          });
          break;

        case 'error':
          this.resolvePendingRequest(data.reqId, {
            success: false,
            error: data.message
          });
          break;

        case 'sync_packet':
          this.packetHandler?.(data.payload);
          break;

        case 'request_chunk':
          if (this.chunkRequestHandler) {
            const buffer = await this.chunkRequestHandler(data);
            await this.sendChunk(data, buffer);
          }
          break;

        case 'chunk_response':
          // 分片数据响应的元信息，实际数据通过二进制帧传输
          // 存储 reqId 以便匹配后续的二进制帧
          this.pendingChunkReqId = data.reqId;
          break;

        default:
          console.warn('[WebSocket] Unknown message type:', data.type);
      }
    } catch (e) {
      console.error('[WebSocket] Failed to parse message', e);
    }
  }

  private pendingChunkReqId: string | null = null;

  /**
   * 处理二进制消息（分片数据）
   */
  private handleBinaryMessage(data: ArrayBuffer): void {
    if (this.pendingChunkReqId) {
      this.resolvePendingRequest(this.pendingChunkReqId, {
        success: true,
        chunkData: data
      });
      this.pendingChunkReqId = null;
    }
  }

  /**
   * 解决待处理的请求
   */
  private resolvePendingRequest(reqId: string, response: SyncPacketResponse): void {
    const pending = this.pendingRequests.get(reqId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(response);
      this.pendingRequests.delete(reqId);
    }
  }

  async sendPacket(packet: SyncPacket): Promise<SyncPacketResponse> {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    const reqId = packet.packetId || crypto.randomUUID();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error('Request timeout'));
      }, this.requestTimeout);

      this.pendingRequests.set(reqId, { resolve, reject, timeout });

      this.ws!.send(JSON.stringify({
        type: 'sync_packet',
        reqId,
        payload: packet
      }));
    });
  }

  async sendChunk(header: any, data: ArrayBuffer): Promise<void> {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    // 先发送元数据头
    this.ws!.send(JSON.stringify({ 
      type: 'chunk_header', 
      ...header,
      size: data.byteLength 
    }));
    
    // 再发送二进制数据
    this.ws!.send(data);
  }

  onPacket(handler: (packet: SyncPacket) => void): void {
    this.packetHandler = handler;
  }

  onChunkRequest(handler: (req: any) => Promise<ArrayBuffer>): void {
    this.chunkRequestHandler = handler;
  }
}
