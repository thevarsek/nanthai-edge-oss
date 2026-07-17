export const MULTI_PARTICIPANT_ARTIFACT_GUIDANCE =
  "Presentation and Word document creation or editing require a single participant. " +
  "Open + → Participants and remove participants until only one remains, then try again. " +
  "You can add the others back afterward.";

export const IDEASCAPE_ARTIFACT_EDIT_GUIDANCE =
  "Existing presentation and Word document edits must be made in normal chat. " +
  "Open the artifact for review, return to Chat, and stage the file or selection there.";

const statefulArtifactWriteTools = new Set([
  "create_presentation",
  "edit_presentation",
  "generate_pptx",
  "edit_pptx",
  "generate_docx",
  "edit_docx",
  "propose_docx_edits",
]);

const existingArtifactEditTools = new Set([
  "edit_presentation",
  "edit_pptx",
  "edit_docx",
  "propose_docx_edits",
]);

export type ArtifactWriteTurnContext = {
  turnParticipantCount?: number;
  isIdeascapeTurn?: boolean;
};

export function artifactWriteBlockMessage(
  toolName: string,
  context: ArtifactWriteTurnContext,
): string | null {
  if (!statefulArtifactWriteTools.has(toolName)) return null;
  if ((context.turnParticipantCount ?? 1) > 1) {
    return MULTI_PARTICIPANT_ARTIFACT_GUIDANCE;
  }
  if (context.isIdeascapeTurn === true && existingArtifactEditTools.has(toolName)) {
    return IDEASCAPE_ARTIFACT_EDIT_GUIDANCE;
  }
  return null;
}

export function artifactTurnSystemGuidance(context: ArtifactWriteTurnContext): string | null {
  const guidance: string[] = [];
  if ((context.turnParticipantCount ?? 1) > 1) {
    guidance.push(
      "This is a multi-participant turn. PPTX and DOCX reads and reviews are allowed, " +
      "but do not create or edit those artifacts. If the user requests a write, explain exactly: " +
      `"${MULTI_PARTICIPANT_ARTIFACT_GUIDANCE}" Do not claim that a file changed.`,
    );
  }
  if (context.isIdeascapeTurn === true) {
    guidance.push(
      "This turn was sent from Ideascape. Existing PPTX and DOCX artifacts are review-only here. " +
      `If the user requests an edit, explain exactly: "${IDEASCAPE_ARTIFACT_EDIT_GUIDANCE}"`,
    );
  }
  return guidance.length > 0 ? guidance.join("\n") : null;
}
