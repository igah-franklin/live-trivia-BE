// All socket event name constants — single source of truth

export const SocketEvents = {
  // Server → Client
  ROUND_STARTED: 'round:started',
  ROUND_TICK: 'round:tick',
  ROUND_CLOSED: 'round:closed',
  ROUND_RESOLVED: 'round:resolved',
  ROUND_CANCELLED: 'round:cancelled',

  ANSWER_RECEIVED: 'answer:received',
  ANSWER_DISTRIBUTION: 'answer:distribution',

  LEADERBOARD_UPDATED: 'leaderboard:updated',

  CHAT_MESSAGE: 'chat:message',

  VIEWER_COUNT: 'viewer:count',

  // Client → Server
  OPERATOR_JOIN: 'operator:join',
  OVERLAY_JOIN: 'overlay:join',

  // Connection state
  TIKTOK_CONNECTED: 'tiktok:connected',
  TIKTOK_DISCONNECTED: 'tiktok:disconnected',
  TIKTOK_ERROR: 'tiktok:error',
} as const;

export type SocketEventName = typeof SocketEvents[keyof typeof SocketEvents];
