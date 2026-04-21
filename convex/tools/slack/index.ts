// convex/tools/slack/index.ts
// =============================================================================
// Barrel export for all Slack tools.
//
// Registered in progressive_registry_profiles.ts (exposed to the LLM):
//   slackSearchMessages, slackSearchUsers, slackSearchChannels,
//   slackSendMessage, slackReadChannel, slackReadThread,
//   slackCreateCanvas, slackUpdateCanvas, slackReadCanvas, slackReadUserProfile
//
// Exported but NOT yet registered (available for future enablement):
//   slackSendMessageDraft, slackScheduleMessage
// =============================================================================

export {
  slackSearchMessages,
  slackSearchUsers,
  slackSearchChannels,
  slackSendMessage,
  slackSendMessageDraft,
  slackScheduleMessage,
  slackReadChannel,
  slackReadThread,
  slackCreateCanvas,
  slackUpdateCanvas,
  slackReadCanvas,
  slackReadUserProfile,
} from "./tools";
