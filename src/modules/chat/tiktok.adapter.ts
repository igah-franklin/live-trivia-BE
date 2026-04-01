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

export class TikTokAdapter {
  private client: WebcastPushConnection | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private currentUsername: string | null = null;

  constructor(
    private readonly chatService: ChatService,
    private readonly io: SocketServer,
  ) {}

  async connect(username: string): Promise<void> {
    if (this.connected) {
      await this.disconnect();
    }

    this.currentUsername = username;
    this.reconnectAttempts = 0;

    await this.createConnection(username);
  }

  private async createConnection(username: string): Promise<void> {
    let TikTokClass: new (username: string, opts?: Record<string, unknown>) => WebcastPushConnection;

    try {
      // Dynamic import for ESM compatibility
      const { WebcastPushConnection: ImportedClass } = await import('tiktok-live-connector');
      TikTokClass = ImportedClass as any;
    } catch {
      throw new Error(
        'tiktok-live-connector is not installed. Run: npm install tiktok-live-connector'
      );
    }

    this.client = new TikTokClass(username, {
      processInitialData: false,
      sessionId: process.env.TIKTOK_SESSION_ID || undefined,
    });

    this.client.on('chat', async (data: any) => {
      console.log(`[TikTok] Chat message from ${data.nickname}: ${data.comment}`);
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
      });
    });

    this.client.on('disconnected', async () => {
      console.warn(`[TikTok] Disconnected from @${username}`);
      this.connected = false;
      this.io.emit(SocketEvents.TIKTOK_DISCONNECTED, { username });

      // Attempt reconnect up to MAX_RECONNECT_ATTEMPTS
      if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS && this.currentUsername) {
        this.reconnectAttempts++;
        setTimeout(async () => {
          try {
            await this.createConnection(this.currentUsername!);
          } catch {
            this.io.emit(SocketEvents.TIKTOK_ERROR, {
              message: `Reconnect attempt ${this.reconnectAttempts} failed`,
            });
          }
        }, 5000);
      }
    });

    this.client.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[TikTok] Error: ${message}`);
      this.io.emit(SocketEvents.TIKTOK_ERROR, { message });
    });

    await this.client.connect();
    this.connected = true;
    console.log(`[TikTok] Successfully connected to @${username}`);
    this.io.emit(SocketEvents.TIKTOK_CONNECTED, { username });
  }

  async disconnect(): Promise<void> {
    this.currentUsername = null;
    this.reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect

    if (this.client) {
      try {
        await this.client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.client = null;
    }

    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
