#!/usr/bin/env node
// Stands in for a Claude Code session in stream-json mode: says init, echoes each user message it reads, asks whether
// a tool may run when a message says "ask", answers interrupt and set_permission_mode requests, refuses others, and
// ends with a result once its input closes.

import { createInterface } from "node:readline";

const say = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const answers = new Map();
let mode = "default";
let asked = 0;

say({ type: "system", subtype: "init", model: "stand-in-model", permissionMode: mode });
process.stdout.write("not json\n");

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.type === "user") {
    const text = message.message.content[0].text;
    say({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, uuid: message.uuid, isReplay: true });
    if (text === "ask") {
      const request_id = `perm_${++asked}`;
      say({ type: "control_request", request_id, request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls -l" } } });
      answers.set(request_id, true);
    } else if (text === "unknown request") {
      say({ type: "control_request", request_id: "other_1", request: { subtype: "mcp_message" } });
    } else {
      say({ type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: `heard ${text}` }] } });
    }
  } else if (message.type === "control_request") {
    const subtype = message.request.subtype;
    if (subtype === "interrupt") say({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: {} } });
    else if (subtype === "set_permission_mode") {
      mode = message.request.mode;
      say({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: { mode } } });
    } else if (subtype === "never_answer") {
      // Left waiting on purpose.
    } else say({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: `no ${subtype}` } });
  } else if (message.type === "control_response") {
    const response = message.response;
    say({ type: "assistant", message: { id: `msg_answer_${response.request_id}`, content: [{ type: "text", text: `${response.subtype} ${response.request_id} ${JSON.stringify(response.response ?? response.error)}` }] } });
  }
}

say({ type: "result", subtype: "success", is_error: false, result: "done" });
