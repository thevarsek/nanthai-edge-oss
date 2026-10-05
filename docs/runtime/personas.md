# Personas and execution routes

A Persona selects cloud execution or a paired Mac/harness. Runtime selection
precedes model selection. Cloud uses the cloud model picker; Codex/Pi model choice
belongs to the selected runtime. Switching back to Cloud preserves the previous
cloud model. Cloud model validation does not block saving a local Persona.

The runtime model can use its configured default or an available discovered model.
A discovery result is a provider/model identity, not a display-name match. Saved
choices are preserved; availability is checked against the selected adapter.

## Instructions and logical turns

Convex resolves empty or whitespace-only Persona instructions to:

> You are a helpful assistant. Answer clearly and accurately, and ask for clarification when needed.

Creation, updates, legacy reads and cloud/local/scheduled execution use that same
resolver. Every nonempty custom prompt remains verbatim. Clients permit empty
input because the backend supplies the effective prompt.

A new logical turn uses the current accessible Persona and compatible explicit
chat override. An active turn and its replay keep the captured configuration.
Deleting a Persona does not erase published history. Native-session reuse follows
[runtime architecture](architecture.md), including visibility and branch checks.

## Search and helper behavior

Native Codex Basic search is supported without an OpenRouter fallback. Pi's own
tools do not advertise a NanthAI Basic-search binding. A Pi turn with that search
requirement can fail before native dispatch. There is no implemented policy that
automatically substitutes native tools or changes the user's global preference.

Shared memory and helper behavior remains owned by Convex. Local execution does
not mean local inference, fully local data or unrestricted access to cloud tools.
See [tool access](../product/tool-skill-access.md) and [setup](setup.md).
