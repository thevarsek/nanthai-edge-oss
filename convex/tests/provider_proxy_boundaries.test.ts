import assert from "node:assert/strict";
import test from "node:test";

import * as clozeRealPeople from "../tools/cloze/people";
import * as clozeRealProjects from "../tools/cloze/projects";
import * as clozeRealTimeline from "../tools/cloze/timeline";
import * as clozeProxy from "../tools/cloze/index";
import { executeClozeTool } from "../tools/cloze/actions";
import * as docxEditProxy from "../tools/docx_edit_proxy";
import { executeDocxEditTool } from "../tools/docx_edit_actions";
import * as docxEditReal from "../tools/propose_docx_edits";
import * as googleRealCalendar from "../tools/google/calendar";
import * as googleRealDrive from "../tools/google/drive";
import * as gmailReal from "../tools/google/gmail";
import * as gmailProxyOnly from "../tools/google/gmail_proxy";
import { executeGmailTool } from "../tools/google/gmail_actions";
import * as googleProxy from "../tools/google/index";
import { executeGoogleTool } from "../tools/google/actions";
import * as microsoftRealCalendar from "../tools/microsoft/calendar";
import * as microsoftRealOneDrive from "../tools/microsoft/onedrive";
import * as microsoftRealOutlook from "../tools/microsoft/outlook";
import * as microsoftProxy from "../tools/microsoft/index";
import { executeMicrosoftTool } from "../tools/microsoft/actions";
import * as notionReal from "../tools/notion/pages";
import * as notionProxy from "../tools/notion/index";
import { executeNotionTool } from "../tools/notion/actions";
import * as pptxProxy from "../tools/pptx_proxy";
import { executePptxTool } from "../tools/pptx_actions";
import * as pptxRealEdit from "../tools/edit_pptx";
import * as pptxRealGenerate from "../tools/generate_pptx";
import * as slackReal from "../tools/slack/tools";
import * as slackProxy from "../tools/slack/index";
import { executeSlackTool } from "../tools/slack/actions";
import type { RegisteredTool, ToolExecutionContext, ToolResult } from "../tools/registry";

type ActionForTest = {
  _handler: (
    ctx: unknown,
    args: {
      toolName: string;
      toolArgs: Record<string, unknown>;
      toolContext: { userId: string };
    },
  ) => Promise<ToolResult>;
};

type ProxyCall = {
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolContext: Record<string, unknown>;
};

function assertSameDefinition(
  exportName: string,
  proxyTool: RegisteredTool,
  realTool: RegisteredTool,
): void {
  assert.deepEqual(
    proxyTool.definition,
    realTool.definition,
    `${exportName} proxy definition must match the real implementation`,
  );
}

async function assertRejectsUnknownTool(
  action: unknown,
  toolName: string,
  expectedMessage: RegExp,
): Promise<void> {
  try {
    await (action as ActionForTest)._handler({}, {
      toolName,
      toolArgs: {},
      toolContext: { userId: "user_1" },
    });
    assert.fail(`Expected ${toolName} to be rejected`);
  } catch (error) {
    assert.match(error instanceof Error ? error.message : String(error), expectedMessage);
  }
}

function proxyToolCtx(calls: ProxyCall[]): ToolExecutionContext {
  return {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    jobId: "job_1",
    generationKey: "generation_1",
    modelId: "model_1",
    requireZdr: true,
    sandboxSessionId: "sandbox_1",
    workspaceSandbox: {} as never,
    workspaceSandboxCleanup: async () => undefined,
    ctx: {
      runAction: async (_ref: unknown, args: unknown): Promise<ToolResult> => {
        calls.push(args as ProxyCall);
        return { success: true, data: { proxied: true } };
      },
    },
  } as unknown as ToolExecutionContext;
}

