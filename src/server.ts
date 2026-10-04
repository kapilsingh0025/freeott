import "dotenv/config";
import dns from "node:dns";
import express from "express";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import api from "./server/api.js";

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const publicDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "../public");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.text({ type: "application/json", limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", async (req, res, next) => {
  try {
    const result = await api({
      url: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      method: req.method,
      headers: { get: (name) => req.get(name) ?? null },
      text: async () => typeof req.body === "string" ? req.body : "",
    });
    result.headers.forEach((value, name) => res.setHeader(name, value));
    res.status(result.status).send(await result.text());
  } catch (error) {
    next(error);
  }
});

app.use(express.static(publicDirectory, {
  etag: true,
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  setHeaders(res, path) {
    if (path.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
  },
}));

app.use((_req, res) => {
  res.status(404).send("Page not found.");
});

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Request failed:", error);
  if (res.headersSent) return;
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number(error.status)
    : 500;
  if (req.path.startsWith("/api/")) {
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: status === 413 ? "Request is too large." : "The server could not complete the request." });
    return;
  }
  res.status(500).send("The server could not complete the request.");
});

const server = app.listen(port, host, () => {
  console.log(`just99 is listening on http://${host}:${port}`);
  if (!process.env.MONGODB_URI) console.warn("MONGODB_URI is not configured; authentication and data routes will be unavailable.");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close((error) => {
      if (error) {
        console.error("Failed to shut down cleanly:", error);
        process.exitCode = 1;
      }
    });
  });
}
