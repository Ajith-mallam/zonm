// Session policy. Values are defaults pending the client's security policy.
export const SESSION_POLICY = {
  absoluteHours: 8,
  idleMinutes: 30,
  touchEverySeconds: 60, // how often lastSeenAt is written
} as const;
