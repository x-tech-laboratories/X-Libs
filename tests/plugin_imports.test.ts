import { describe, expect, it } from "vitest";
import { load_plugin_modules, rewrite_imports, share_modules } from "../src/web/plugin_imports.ts";

const shared_library = { greet: (name: string) => `hello ${name}`, default: { kind: "library" } };
share_modules({ "shared-library": shared_library });

function served(files: Record<string, string>): (url: string) => Promise<string> {
  return async (url) => {
    const text = files[url];
    if (text === undefined) throw new Error(`${url} answered 404.`);
    return text;
  };
}

describe("plugin imports", () => {
  it("points shared imports at the page's copy and relative ones at the plugin's folder", async () => {
    const source = `import lib, { greet } from "shared-library";\nimport "./style.js";\nconst later = import("../other/thing.js");\nimport.meta.url;\nimport(name);`;
    const rewritten = await rewrite_imports(source, "https://app.test/plugins/hello/dist/web.js");

    expect(rewritten).toMatch(/^import lib, \{ greet \} from "data:text\/javascript;charset=utf-8,/);
    expect(rewritten).toContain(`import "https://app.test/plugins/hello/dist/style.js";`);
    expect(rewritten).toContain(`import("https://app.test/plugins/hello/other/thing.js")`);
    expect(rewritten).toContain("import.meta.url;\nimport(name);");
  });

  it("refuses a bare import the page does not share", async () => {
    await expect(rewrite_imports(`import { thing } from "left-pad";`, "https://app.test/p.js")).rejects.toThrow("It imports left-pad, which the app does not share; bundle it into the plugin.");
  });

  it("loads each listed entry with the page's shared module, and reports those that fail", async () => {
    const fetch_text = served({
      "https://app.test/plugins/index.json": JSON.stringify({ entries: ["hello/web.js", "named/web.js", "broken/web.js"], problems: [{ name: "unbuilt", problem: "Its web entry is missing." }] }),
      "https://app.test/plugins/hello/web.js": `import lib, { greet } from "shared-library";\nexport default { id: "x.hello", name: greet("plugin") + " " + lib.kind, version: "1.0.0", start() {} };`,
      "https://app.test/plugins/named/web.js": `export const plugin = { id: "x.named", name: "Named", version: "1.0.0", start() {} };`,
      "https://app.test/plugins/broken/web.js": `import "react";`,
    });

    const { plugins, problems } = await load_plugin_modules("https://app.test/plugins/index.json", fetch_text);
    expect(plugins.map((plugin) => [plugin.id, plugin.name])).toEqual([["x.hello", "hello plugin library"], ["x.named", "Named"]]);
    expect(problems).toEqual([
      { name: "unbuilt", problem: "Its web entry is missing." },
      { name: "https://app.test/plugins/broken/web.js", problem: "It imports react, which the app does not share; bundle it into the plugin." },
    ]);
  });
});