test("provider proxies preserve exact real tool definitions", () => {
  const pairs: Array<[string, RegisteredTool, RegisteredTool]> = [
    ["driveUpload", googleProxy.driveUpload, googleRealDrive.driveUpload],
    ["driveList", googleProxy.driveList, googleRealDrive.driveList],
    ["driveRead", googleProxy.driveRead, googleRealDrive.driveRead],
    ["driveMove", googleProxy.driveMove, googleRealDrive.driveMove],
    ["calendarList", googleProxy.calendarList, googleRealCalendar.calendarList],
    ["calendarCreate", googleProxy.calendarCreate, googleRealCalendar.calendarCreate],
    ["calendarDelete", googleProxy.calendarDelete, googleRealCalendar.calendarDelete],
    ["gmailSend", gmailProxyOnly.gmailSend, gmailReal.gmailSend],
    ["gmailCreateDraft", gmailProxyOnly.gmailCreateDraft, gmailReal.gmailCreateDraft],
    ["gmailRead", gmailProxyOnly.gmailRead, gmailReal.gmailRead],
    ["gmailSearch", gmailProxyOnly.gmailSearch, gmailReal.gmailSearch],
    ["gmailDelete", gmailProxyOnly.gmailDelete, gmailReal.gmailDelete],
    ["gmailModifyLabels", gmailProxyOnly.gmailModifyLabels, gmailReal.gmailModifyLabels],
    ["gmailListLabels", gmailProxyOnly.gmailListLabels, gmailReal.gmailListLabels],
    ["outlookSend", microsoftProxy.outlookSend, microsoftRealOutlook.outlookSend],
    ["outlookRead", microsoftProxy.outlookRead, microsoftRealOutlook.outlookRead],
    ["outlookSearch", microsoftProxy.outlookSearch, microsoftRealOutlook.outlookSearch],
    ["outlookDelete", microsoftProxy.outlookDelete, microsoftRealOutlook.outlookDelete],
    ["outlookMove", microsoftProxy.outlookMove, microsoftRealOutlook.outlookMove],
    ["outlookListFolders", microsoftProxy.outlookListFolders, microsoftRealOutlook.outlookListFolders],
    ["onedriveUpload", microsoftProxy.onedriveUpload, microsoftRealOneDrive.onedriveUpload],
    ["onedriveList", microsoftProxy.onedriveList, microsoftRealOneDrive.onedriveList],
    ["onedriveRead", microsoftProxy.onedriveRead, microsoftRealOneDrive.onedriveRead],
    ["onedriveMove", microsoftProxy.onedriveMove, microsoftRealOneDrive.onedriveMove],
    ["msCalendarList", microsoftProxy.msCalendarList, microsoftRealCalendar.msCalendarList],
    ["msCalendarCreate", microsoftProxy.msCalendarCreate, microsoftRealCalendar.msCalendarCreate],
    ["msCalendarDelete", microsoftProxy.msCalendarDelete, microsoftRealCalendar.msCalendarDelete],
    ["notionSearch", notionProxy.notionSearch, notionReal.notionSearch],
    ["notionReadPage", notionProxy.notionReadPage, notionReal.notionReadPage],
    ["notionCreatePage", notionProxy.notionCreatePage, notionReal.notionCreatePage],
    ["notionUpdatePage", notionProxy.notionUpdatePage, notionReal.notionUpdatePage],
    ["notionDeletePage", notionProxy.notionDeletePage, notionReal.notionDeletePage],
    ["notionUpdateDatabaseEntry", notionProxy.notionUpdateDatabaseEntry, notionReal.notionUpdateDatabaseEntry],
    ["notionQueryDatabase", notionProxy.notionQueryDatabase, notionReal.notionQueryDatabase],
    ["slackSearchMessages", slackProxy.slackSearchMessages, slackReal.slackSearchMessages],
    ["slackSearchUsers", slackProxy.slackSearchUsers, slackReal.slackSearchUsers],
    ["slackSearchChannels", slackProxy.slackSearchChannels, slackReal.slackSearchChannels],
    ["slackSendMessage", slackProxy.slackSendMessage, slackReal.slackSendMessage],
    ["slackSendMessageDraft", slackProxy.slackSendMessageDraft, slackReal.slackSendMessageDraft],
    ["slackScheduleMessage", slackProxy.slackScheduleMessage, slackReal.slackScheduleMessage],
    ["slackReadChannel", slackProxy.slackReadChannel, slackReal.slackReadChannel],
    ["slackReadThread", slackProxy.slackReadThread, slackReal.slackReadThread],
    ["slackCreateCanvas", slackProxy.slackCreateCanvas, slackReal.slackCreateCanvas],
    ["slackUpdateCanvas", slackProxy.slackUpdateCanvas, slackReal.slackUpdateCanvas],
    ["slackReadCanvas", slackProxy.slackReadCanvas, slackReal.slackReadCanvas],
    ["slackReadUserProfile", slackProxy.slackReadUserProfile, slackReal.slackReadUserProfile],
    ["clozePersonFind", clozeProxy.clozePersonFind, clozeRealPeople.clozePersonFind],
    ["clozePersonCount", clozeProxy.clozePersonCount, clozeRealPeople.clozePersonCount],
    ["clozePersonAdd", clozeProxy.clozePersonAdd, clozeRealPeople.clozePersonAdd],
    ["clozePersonChange", clozeProxy.clozePersonChange, clozeRealPeople.clozePersonChange],
    ["clozeAddNote", clozeProxy.clozeAddNote, clozeRealTimeline.clozeAddNote],
    ["clozeAddTodo", clozeProxy.clozeAddTodo, clozeRealTimeline.clozeAddTodo],
    ["clozeTimeline", clozeProxy.clozeTimeline, clozeRealTimeline.clozeTimeline],
    ["clozeSaveDraft", clozeProxy.clozeSaveDraft, clozeRealTimeline.clozeSaveDraft],
    ["clozeAboutMe", clozeProxy.clozeAboutMe, clozeRealTimeline.clozeAboutMe],
    ["clozeProjectFind", clozeProxy.clozeProjectFind, clozeRealProjects.clozeProjectFind],
    ["clozeProjectChange", clozeProxy.clozeProjectChange, clozeRealProjects.clozeProjectChange],
    ["generatePptx", pptxProxy.generatePptx, pptxRealGenerate.generatePptx],
    ["editPptx", pptxProxy.editPptx, pptxRealEdit.editPptx],
    ["proposeDocxEdits", docxEditProxy.proposeDocxEdits, docxEditReal.proposeDocxEdits],
  ];

  for (const [exportName, proxyTool, realTool] of pairs) {
    assertSameDefinition(exportName, proxyTool, realTool);
  }
});

