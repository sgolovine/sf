import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  routes,
  TOKEN_HEADER,
  validateCommand,
  type Capabilities,
  type CommandResultRequest,
  type EnqueueCommandRequest,
  type PostMessageRequest,
  type ServerEvent,
} from "@sf/protocol";
import type { Store } from "./store.ts";

const MAX_WAIT_SECONDS = 60;

export type ServerOptions = {
  store: Store;
  token: string;
  /** Built UI directory. When missing (dev), run the Vite dev server instead. */
  uiDir: string | null;
  onRequest: () => void;
  onStop: () => void;
};

export function createApp({ store, token, uiDir, onRequest, onStop }: ServerOptions) {
  const app = express();
  app.use((_req, _res, next) => {
    onRequest();
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const given = req.get(TOKEN_HEADER);
    if (given !== token) return void res.status(403).json({ error: "bad token" });
    next();
  });

  app.get(routes.state, (_req, res) => {
    res.json(store.state);
  });

  app.get(routes.events, (req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const send = () => {
      const event: ServerEvent = { type: "state", state: store.state };
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send();
    store.on("state", send);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      store.off("state", send);
    });
  });

  // UI → host: enqueue a command.
  app.post(routes.commands, (req, res) => {
    const { command } = (req.body ?? {}) as Partial<EnqueueCommandRequest>;
    const error = validateCommand(command);
    if (error) return void res.status(400).json({ error });
    res.json(store.enqueue(command!));
  });

  // Host: long-poll for the next command. 204 when nothing arrived in time.
  app.get(routes.nextCommand, (req, res) => {
    const claimed = store.claim();
    if (claimed) return void res.json(claimed);

    const waitSeconds = Math.min(Number(req.query.wait ?? 25) || 0, MAX_WAIT_SECONDS);
    const unlisten = store.listen();
    const cleanup = () => {
      clearTimeout(timer);
      store.off("command", onCommand);
      unlisten();
    };
    const onCommand = () => {
      const record = store.claim();
      if (!record) return;
      cleanup();
      res.json(record);
    };
    const timer = setTimeout(() => {
      cleanup();
      res.status(204).end();
    }, waitSeconds * 1000);
    store.on("command", onCommand);
    res.on("close", () => {
      if (!res.writableEnded) cleanup();
    });
  });

  app.post("/api/commands/:id/result", (req, res) => {
    const body = req.body as CommandResultRequest;
    if (typeof body?.ok !== "boolean") return void res.status(400).json({ error: "body.ok must be a boolean" });
    const record = store.finish(String(req.params.id), body);
    if (!record) return void res.status(404).json({ error: "no such command" });
    res.json(record);
  });

  app.post(routes.capabilities, (req, res) => {
    store.setCapabilities(req.body as Capabilities);
    res.json(store.state.host);
  });

  app.post(routes.messages, (req, res) => {
    const body = req.body as PostMessageRequest;
    if (typeof body?.text !== "string" || !body.text.trim())
      return void res.status(400).json({ error: "text must be a non-empty string" });
    res.json(store.addMessage(body));
  });

  app.get(routes.fileChanges, (req, res) => {
    const since = Number(req.query.since ?? 0);
    res.json({ changes: store.state.fileChanges.filter((c) => c.at > since) });
  });

  app.post(routes.stop, (_req, res) => {
    res.json({ ok: true });
    setTimeout(onStop, 50);
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  if (uiDir && fs.existsSync(path.join(uiDir, "index.html"))) {
    app.use(express.static(uiDir, { index: false }));
    app.get("/{*path}", (_req, res) => {
      res.set("cache-control", "no-store").sendFile("index.html", { root: uiDir });
    });
  } else {
    app.get("/", (_req, res) => {
      res.type("text").send("sf-factory API is running. No built UI found; start the web dev server with `pnpm dev:web`.");
    });
  }

  return app;
}

export function listen(app: express.Express, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve(server)));
  });
}
