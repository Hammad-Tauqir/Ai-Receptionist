import { createServer } from "node:http";

// Development checks only. No external requests, calendar APIs, lead storage or content logs.
createServer(async (request, response) => {
  if (request.method === "GET") { response.writeHead(200).end("Mock endpoint ready"); return; }
  const expected = `Basic ${Buffer.from("test-user:test-password").toString("base64")}`;
  if (request.headers.authorization !== expected) { response.writeHead(401).end(); return; }
  let body = "";
  for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  if (input.action !== "sendMessage" || typeof input.chatInput !== "string" || !input.sessionId) {
    response.writeHead(400).end(); return;
  }
  setTimeout(() => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ output: "**Test reply — example only.**\n\nYour message reached the local test endpoint.\n\n- No booking was made.\n- No lead was saved.\n\n[Example link](https://example.com)" }));
  }, 900);
}).listen(3199, "127.0.0.1");
