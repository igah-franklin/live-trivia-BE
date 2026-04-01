// Centralized Redis key builders

export const RedisKeys = {
  /** JSON of current active round state */
  ROUND_ACTIVE: 'ROUND:ACTIVE' as const,

  /** Redis Set of userIds who answered this round */
  roundAnswers: (roundId: string) => `ROUND:${roundId}:ANSWERS`,

  /** Redis Hash { A, B, C, D } answer distribution */
  roundDist: (roundId: string) => `ROUND:${roundId}:DIST`,

  /** TTL key used as timer marker */
  roundTimer: (roundId: string) => `ROUND:${roundId}:TIMER`,

  /** Redis Sorted Set — score = game score, member = userId:username */
  LEADERBOARD: 'LEADERBOARD' as const,

  /** Redis List — last 100 chat messages */
  CHAT_RECENT: 'CHAT:RECENT' as const,

  /** Redis String — viewer count */
  VIEWER_COUNT: 'VIEWER:COUNT' as const,

  /** Questions list cache */
  QUESTIONS_CACHE: 'CACHE:QUESTIONS' as const,
} as const;