test("provider proxies forward only serializable execution context", async () => {
  const calls: ProxyCall[] = [];
  const ctx = proxyToolCtx(calls);

  await googleProxy.driveList.execute(ctx, { max_results: 1 });
  await microsoftProxy.outlookRead.execute(ctx, { max_results: 1 });
  await notionProxy.notionSearch.execute(ctx, { query: "roadmap" });
  await slackProxy.slackSearchMessages.execute(ctx, { query: "launch" });
  await clozeProxy.clozeAboutMe.execute(ctx, {});

  assert.deepEqual(calls.map((call) => call.toolName), [
    "drive_list",
    "outlook_read",
    "notion_search",
    "slack_search_messages",
    "cloze_about_me",
  ]);
  for (const call of calls) {
    assert.deepEqual(call.toolContext, {
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      jobId: "job_1",
      generationKey: "generation_1",
      modelId: "model_1",
      requireZdr: true,
    });
    assert.equal("ctx" in call.toolContext, false);
    assert.equal("workspaceSandbox" in call.toolContext, false);
    assert.equal("workspaceSandboxCleanup" in call.toolContext, false);
    assert.equal("sandboxSessionId" in call.toolContext, false);
  }
});

test("provider action dispatchers reject unknown tool names", async () => {
  await assertRejectsUnknownTool(executeGoogleTool, "drive_unknown", /Unknown Google tool/);
  await assertRejectsUnknownTool(executeMicrosoftTool, "microsoft_unknown", /Unknown Microsoft tool/);
  await assertRejectsUnknownTool(executeNotionTool, "notion_unknown", /Unknown Notion tool/);
  await assertRejectsUnknownTool(executeSlackTool, "slack_unknown", /Unknown Slack tool/);
  await assertRejectsUnknownTool(executeClozeTool, "cloze_unknown", /Unknown Cloze tool/);
  await assertRejectsUnknownTool(executeGmailTool, "gmail_unknown", /Unknown Gmail tool/);
  await assertRejectsUnknownTool(executePptxTool, "pptx_unknown", /Unknown PPTX tool/);
  await assertRejectsUnknownTool(executeDocxEditTool, "docx_unknown", /Unknown DOCX edit tool/);
});
