import type http from "node:http";
import express from "express";
import type { Service } from "./project/service.ts";
import { apiRouter } from "./routes/index.ts";
import { uiRouter } from "./routes/ui.ts";
import type { Store } from "./services/StoreService.ts";

export type ServerOptions = {
  store: Store;
  service: Service;
  token: string;
  /** Built UI directory. When missing (dev), run the Vite dev server instead. */
  uiDir: string | null;
  onStop: () => void;
};

export function createApp({ store, service, token, uiDir, onStop }: ServerOptions) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", apiRouter({ store, service, token, onStop }));
  app.use(uiRouter(uiDir));
  return app;
}

export function listen(app: express.Express, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve(server)));
  });
}
