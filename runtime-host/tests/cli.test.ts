import assert from "node:assert/strict";
import test from "node:test";

import type { AdapterRegistry } from "../src/adapter_registry.ts";
import { runCli, type CliDependencies } from "../src/cli.ts";
import type { PairingClient } from "../src/control_plane.ts";
import { InMemoryCredentialStore } from "../src/credential_store.ts";
import { RuntimeHttpError } from "../src/http_json_client.ts";

test("CLI pairs with the frozen two-part claim and reports offline status", async () => {
  const output: string[] = [];
  const pairing = new FakePairingClient();
  const dependencies = cliDependencies(pairing, output);
  assert.equal(await runCli(["pair", "pairing-1", "123456"], dependencies), 0);
  assert.deepEqual(pairing.claim, { pairingId: "pairing-1", oneTimeCode: "123456" });
  assert.equal(await runCli(["runtime", "status"], dependencies), 0);
  assert.deepEqual(JSON.parse(output.at(-1) ?? "null"), {
    state: "offline",
    paired: true,
    deviceId: "device-1",
  });
});

test("CLI surfaces safe account identity and does not start a model turn", async () => {
  const output: string[] = [];
  const dependencies = cliDependencies(new FakePairingClient(), output);
  assert.equal(await runCli(["adapters", "account", "codex"], dependencies), 0);
  const account = JSON.parse(output.at(-1) ?? "null") as {
    account: { identity: string };
  };
  assert.equal(account.account.identity, "personal@example.test");
});

test("copied pairing commands select their server without environment setup and reject malformed options", async () => {
  const requests: Parameters<PairingClient["pair"]>[0][] = [];
  const pairing: PairingClient = {
    pair: async (request) => {
      requests.push(request);
      return { deviceId: "qa", credentialId: "credential", credential: "secret", controlPlaneUrl: request.controlPlaneUrl ?? "https://wrong.test" };
    },
  };
  const dependencies = cliDependencies(pairing, []);
  assert.equal(await runCli(["pair", "qa", "123456", "--server", "https://dev.convex.site"], dependencies), 0);
  assert.equal(requests[0]?.controlPlaneUrl, "https://dev.convex.site");
  assert.equal((await dependencies.credentials.readDeviceCredential())?.controlPlaneUrl, "https://dev.convex.site");
  for (const options of [["--unknown", "https://dev.test"], ["--server"], ["--server", "file:///tmp/qa"], ["--server", "https://secret@example.test"]]) {
    assert.equal(await runCli(["pair", "qa", "123456", ...options], dependencies), 1);
  }
  assert.equal(requests.length, 1);
});

test("CLI starts the production factory with foreground ownership", async () => {
  const output: string[] = [];
  const dependencies = cliDependencies(new FakePairingClient(), output);
  const owners: string[] = [];
  await dependencies.credentials.writeDeviceCredential({
    deviceId: "device-1",
    credentialId: "credential-1",
    controlPlaneUrl: "https://example.test",
    credential: "secret",
  });
  dependencies.hostFactory = {
    create: (_credential, owner) => {
      owners.push(owner);
      return { run: async () => undefined };
    },
  };

  assert.equal(await runCli(["runtime", "start"], dependencies), 0);
  assert.deepEqual(owners, ["foreground_cli"]);
  assert.deepEqual(JSON.parse(output.at(-1) ?? "null"), {
    state: "starting",
    deviceId: "device-1",
    owner: "foreground_cli",
  });
});

