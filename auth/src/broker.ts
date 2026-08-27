import { createServer, type Server } from "node:net";
import { createServer as createTlsServer, type Server as TlsServer } from "node:tls";
import { readFileSync } from "node:fs";
import aedesModule from "aedes";
import { decideAcl, decideAuth } from "./access.js";
import type { Store } from "./store.js";

type AedesHandle = (stream: unknown) => void;
type AedesBroker = {
  handle: AedesHandle;
  close?: (cb?: (err?: Error | null) => void) => void;
};

function createAedes(options: Record<string, unknown>): AedesBroker {
  const factory = aedesModule as unknown as (opts: Record<string, unknown>) => AedesBroker;
  return factory(options);
}

export interface BrokerTlsOptions {
  port: number;
  certPath: string;
  keyPath: string;
}

export interface EmbeddedBroker {
  aedes: AedesBroker;
  server: Server;
  tlsServer?: TlsServer;
  close(): Promise<void>;
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

export async function startEmbeddedBroker(input: {
  store: Store;
  bridgeSecret: string;
  port: number;
  listenHost?: string;
  tls?: BrokerTlsOptions;
}): Promise<EmbeddedBroker> {
  const aedes = createAedes({
    authenticate(
      client: { id: string; user?: string },
      username: string | undefined,
      password: Buffer | undefined,
      done: (err: Error | null, success?: boolean) => void,
    ) {
      void decideAuth(input.store, {
        clientid: client.id,
        username: String(username ?? ""),
        password: Buffer.isBuffer(password)
          ? password.toString("utf8")
          : password instanceof Uint8Array
            ? Buffer.from(password).toString("utf8")
            : String(password ?? ""),
      }, input.bridgeSecret).then((result) => {
        if (result.result !== "allow") {
          done(null, false);
          return;
        }
        client.user = String(username ?? "");
        done(null, true);
      }).catch(() => done(null, false));
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
      void decideAcl(input.store, {
        clientid: client.id,
        username: client.user ?? "",
        topic: packet.topic,
        action: "publish",
      }).then((result) => {
        done(result.result === "allow" ? null : new Error("acl deny"));
      }).catch(() => done(new Error("acl deny")));
    },
    authorizeSubscribe(
      client: { id: string; user?: string },
      sub: { topic: string },
      done: (err: Error | null, subscription?: { topic: string } | null) => void,
    ) {
      void decideAcl(input.store, {
        clientid: client.id,
        username: client.user ?? "",
        topic: sub.topic,
        action: "subscribe",
      }).then((result) => {
        done(null, result.result === "allow" ? sub : null);
      }).catch(() => done(null, null));
    },
  });

  const listenHost = input.listenHost ?? "0.0.0.0";
  const server = createServer(aedes.handle);
  await listen(server, input.port, listenHost);
  console.log(`[broker] MQTT plaintext on ${listenHost}:${input.port}`);

  let tlsServer: TlsServer | undefined;
  if (input.tls) {
    tlsServer = createTlsServer({
      cert: readFileSync(input.tls.certPath),
      key: readFileSync(input.tls.keyPath),
    }, aedes.handle);
    await listen(tlsServer, input.tls.port, "0.0.0.0");
    console.log(`[broker] MQTTS on 0.0.0.0:${input.tls.port}`);
  }

  return {
    aedes,
    server,
    tlsServer,
    async close() {
      await Promise.all([
        closeServer(server),
        tlsServer ? closeServer(tlsServer) : Promise.resolve(),
      ]);
      await new Promise<void>((resolve) => {
        if (typeof aedes.close !== "function") {
          resolve();
          return;
        }
        aedes.close(() => resolve());
      });
    },
  };
}
