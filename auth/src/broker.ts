import { createServer, type Server } from "node:net";
import aedesModule from "aedes";
import { decideAcl, decideAuth } from "./access.js";
import type { FileStore } from "./store.js";

type AedesHandle = (stream: unknown) => void;
type AedesBroker = { handle: AedesHandle };

function createAedes(options: Record<string, unknown>): AedesBroker {
  const factory = aedesModule as unknown as (opts: Record<string, unknown>) => AedesBroker;
  return factory(options);
}

export function startEmbeddedBroker(input: {
  store: FileStore;
  bridgeSecret: string;
  port: number;
}): Promise<{ aedes: AedesBroker; server: Server }> {
  const aedes = createAedes({
    authenticate(
      client: { id: string; user?: string },
      username: string | undefined,
      password: Buffer | undefined,
      done: (err: Error | null, success?: boolean) => void,
    ) {
      const result = decideAuth(input.store, {
        clientid: client.id,
        username: String(username ?? ""),
        password: password?.toString() ?? "",
      }, input.bridgeSecret);
      if (result.result !== "allow") {
        done(null, false);
        return;
      }
      client.user = String(username ?? "");
      done(null, true);
    },
    authorizePublish(
      client: { id: string; user?: string } | null,
      packet: { topic: string },
      done: (err: Error | null) => void,
    ) {
      if (!client) {
        done(new Error("no client"));
        return;
      }
      const result = decideAcl(input.store, {
        clientid: client.id,
        username: client.user ?? "",
        topic: packet.topic,
        action: "publish",
      });
      done(result.result === "allow" ? null : new Error("acl deny"));
    },
    authorizeSubscribe(
      client: { id: string; user?: string },
      sub: { topic: string },
      done: (err: Error | null, subscription?: { topic: string } | null) => void,
    ) {
      const result = decideAcl(input.store, {
        clientid: client.id,
        username: client.user ?? "",
        topic: sub.topic,
        action: "subscribe",
      });
      done(null, result.result === "allow" ? sub : null);
    },
  });

  const server = createServer(aedes.handle);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, "0.0.0.0", () => {
      console.log(`[broker] embedded MQTT on :${input.port}`);
      resolve({ aedes, server });
    });
  });
}
