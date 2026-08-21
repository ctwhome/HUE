import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const hermesCommand = process.env.HERMES_BIN ?? "hermes";
const cwd = process.env.HUE_SPIKE_CWD ?? process.cwd();
const expected = "HUE ACP STREAM OK";

type ClientContext = acp.ClientContext;

class SpikeClient {
  updates: acp.SessionNotification[] = [];

  async denyPermission(): Promise<acp.RequestPermissionResponse> {
    return { outcome: { outcome: "cancelled" } };
  }

  async recordUpdate(params: acp.SessionNotification): Promise<void> {
    this.updates.push(params);
  }
}

async function withHermes<T>(
  operation: (ctx: ClientContext, client: SpikeClient) => Promise<T>,
): Promise<T> {
  const child = spawn(hermesCommand, ["acp"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(input, output);
  const client = new SpikeClient();

  try {
    return await acp
      .client({ name: "hue-hermes-acp-spike" })
      .onRequest(acp.methods.client.session.requestPermission, () =>
        client.denyPermission(),
      )
      .onNotification(acp.methods.client.session.update, (ctx) =>
        client.recordUpdate(ctx.params),
      )
      .connectWith(stream, async (ctx) => {
        const initialized = await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "hue-hermes-acp-spike", version: "0.0.1" },
        });

        if (initialized.agentInfo?.name !== "hermes-agent") {
          throw new Error(
            `Expected hermes-agent, received ${initialized.agentInfo?.name ?? "unknown"}`,
          );
        }

        return operation(ctx, client);
      });
  } catch (error) {
    const diagnostics = stderr.trim();
    if (diagnostics) {
      console.error("--- hermes acp stderr ---\n" + diagnostics);
    }
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

const firstRun = await withHermes(async (ctx) => {
  return ctx.buildSession(cwd).withSession(async (session) => {
    const promptPromise = session.prompt(
      `Reply with exactly: ${expected}. Do not use tools.`,
    );
    let responseText = "";
    let updateCount = 0;

    for (;;) {
      const message = await session.nextUpdate();
      if (message.kind === "stop") {
        const promptResponse = await promptPromise;
        if (promptResponse.stopReason !== "end_turn") {
          throw new Error(`Unexpected stop reason: ${promptResponse.stopReason}`);
        }
        break;
      }

      updateCount += 1;
      const update = message.update;
      if (
        update.sessionUpdate === "agent_message_chunk" &&
        update.content.type === "text"
      ) {
        responseText += update.content.text;
      }
    }

    if (!responseText.includes(expected)) {
      throw new Error(`Incomplete response: ${JSON.stringify(responseText)}`);
    }

    return {
      sessionId: session.sessionId,
      responseText,
      updateCount,
    };
  });
});

const secondRun = await withHermes(async (ctx, client) => {
  const listed = (await ctx.request(acp.methods.agent.session.list, {
    cwd,
  })) as acp.ListSessionsResponse;
  const found = listed.sessions.some(
    (session) => session.sessionId === firstRun.sessionId,
  );
  if (!found) {
    throw new Error(`Session ${firstRun.sessionId} was not persisted/listed`);
  }

  await ctx.request(acp.methods.agent.session.resume, {
    cwd,
    sessionId: firstRun.sessionId,
    mcpServers: [],
  });

  const replayedText = client.updates
    .map((notification) => notification.update)
    .filter(
      (update) =>
        update.sessionUpdate === "agent_message_chunk" &&
        update.content.type === "text",
    )
    .map((update) =>
      update.sessionUpdate === "agent_message_chunk" &&
      update.content.type === "text"
        ? update.content.text
        : "",
    )
    .join("");

  if (!replayedText.includes(expected)) {
    throw new Error("Resumed session did not replay the completed response");
  }

  return {
    listedCount: listed.sessions.length,
    replayed: true,
  };
});

console.log(
  JSON.stringify(
    {
      ok: true,
      protocol: `ACP v${acp.PROTOCOL_VERSION}`,
      sessionId: firstRun.sessionId,
      completeResponse: firstRun.responseText.trim(),
      streamedUpdates: firstRun.updateCount,
      restartPersistence: secondRun.replayed,
      sessionsForCwd: secondRun.listedCount,
    },
    null,
    2,
  ),
);
