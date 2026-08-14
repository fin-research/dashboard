import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const wrangler = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
const command = fileURLToPath(
  new URL(`../node_modules/.bin/${wrangler}`, import.meta.url),
);

await new Promise((resolve, reject) => {
  const child = spawn(command, ["types", "--include-runtime", "false"], {
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`wrangler types exited with code ${code}`));
  });
});

const declarationUrl = new URL("../worker-configuration.d.ts", import.meta.url);
const generated = await readFile(declarationUrl, "utf8");
const withoutBuildImport = generated.replace(
  /\n\tinterface GlobalProps \{\n\t\tmainModule: typeof import\("\.\/\.svelte-kit\/cloudflare\/_worker"\);\n\t\}\n/,
  "\n",
);
await writeFile(declarationUrl, withoutBuildImport);
