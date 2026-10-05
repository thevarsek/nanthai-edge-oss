# Local runtime user journeys

## Connect a Mac and start a conversation

Choose OpenRouter for cloud inference or connect a Mac for local execution.
Install NanthAI Runtime, select an existing Codex/Pi executable and connect the
NanthAI account. Browser setup returns to the Mac app; mobile setup supplies a
one-time code. Start a chat from the online machine card or select its Persona.
The same chat and published output are available on web, iOS and Android.

The provider stays configured in Codex/Pi. Local execution may use an online
subscription/API or an already installed local model. It is not a promise of
fully local data or internet-free inference. See [setup](../runtime/setup.md).

## Control the work

Follow the canonical response from another controller, answer native questions
and permissions, or use Stop. Current Persona settings apply to new turns;
active work retains its captured configuration. A deleted Persona does not erase
published results. [Persona routing](../runtime/personas.md) explains model and
search behavior.

## Share results and inspect sources

Explicitly published files become ordinary chat artifacts. Other authorized
participants can use the shared conversation and outputs. Supporting-source pills
show recorded quotations from earlier messages/shared memories; existing document
citations remain. The UI does not claim to reveal private model reasoning.

## Wait or continue a saved task

A manual task sent while its selected Mac adapter is unavailable waits for that
adapter. A task already received by the Mac can be continued from **Saved tasks**
when NanthAI is unreachable. Reconnection imports unchanged work once; changed or
cancelled shared tasks retain a separate local result. Native questions and Stop
remain available. See [saved tasks](../runtime/saved-tasks.md).

## Schedule work and review usage

Local scheduled jobs use canonical schedules and readiness checks. A missed
offline occurrence fails once and is not caught up on reconnect. The next normal
occurrence can run when the adapter is ready. None/Basic search support depends on
the selected harness; this is distinct from manually waiting for the Mac.

The Mac usage view includes canonical reports from both engines, retained per
account/Mac and rebuilt when connected. API-equivalent estimates are not
subscription bills. Codex account allowance is presented separately.

## Connect another AI client

The [external MCP service](../integrations/external-mcp.md) allows an authorized
client to read owned context, send work to a Persona, publish a result, run an
existing schedule or stop owned work. It uses the same conversation and execution
owners. It does not expose arbitrary shell access or provider credentials.

## Availability and public explanation

The integration branch's website describes workflows and local-runtime setup in
seven locales. Its Mac CTA enters the existing settings journey; the actual
installer comes from the canonical backend download URL. A private notarized DEV
candidate does not establish public availability.

Comparison claims must state their model/harness, task, sample and tradeoffs.
One favorable example is not a general cost or quality guarantee. Complete
reviewed outcomes and limitations belong in the
[evaluation record](../../milestones/M56-context-engine-handoffs.md).
