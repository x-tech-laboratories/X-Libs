// The sample app's daemon as its own program, as the desktop window starts it.

import { run_daemon } from "../../src/app/daemon.ts";
import { sample_app } from "./sample_app.ts";

await run_daemon(sample_app);
