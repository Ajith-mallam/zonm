// Session and sign-in policy. Values are defaults pending the client's security policy.
export const SESSION_POLICY = {
  absoluteHours: 8,
  idleMinutes: 30,
  touchEverySeconds: 60, // how often lastSeenAt is written
} as const;

/**
 * Two-step verification. On unless AUTH_MFA_REQUIRED=false. Turning it off is
 * for local testing only: sign-in is then password-only and the app shows a
 * warning banner. Never set this in a deployed environment.
 */
export const MFA_REQUIRED = process.env.AUTH_MFA_REQUIRED !== "false";

/**
 * Forced change of temporary and expired passwords. On unless
 * AUTH_FORCE_PASSWORD_CHANGE=false (local testing only).
 */
export const FORCE_PASSWORD_CHANGE = process.env.AUTH_FORCE_PASSWORD_CHANGE !== "false";

/**
 * The yellow "test mode" banner shown while MFA is off. Shown unless
 * AUTH_TEST_MODE_BANNER=false (hidden locally at the user's request).
 */
export const SHOW_TEST_MODE_BANNER = !MFA_REQUIRED && process.env.AUTH_TEST_MODE_BANNER !== "false";
