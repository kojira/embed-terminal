import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";
import chat from "./routes/chat.js";

const app = new Hono();

app.use("/api/*", cors());

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    provider: process.env.AI_PROVIDER ?? "claude",
  }),
);

app.route("/api/chat", chat);

const port = 3456;

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`CLI chat server listening on http://localhost:${info.port}`);
  },
);
