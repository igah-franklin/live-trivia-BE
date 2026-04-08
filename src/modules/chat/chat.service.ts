import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Server as SocketServer } from 'socket.io';
import { parseAnswer } from '../../lib/answer.parser.js';
import { RedisKeys } from '../../lib/redis.keys.js';
import { SocketEvents } from '../../socket/events.js';
import { AnswersService } from '../answers/answers.service.js';
import type { ActiveRoundState, ChatMessage, OptionKey } from '../../types/index.js';
import { randomUUID } from 'crypto';

const FAKE_USERNAMES = [
  'quizking99', 'fastfingers', 'ngscholar', 'triviaboss', 'smartalex',
  'lagosboy', 'naijavibes', 'coolgirl22', 'reader99', 'knowitall',
  'akugirl', 'wazobiafan', 'quizpro', 'easywin', 'brainiac1',
  'nightowl', 'cityslicker', 'topgee', 'abujachamp', 'naijapride',
  'deltakid', 'ibadanboy', 'phcitygirl', 'enyimba99',
  'kanogenius', 'abujaelite', 'lasgidi', 'naijascholar', 'rapidfire', 'zingmaster',
];

const IRRELEVANT_MESSAGES = [
  'lol this is hard', 'when does the stream end?', 'hello everyone!',
  'first time here 👋', 'haha nice one', 'love this game!', 'gg',
  'can someone help me?', 'wooow', '🔥🔥🔥', 'let\'s go!', 'first!',
];

export class ChatService {
  private readonly answersService: AnswersService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly io: SocketServer,
  ) {
    this.answersService = new AnswersService(prisma, redis, io);
  }

  /**
   * Shared pipeline for both TikTok and simulator messages.
   */
   async processMessage(input: {
    userId: string;
    username: string;
    text: string;
    receivedAt: number;
    accountId?: string;
  }): Promise<ChatMessage> {
    const { userId, username, text, receivedAt, accountId = 'default' } = input;

    // Get current round state
    const activeKey = accountId === 'default' ? RedisKeys.ROUND_ACTIVE : `${RedisKeys.ROUND_ACTIVE}:${accountId}`;
    const rawState = await this.redis.get(activeKey);
    const state: ActiveRoundState | null = rawState ? JSON.parse(rawState) : null;
    const isRoundLive = state?.status === 'live';

    // Parse answer
    const parsedAnswer = parseAnswer(text);
    const msgId = randomUUID();

    let isValid = false;
    let isDuplicate = false;

    if (parsedAnswer && isRoundLive && state) {
      const result = await this.answersService.processAnswer({
        roundId: state.id,
        userPlatformId: userId,
        username,
        selectedOption: parsedAnswer,
        accountId, // Pass it down!
      });

      isValid = result.recorded;
      isDuplicate = result.isDuplicate;
    }

    const chatMessage: ChatMessage = {
      id: msgId,
      userId,
      username,
      text,
      parsedAnswer,
      isValid,
      isDuplicate,
      receivedAt,
    };

    // Push to Redis recent list (LPUSH + LTRIM — O(1))
    const serialized = JSON.stringify(chatMessage);
    const recentKey = accountId === 'default' ? RedisKeys.CHAT_RECENT : `${RedisKeys.CHAT_RECENT}:${accountId}`;
    await this.redis.lpush(recentKey, serialized);
    await this.redis.ltrim(recentKey, 0, 99);

    // Emit to operator room (all messages)
    const operatorRoom = `operator:${accountId}`;
    const overlayRoom = `overlay:${accountId}`;
    
    this.io.to(operatorRoom).emit(SocketEvents.CHAT_MESSAGE, chatMessage);
    if (accountId === 'default') {
      this.io.to('operator').emit(SocketEvents.CHAT_MESSAGE, chatMessage);
    }

    // Emit to overlay room (valid answers only)
    if (isValid) {
      this.io.to(overlayRoom).emit(SocketEvents.CHAT_MESSAGE, {
        ...chatMessage,
      });
      if (accountId === 'default') {
        this.io.to('overlay').emit(SocketEvents.CHAT_MESSAGE, chatMessage);
      }
    }

    return chatMessage;
  }

  async getRecentMessages(accountId: string = 'default'): Promise<ChatMessage[]> {
    const recentKey = accountId === 'default' ? RedisKeys.CHAT_RECENT : `${RedisKeys.CHAT_RECENT}:${accountId}`;
    const raw = await this.redis.lrange(recentKey, 0, 99);
    return raw.map(r => JSON.parse(r) as ChatMessage);
  }
}

// ─── Chat Simulator ──────────────────────────────────────────────────────────

export class ChatSimulator {
  private timeout: NodeJS.Timeout | null = null;
  private answeredUsers = new Set<string>();
  private running = false;

  constructor(private readonly chatService: ChatService) {}

  start(intervalMs = 800): void {
    if (this.running) return;
    this.running = true;
    this.answeredUsers = new Set();
    this.scheduleNext(intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  resetAnsweredUsers(): void {
    this.answeredUsers = new Set();
  }

  private scheduleNext(intervalMs: number): void {
    if (!this.running) return;

    // Randomize delay: intervalMs * (0.5 + random) to avoid mechanical regularity
    const delay = intervalMs * (0.5 + Math.random());

    this.timeout = setTimeout(async () => {
      try {
        await this.inject();
      } finally {
        this.scheduleNext(intervalMs);
      }
    }, delay);
  }

  private async inject(): Promise<void> {
    if (!this.running) return;

    // Get current round state to know correct option
    const { chatService } = this;
    const redis = (chatService as unknown as { redis: import('ioredis').Redis }).redis;
    const rawState = await redis.get(RedisKeys.ROUND_ACTIVE);
    if (!rawState) return;

    const state: ActiveRoundState = JSON.parse(rawState);
    if (state.status !== 'live') return;

    // Pick a random username; prefer unanswered users
    const available = FAKE_USERNAMES.filter(u => !this.answeredUsers.has(u));
    const pool = available.length > 0 ? available : FAKE_USERNAMES;
    const username = pool[Math.floor(Math.random() * pool.length)];
    const userId = username; // username = userId in simulator

    const roll = Math.random();
    let text: string;

    if (roll < 0.7) {
      // 70%: send a valid answer letter only
      const option = this.pickOption(state.question.correctOption);
      text = option;
    } else if (roll < 0.9) {
      // 20%: send answer with natural language
      const option = this.pickOption(state.question.correctOption);
      const templates = [
        `definitely ${option}`,
        `answer is ${option}!`,
        `${option} for sure`,
        `I think ${option}`,
        `going with ${option}`,
        `my answer is ${option}`,
        `it's ${option}`,
        `I choose ${option}`,
      ];
      text = templates[Math.floor(Math.random() * templates.length)];
    } else {
      // 10%: irrelevant chat
      text = IRRELEVANT_MESSAGES[Math.floor(Math.random() * IRRELEVANT_MESSAGES.length)];
    }

    const result = await chatService.processMessage({
      userId,
      username,
      text,
      receivedAt: Date.now(),
    });

    if (result.isValid) {
      this.answeredUsers.add(userId);
    }
  }

  /**
   * Pick an option biased toward the correct answer (~60% correct)
   */
  private pickOption(correctOption: OptionKey): OptionKey {
    const options: OptionKey[] = ['A', 'B', 'C', 'D'];
    if (Math.random() < 0.60) return correctOption;
    const others = options.filter(o => o !== correctOption);
    return others[Math.floor(Math.random() * others.length)];
  }
}
