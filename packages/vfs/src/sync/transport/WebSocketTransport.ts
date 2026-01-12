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

interface PendingChunkRequest {
  resolve: (data: ArrayBuffer) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type MessageType = 'pong' | 'ack' | 'error' | 'sync_packet' | 'request_chunk' | 
                   'chunk_response' | 'chunk_header' | 'chunk_ack';

interface IncomingMessage {
  type: MessageType;
  req_id?: string;
  payload?: SyncPacket;
  response?: SyncPacketResponse;
  missing_chunks?: string[];
  message?: string;
  content_hash?: string;
  index?: number;
  node_id?: string;
  total_chunks?: number;
  checksum?: string;
  size?: number;
  success?: boolean;
  error?: string;
}

export class WebSocketTransport implements NetworkInterface {
  private ws: WebSocket | null = null;
  private packetHandler?: (p: SyncPacket) => void;
  private chunkRequestHandler?: (req: ChunkRequest) => Promise<ArrayBuffer>;
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingChunkRequests = new Map<string, PendingChunkRequest>();
  private pendingChunkResponse: { reqId: string; info: IncomingMessage } | null = null;
  
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
        this.ws.binaryType = 'arraybuffer'; // 确保二进制数据以 ArrayBuffer 形式接收

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

    for (const [, pending] of this.pendingChunkRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingChunkRequests.clear();
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
        req_id: reqId,
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

    const reqId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error('Chunk upload timeout'));
      }, SYNC_CONSTANTS.DEFAULT_REQUEST_TIMEOUT);

      // 监听 chunk_ack 响应
      const originalResolve = () => {
        clearTimeout(timeout);
        this.pendingRequests.delete(reqId);
        resolve();
      };

      this.pendingRequests.set(reqId, { 
        resolve: originalResolve as any, 
        reject, 
        timeout 
      });

      // 先发送分片上传请求头
      this.ws!.send(JSON.stringify({
        type: 'chunk_upload',
        req_id: reqId,
        content_hash: header.contentHash,
        index: header.index,
        total_chunks: header.totalChunks,
        checksum: header.checksum,
        size: data.byteLength,
        node_id: header.nodeId
      }));

      // 再发送二进制数据
      this.ws!.send(data);
    });
  }

  /**
   * 请求单个分片
   */
  async requestChunk(contentHash: string, index: number, nodeId: string): Promise<ArrayBuffer> {
    if (!this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    const reqId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingChunkRequests.delete(reqId);
        reject(new Error('Chunk request timeout'));
      }, SYNC_CONSTANTS.DEFAULT_REQUEST_TIMEOUT);

      this.pendingChunkRequests.set(reqId, { resolve, reject, timeout });

      this.ws!.send(JSON.stringify({
        type: 'request_chunk',
        req_id: reqId,
        content_hash: contentHash,
        index: index,
        node_id: nodeId
      }));
    });
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
    if (event.data instanceof ArrayBuffer) {
      this.handleBinaryMessage(event.data);
      return;
    }

    if (event.data instanceof Blob) {
      const buffer = await event.data.arrayBuffer();
      this.handleBinaryMessage(buffer);
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
        if (data.req_id && data.response) {
          this.resolvePendingRequest(data.req_id, data.response);
        }
        break;

      case 'error':
        if (data.req_id) {
          const pending = this.pendingRequests.get(data.req_id);
          if (pending) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(data.message || 'Unknown error'));
            this.pendingRequests.delete(data.req_id);
          }

          const pendingChunk = this.pendingChunkRequests.get(data.req_id);
          if (pendingChunk) {
            clearTimeout(pendingChunk.timeout);
            pendingChunk.reject(new Error(data.message || 'Unknown error'));
            this.pendingChunkRequests.delete(data.req_id);
          }
        }
        break;

      case 'sync_packet':
        if (data.payload) {
          this.packetHandler?.(data.payload);
        }
        break;

      case 'request_chunk':
        // 服务器请求分片（P2P 场景或服务器需要客户端提供分片）
        if (this.chunkRequestHandler && data.content_hash && data.index !== undefined && data.node_id) {
          try {
            const buffer = await this.chunkRequestHandler({
              contentHash: data.content_hash,
              index: data.index,
              nodeId: data.node_id
            });
            await this.sendChunk(
              {
                contentHash: data.content_hash,
                index: data.index,
                nodeId: data.node_id,
                totalChunks: data.total_chunks || 1,
                checksum: '' // 服务器会验证
              },
              buffer
            );
          } catch (e) {
            console.error('[WebSocket] Failed to handle chunk request', e);
          }
        }
        break;

      case 'chunk_response':
        // 服务器响应分片请求，紧跟着会有二进制数据
        if (data.req_id) {
          this.pendingChunkResponse = { reqId: data.req_id, info: data };
        }
        break;

      case 'chunk_ack':
        // 分片上传确认
        if (data.req_id) {
          const pending = this.pendingRequests.get(data.req_id);
          if (pending) {
            clearTimeout(pending.timeout);
            if (data.success) {
              pending.resolve({ success: true } as any);
            } else {
              pending.reject(new Error(data.error || 'Chunk upload failed'));
            }
            this.pendingRequests.delete(data.req_id);
          }
        }
        break;

      default:
        console.warn('[WebSocket] Unknown message type:', data.type);
    }
  }

  private handleBinaryMessage(data: ArrayBuffer): void {
    // 检查是否有待处理的分片响应
    if (this.pendingChunkResponse) {
      const { reqId } = this.pendingChunkResponse;
      const pending = this.pendingChunkRequests.get(reqId);
      
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(data);
        this.pendingChunkRequests.delete(reqId);
      }
      
      this.pendingChunkResponse = null;
    } else {
      console.warn('[WebSocket] Received unexpected binary data');
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
