/** Convex backend function identifiers — mirrors iOS AppConstants.Convex */
export const ConvexFns = {
  // Chat queries
  listChats: "chat/queries:listChats",
  getChat: "chat/queries:getChat",
  listMessages: "chat/queries:listMessages",
  listStreamingMessages: "chat/queries:listStreamingMessages",
  listAllMessages: "chat/queries:listAllMessages",
  getMessage: "chat/queries:getMessage",
  getActiveJobs: "chat/queries:getActiveJobs",
  getAttachmentUrl: "chat/queries:getAttachmentUrl",
  getMessageAudioUrl: "chat/queries:getMessageAudioUrl",
  getGeneratedFilesByMessage: "chat/queries:getGeneratedFilesByMessage",
  getGeneratedChartsByMessage: "chat/queries:getGeneratedChartsByMessage",
  listKnowledgeBaseFiles: "chat/queries:listKnowledgeBaseFiles",

  // Chat mutations
  createChat: "chat/mutations:createChat",
  createUploadUrl: "chat/mutations:createUploadUrl",
  sendMessage: "chat/mutations:sendMessage",
  requestAudioGeneration: "chat/mutations:requestAudioGeneration",
  retryMessage: "chat/mutations:retryMessage",
  cancelActiveGeneration: "chat/mutations:cancelActiveGeneration",
  deleteKnowledgeBaseFile: "chat/mutations:deleteKnowledgeBaseFile",

  // Chat management
  updateChat: "chat/manage:updateChat",
  switchBranchAtFork: "chat/manage:switchBranchAtFork",
  deleteChat: "chat/manage:deleteChat",
  bulkDeleteChats: "chat/manage:bulkDeleteChats",
  bulkMoveChats: "chat/manage:bulkMoveChats",
  deleteMessage: "chat/manage:deleteMessage",
  forkChat: "chat/manage:forkChat",
  duplicateChat: "chat/manage:duplicateChat",
  reorderPinnedChats: "chat/manage:reorderPinnedChats",

  // Favorites
  listFavorites: "favorites/queries:listFavorites",
  createFavorite: "favorites/mutations:createFavorite",
  updateFavorite: "favorites/mutations:updateFavorite",
  deleteFavorite: "favorites/mutations:deleteFavorite",
  reorderFavorites: "favorites/mutations:reorderFavorites",

  // Folders
  listFolders: "folders/queries:list",
  createFolder: "folders/mutations:create",
  updateFolder: "folders/mutations:update",
  removeFolder: "folders/mutations:remove",
  moveChatToFolder: "folders/mutations:moveChat",

  // Personas
  listPersonas: "personas/queries:list",
  getPersona: "personas/queries:get",
  createPersona: "personas/mutations:create",
  updatePersona: "personas/mutations:update",
  removePersona: "personas/mutations:remove",

  // Memory
  listMemory: "memory/operations:list",
  togglePinMemory: "memory/operations:togglePin",
  removeMemory: "memory/operations:remove",
  approveMemory: "memory/operations:approve",
  rejectMemory: "memory/operations:reject",
  updateMemory: "memory/operations:update",
  createManualMemory: "memory/operations:createManual",
  extractImportCandidates: "memory/operations:extractImportCandidates",
  commitImportedMemories: "memory/operations:commitImportedMemories",
  deleteAllMemory: "memory/operations:deleteAll",
  approveAllMemory: "memory/operations:approveAll",
  rejectAllMemory: "memory/operations:rejectAll",

  // Models
  listModels: "models/sync:listModels",
  listModelSummaries: "models/sync:listModelSummaries",
  getModel: "models/sync:getModel",

  // Autonomous
  watchSession: "autonomous/queries:watchSession",
  listActiveSessions: "autonomous/queries:listActiveSessions",
  startSession: "autonomous/mutations:startSession",
  pauseSession: "autonomous/mutations:pauseSession",
  resumeSession: "autonomous/mutations:resumeSession",
  stopSession: "autonomous/mutations:stopSession",
  handleUserIntervention: "autonomous/mutations:handleUserIntervention",

  // Participants
  listParticipantsByChat: "participants/queries:listByChat",
  addParticipant: "participants/mutations:addParticipant",
  removeParticipant: "participants/mutations:removeParticipant",
  updateParticipant: "participants/mutations:updateParticipant",
  setParticipants: "participants/mutations:setParticipants",

  // Preferences
  getPreferences: "preferences/queries:getPreferences",
  getProStatus: "preferences/queries:getProStatus",
  upsertPreferences: "preferences/mutations:upsertPreferences",
  setOnboardingCompleted: "preferences/mutations:setOnboardingCompleted",
  getModelSettings: "preferences/queries:getModelSettings",
  listModelSettings: "preferences/queries:listModelSettings",
  upsertModelSettings: "preferences/mutations:upsertModelSettings",
  deleteModelSettings: "preferences/mutations:deleteModelSettings",

  // Capabilities
  getAccountCapabilitiesPublic: "capabilities/queries:getAccountCapabilitiesPublic",

  // Skills
  listVisibleSkills: "skills/queries:listVisibleSkills",
  getSkillDetail: "skills/queries:getSkillDetail",
  listDiscoverableSkills: "skills/queries:listDiscoverableSkills",
  createSkill: "skills/mutations:createSkill",
  updateSkill: "skills/mutations:updateSkill",
  archiveSkill: "skills/mutations:archiveSkill",
  deleteSkill: "skills/mutations:deleteSkill",
  duplicateSystemSkill: "skills/mutations:duplicateSystemSkill",
  setPersonaSkillsPublic: "skills/mutations:setPersonaSkillsPublic",
  setChatSkillsPublic: "skills/mutations:setChatSkillsPublic",

  // Scheduled jobs
  hasApiKey: "scheduledJobs/queries:hasApiKey",
  listScheduledJobs: "scheduledJobs/queries:list",
  getScheduledJob: "scheduledJobs/queries:get",
  listJobRuns: "scheduledJobs/queries:listRuns",
  createJob: "scheduledJobs/mutations:createJob",
  updateJob: "scheduledJobs/mutations:updateJob",
  pauseJob: "scheduledJobs/mutations:pauseJob",
  resumeJob: "scheduledJobs/mutations:resumeJob",
  deleteJob: "scheduledJobs/mutations:deleteJob",
  runJobNow: "scheduledJobs/mutations:runJobNow",
  upsertApiKey: "scheduledJobs/mutations:upsertApiKey",
  deleteApiKey: "scheduledJobs/mutations:deleteApiKey",
  fetchOpenRouterCredits: "scheduledJobs/actions:fetchOpenRouterCredits",

  // Node positions (Ideascape)
  listNodePositionsByChat: "nodePositions/queries:listByChat",
  upsertNodePosition: "nodePositions/mutations:upsert",
  batchUpsertNodePositions: "nodePositions/mutations:batchUpsert",
  removeNodePosition: "nodePositions/mutations:remove",
  removeAllNodePositionsForChat: "nodePositions/mutations:removeAllForChat",

  // Search
  watchChatSearchSessions: "search/queries:watchChatSearchSessions",
  startResearchPaper: "search/mutations:startResearchPaper",
  cancelResearchPaper: "search/mutations:cancelResearchPaper",
  regeneratePaper: "search/mutations:regeneratePaper",

  // OAuth
  exchangeGoogleCode: "oauth/google:exchangeGoogleCode",
  getGoogleConnection: "oauth/google:getGoogleConnection",
  disconnectGoogle: "oauth/google:disconnectGoogle",
  exchangeMicrosoftCode: "oauth/microsoft:exchangeMicrosoftCode",
  getMicrosoftConnection: "oauth/microsoft:getMicrosoftConnection",
  disconnectMicrosoft: "oauth/microsoft:disconnectMicrosoft",
  exchangeNotionCode: "oauth/notion:exchangeNotionCode",
  getNotionConnection: "oauth/notion:getNotionConnection",
  disconnectNotion: "oauth/notion:disconnectNotion",
  connectAppleCalendar: "oauth/apple_calendar:connectAppleCalendar",
  getAppleCalendarConnection: "oauth/apple_calendar:getAppleCalendarConnection",
  disconnectAppleCalendar: "oauth/apple_calendar:disconnectAppleCalendar",

  // Push
  registerDeviceToken: "push/mutations:registerDeviceToken",
  removeDeviceToken: "push/mutations:removeDeviceToken",

  // Audio
  previewVoice: "chat/actions:previewVoice",

  // Subagents
  getBatchView: "subagents/queries:getBatchView",

  // Account
  deleteAccount: "account/actions:deleteAccount",

  // Health
  healthCheck: "health:check",
} as const;