test("revoked runtime authority clears only that pairing and requests no automatic restart", async () => {
  for (const replacePairing of [false, true]) {
    const output: string[] = [];
    const dependencies = cliDependencies(new FakePairingClient(), output);
    await runCli(["pair", "pairing-1", "123456"], dependencies);
    dependencies.hostFactory = { create: () => ({ run: async () => {
      if (replacePairing) {
        await dependencies.credentials.writeDeviceCredential({
          deviceId: "device-new", credentialId: "credential-new", credential: "new-secret",
          controlPlaneUrl: "https://example.test",
        });
      }
      throw new RuntimeHttpError(401, "UNAUTHORIZED", "Runtime Host credential is invalid or revoked");
    } }) };
    assert.equal(await runCli(["runtime", "start", "--owner", "tray"], dependencies), 77);
    assert.equal((await dependencies.credentials.readDeviceCredential())?.credentialId ?? null,
      replacePairing ? "credential-new" : null);
    assert.match(output.at(-1) ?? "", /Reconnect NanthAI/);
  }
});

test("temporary transport failures preserve pairing and remain restartable", async () => {
  const dependencies = cliDependencies(new FakePairingClient(), []);
  await runCli(["pair", "pairing-1", "123456"], dependencies);
  dependencies.hostFactory = { create: () => ({ run: async () => {
    throw new RuntimeHttpError(0, "NETWORK_ERROR", "Runtime endpoint could not be reached");
  } }) };
  assert.equal(await runCli(["runtime", "start"], dependencies), 1);
  assert.equal((await dependencies.credentials.readDeviceCredential())?.credentialId, "credential-1");
});

class FakePairingClient implements PairingClient {
  claim: { pairingId: string; oneTimeCode: string } | null = null;

  async pair(request: Parameters<PairingClient["pair"]>[0]) {
    if (request.shortCode) throw new Error("Short-code pairing is tested separately");
    this.claim = { pairingId: request.pairingId, oneTimeCode: request.oneTimeCode };
    return {
      deviceId: "device-1",
      credentialId: "credential-1",
      controlPlaneUrl: "https://example.test",
      credential: "secret",
    };
  }
}

function cliDependencies(pairing: PairingClient, output: string[]): CliDependencies {
  const adapters: AdapterRegistry = {
    list: () => [{
      name: "codex",
      implementation: "codex_app_server",
      selected: true,
      transport: "stdio",
    }],
    probe: async () => ({
      healthy: true,
      adapter: "codex_app_server",
      transport: "stdio",
      cliVersion: "0.147.0",
      protocolVersion: "v2",
      command: "/fake/codex",
      account: {
        authMethod: "chatgpt",
        identity: "personal@example.test",
        plan: "pro",
        requiresOpenaiAuth: true,
      },
      modelCount: 1,
      rateLimits: null,
      rateLimitReadError: null,
    }),
  };
  return {
    credentials: new InMemoryCredentialStore(),
    pairing,
    adapters,
    status: {
      read: async () => null,
      removeIfOwnedBy: async () => undefined,
    },
    usage: { list: async () => [] },
    hostFactory: { create: () => ({ run: async () => undefined }) },
    signalProcess: () => undefined,
    processExists: () => true,
    stdout: (line) => output.push(line),
    stderr: (line) => output.push(line),
  };
}

test("uninstall waits for the owned host to stop before removing only its pairing credential", async () => {
  const output: string[] = [];
  const deps = cliDependencies(new FakePairingClient(), output);
  await runCli(["pair", "pairing-1", "123456"], deps);
  let running = true;
  deps.status.read = async () => ({ pid: 123, owner: "foreground_cli", state: "online", deviceId: "device-1", startedAtMs: 1, updatedAtMs: 1, activeAttempts: 0, queuedEvents: 0, lastError: null });
  deps.processExists = () => running;
  deps.signalProcess = (pid, signal) => { assert.equal(pid, 123); assert.equal(signal, "SIGTERM"); running = false; };
  assert.equal(await runCli(["unpair"], deps), 1);
  assert.ok(await deps.credentials.readDeviceCredential());
  assert.equal(await runCli(["runtime", "stop", "--wait"], deps), 0);
  assert.equal(await runCli(["unpair"], deps), 0);
  assert.equal(await deps.credentials.readDeviceCredential(), null);
});
