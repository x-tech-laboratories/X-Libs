// Copies the Halon stylesheets next to the compiled page modules, since the compiler only writes scripts.

import { copyFileSync, readdirSync } from "node:fs";

for (const name of readdirSync("src/web").filter((name) => name.endsWith(".css"))) {
  copyFileSync(`src/web/${name}`, `dist/web/${name}`);
}