/** OpenRouter constants */
export const OpenRouter = {
  oauthUrl: "https://openrouter.ai/auth",
  keysUrl: "https://openrouter.ai/api/v1/auth/keys",
  creditsUrl: "https://openrouter.ai/api/v1/credits",
  callbackUrl: import.meta.env.DEV
    ? `${window.location.origin}/openrouter/callback`
    : "https://nanthai.tech/openrouter/callback",
  httpReferer: "https://nanthai.tech",
  appTitle: "NanthAi:Edge",
  pkceVerifierLength: 64,
  pkceStateLength: 64,
  pkceAllowedChars:
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~",
} as const;

/** Convex site URL for HTTP endpoints (download, Stripe webhook) */
export const convexSiteUrl = (() => {
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
  return convexUrl?.replace(".convex.cloud", ".convex.site") ?? "";
})();

/** Native app store URLs */
export const StoreUrls = {
  ios: "https://apps.apple.com/us/app/nanthai-edge-multi-ai-chat/id6760239881",
  android: "https://play.google.com/store/apps/details?id=com.nanthai.edge",
} as const;

/** App-wide defaults */
export const Defaults = {
  model: APP_DEFAULT_MODEL_ID,
  temperature: 0.7,
  maxTokens: 4096,
  maxParticipants: 3,
  maxConversationTokens: 75_000,
  preferenceWriteDebounce: 500,
  chatListSearchDebounce: 300,
  memoryAlwaysOnLimit: 10,
  proPriceDisplay: "£4.99",
} as const;
import { APP_DEFAULT_MODEL_ID } from "./modelDefaults";
