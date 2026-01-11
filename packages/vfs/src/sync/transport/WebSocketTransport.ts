// @file packages/vfs-sync/src/transport/WebSocketTransport.ts

import { NetworkInterface, ChunkRequest } from './NetworkInterface';
import { SyncPacket, SyncPacketResponse } from '../types';
import { SYNC_CONSTANTS } from '../constants';

export interface WebSocketConfig {
  url: string;
  heartbeatInterval?: number;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  connectionTimeout?: number;
}

interface PendingRequest {
  resolve: (resp: SyncPacketResponse) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type MessageType = 'pong' | 'ack' | 'error' | 'sync_packet' | 'request_chunk' | 'chunk_response';

interface IncomingMessage {
  type: MessageType;
  reqId?: string;
  payload?: SyncPacket;
  missingChunks?: string[];
  message?: string;
  contentHash?: string;
  index?: number;
  nodeId?: string;
}

export class WebSocketTransport implements NetworkInterface {
  private ws: WebSocket | null = null;
  private packetHandler?: (p: SyncPacket) => void;
  private chunkRequestHandler?: (req: ChunkRequest) => Promise<ArrayBuffer>;
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingChunkReqId: string | null = null;
  
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private isConnecting = false;

  private readonly config: Required<WebSocketConfig>;

  constructor(config: WebSocketConfig) {
    this.config = {
      url: config.url,
      heartbeatInterval: config.heartbeatInterval ?? 30000,
      reconnectDelay: config.reconnectDelay ?? 5000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      connectionTimeout: config.connectionTimeout ?? 10000
    };
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
      }, this.config.connectionTimeout);

      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = () => {
          clearTimeout(timeoutId);
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        };

        this.ws.onerror = () => {
          clearTimeout(timeoutId);
          this.isConnecting = false;
          reject(new Error('WebSocket connection error'));
        };

        this.ws.onclose = (event) => {
          this.stopHeartbeat();
          this.handleClose(event);
        };

        this.ws.onmessage = (event) => this.handleMessage(event);

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
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
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
      }, SYNC_CONSTANTS.DEFAULT_REQUEST_TIMEOUT);

      this.pendingRequests.set(reqId, { resolve, reject, timeout });

      this.ws!.send(JSON.stringify({
        type: 'sync_packet',
        reqId,
        payload: packet
      }));
    });
  }

  async sendChunk(
    header: ChunkRequest & { totalChunks: number; checksum: string },
    data: ArrayBuffer
  ): Promise<void> {
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

  onChunkRequest(handler: (req: ChunkRequest) => Promise<ArrayBuffer>): void {
    this.chunkRequestHandler = handler;
  }

  // ==================== 私有方法 ====================

  private handleClose(event: CloseEvent): void {
    console.log(`[WebSocket] Connection closed: ${event.code} ${event.reason}`);

    if (!this.intentionalClose) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnect attempts reached');
      return;
    }

    // 指数退避 + 随机抖动
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    const jitter = Math.random() * 1000;

    console.log(`[WebSocket] Reconnecting in ${Math.round(delay + jitter)}ms (attempt ${this.reconnectAttempts + 1})`);

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
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    // 处理二进制数据
    if (event.data instanceof Blob) {
      const buffer = await event.data.arrayBuffer();
      this.handleBinaryMessage(buffer);
      return;
    }

    if (event.data instanceof ArrayBuffer) {
      this.handleBinaryMessage(event.data);
      return;
    }

    // 处理 JSON 消息
    try {
      const data = JSON.parse(event.data) as IncomingMessage;
      await this.handleJsonMessage(data);
    } catch (e) {
      console.error('[WebSocket] Failed to parse message', e);
    }
  }

  private async handleJsonMessage(data: IncomingMessage): Promise<void> {
    switch (data.type) {
      case 'pong':
        // 心跳响应，可用于延迟计算
        break;

      case 'ack':
        this.resolvePendingRequest(data.reqId!, {
          success: true,
          missingChunks: data.missingChunks
        });
        break;

      case 'error':
        this.resolvePendingRequest(data.reqId!, {
          success: false,
          error: data.message
        });
        break;

      case 'sync_packet':
        if (data.payload) {
          this.packetHandler?.(data.payload);
        }
        break;

      case 'request_chunk':
        if (this.chunkRequestHandler && data.contentHash && data.index !== undefined && data.nodeId) {
          const buffer = await this.chunkRequestHandler({
            contentHash: data.contentHash,
            index: data.index,
            nodeId: data.nodeId
          });
          await this.sendChunk(
            {
              contentHash: data.contentHash,
              index: data.index,
              nodeId: data.nodeId,
              totalChunks: 0,
              checksum: ''
            },
            buffer
          );
        }
        break;

      case 'chunk_response':
        // 存储 reqId 以匹配后续的二进制帧
        this.pendingChunkReqId = data.reqId || null;
        break;

      default:
        console.warn('[WebSocket] Unknown message type:', data.type);
    }
  }

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
}
