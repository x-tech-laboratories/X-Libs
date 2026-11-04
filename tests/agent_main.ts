// Starts an agent as its own process from its environment, as an app's agent runs on a host.

import { start_agent } from "../src/agent/client.ts";
import { shell_app } from "../src/agent/protocol.ts";
import { shell_runner } from "../src/agent/tasks.ts";

const agent = start_agent({
  app: shell_app("x-test"),
  runner: shell_runner("x-test-run"),
  url: process.env.X_TEST_AGENT_URL!,
  key_file: process.env.X_TEST_AGENT_KEY_FILE,
  token_file: process.env.X_TEST_AGENT_TOKEN_FILE,
  state_directory: process.env.X_TEST_AGENT_STATE_DIR!,
  host: process.env.X_TEST_AGENT_HOST || "odin-box",
  agent_version: "test",
  backoff_initial_in_milliseconds: 50,
  backoff_longest_in_milliseconds: 200,
  log: () => {},
});

process.once("SIGTERM", () => void agent.stop().then(() => process.exit(0)));
