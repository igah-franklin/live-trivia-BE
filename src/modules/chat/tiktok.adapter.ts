import type { Server as SocketServer } from 'socket.io';
import { SocketEvents } from '../../socket/events.js';
import type { ChatService } from './chat.service.js';

// Dynamic import to handle optional package
type WebcastPushConnection = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
};

const MAX_RECONNECT_ATTEMPTS = 3;

interface ConnectionState {
  client: WebcastPushConnection;
  username: string;
  reconnectAttempts: number;
}

export class TikTokAdapter {
  private connections = new Map<string, ConnectionState>();

  constructor(
    private readonly chatService: ChatService,
    private readonly io: SocketServer,
  ) {}

  async connect(username: string, accountId: string = 'default'): Promise<void> {
    const existing = this.connections.get(accountId);
    if (existing) {
      await this.disconnect(accountId);
    }

    await this.createConnection(username, accountId);
  }

  private async createConnection(username: string, accountId: string): Promise<void> {
    let TikTokClass: new (username: string, opts?: Record<string, unknown>) => WebcastPushConnection;

    try {
      const { WebcastPushConnection: ImportedClass } = await import('tiktok-live-connector');
      TikTokClass = ImportedClass as any;
    } catch {
      throw new Error(
        'tiktok-live-connector is not installed. Run: npm install tiktok-live-connector'
      );
    }

    const client = new TikTokClass(username, {
      processInitialData: false,
      sessionId: process.env.TIKTOK_SESSION_ID || undefined,
    });

    const state: ConnectionState = {
      client,
      username,
      reconnectAttempts: 0,
    };

    this.connections.set(accountId, state);

    client.on('chat', async (data: any) => {
      console.log(`[TikTok][${accountId}] Chat message from ${data.nickname}: ${data.comment}`);
      const comment = data as {
        uniqueId: string;
        nickname: string;
        comment: string;
      };

      await this.chatService.processMessage({
        userId: comment.uniqueId,
        username: comment.nickname,
        text: comment.comment,
        receivedAt: Date.now(),
        accountId,
      });
    });

    client.on('disconnected', async () => {
      console.warn(`[TikTok][${accountId}] Disconnected from @${username}`);
      
      const currentState = this.connections.get(accountId);
      this.emitToAccount(accountId, SocketEvents.TIKTOK_DISCONNECTED, { username });

      if (currentState && currentState.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        currentState.reconnectAttempts++;
        setTimeout(async () => {
          try {
            await this.createConnection(username, accountId);
          } catch {
            this.emitToAccount(accountId, SocketEvents.TIKTOK_ERROR, {
              message: `Reconnect attempt ${currentState.reconnectAttempts} failed for @${username}`,
            });
          }
        }, 5000);
      } else {
        this.connections.delete(accountId);
      }
    });

    client.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[TikTok][${accountId}] Error: ${message}`);
      this.emitToAccount(accountId, SocketEvents.TIKTOK_ERROR, { message });
    });

    await client.connect();
    console.log(`[TikTok][${accountId}] Successfully connected to @${username}`);
    this.emitToAccount(accountId, SocketEvents.TIKTOK_CONNECTED, { username });
  }

  async disconnect(accountId: string = 'default'): Promise<void> {
    const state = this.connections.get(accountId);
    if (!state) return;

    this.connections.delete(accountId);

    try {
      await state.client.disconnect();
    } catch {
      // Ignore disconnect errors
    }

    this.emitToAccount(accountId, SocketEvents.TIKTOK_DISCONNECTED, { username: state.username });
  }

  isConnected(accountId: string = 'default'): boolean {
    return this.connections.has(accountId);
  }

  getUsername(accountId: string = 'default'): string | null {
    return this.connections.get(accountId)?.username || null;
  }

  private emitToAccount(accountId: string, event: string, data: any) {
    const operatorRoom = `operator:${accountId}`;
    const overlayRoom = `overlay:${accountId}`;
    this.io.to(operatorRoom).emit(event, data);
    this.io.to(overlayRoom).emit(event, data);
    
    if (accountId === 'default') {
      this.io.to('operator').to('overlay').emit(event, data);
    }
  }
}
