// Features whose screens exist but do not work end to end yet.
// Their code stays in the project for future work; while a flag is false
// the entry points are hidden so users only see what really works.
export const FEATURES = {
  // AI summary of a note (Groq, through /api/notes/:id/summary).
  aiSummary: true,
  // Free-form AI chat about a note. Answers are still mocked.
  aiAssistant: false,
  // Passcode lock and Face ID. The settings are not saved and nothing is locked yet.
  appLock: false,
  // Notification preferences and the notifications screen (sample data only).
  notifications: false,
  // "Personal Information" and "Security Center" in Settings (no screens behind them yet).
  profileEditing: false,
  securityCenter: false,
  // Joining a workspace by link (no join flow on the server yet).
  workspaceLinkSharing: false,
  // Invitation inbox. Members are added directly by email for now.
  workspaceInvites: false,
  // Help & Support page (not written yet).
  helpCenter: false,
};
