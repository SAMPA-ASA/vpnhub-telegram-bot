import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const wranglerEntry = require.resolve("wrangler");
const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const authScriptPath = resolve(rootDir, "scripts", "ensure-cloudflare-auth.mjs");

function createWranglerEnv() {
  const env = {
    ...process.env,
  };
  
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CF_API_TOKEN;
  delete env.CLOUDFLARE_API_KEY;
  delete env.CLOUDFLARE_EMAIL;

  const storedToken = getStoredWranglerToken();
  if (storedToken) {
    env.CLOUDFLARE_API_TOKEN = storedToken;
  }

  return env;
}

function getStoredWranglerToken() {
  const authPath = process.env.APPDATA
    ? resolve(process.env.APPDATA, "xdg.config", ".wrangler", "config", "default.toml")
    : resolve(process.env.USERPROFILE || "", ".wrangler", "config", "default.toml");

  try {
    const text = readFileSync(authPath, "utf8");
    const tokenMatch = text.match(/^\s*(oauth_token|access_token)\s*=\s*"([^"]+)"/m);
    return tokenMatch ? tokenMatch[2] : "";
  } catch {
    return "";
  }
}

function main() {
  const args = process.argv.slice(2);
    const runOnce = () => {
        const result = spawnSync(process.execPath, [wranglerEntry, ...args], {
            cwd: rootDir,
            env: createWranglerEnv(),
            encoding: "utf8",
            stdio: ["inherit", "pipe", "pipe"],
        });

        if (result.stdout) {
            process.stdout.write(result.stdout);
        }

        if (result.stderr) {
            process.stderr.write(result.stderr);
        }

        return result;
    };

  let result = runOnce();

  if (result.error) {
    throw new Error(`Failed to run wrangler ${args.join(" ")}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (/Authentication error/i.test(output) || /code:\s*10000/i.test(output) || /No API token found/i.test(output)) {
      console.log("Wrangler authentication failed. Re-authenticating...");
      const authResult = spawnSync(process.execPath, [authScriptPath, "--reset"], {
        cwd: rootDir,
        env: createWranglerEnv(),
        stdio: "inherit",
      });

      if (authResult.error) {
        throw new Error(`Failed to refresh Cloudflare authentication: ${authResult.error.message}`);
      }

      if (authResult.status !== 0) {
        throw new Error(`Cloudflare authentication refresh exited with code ${authResult.status}.`);
      }

      result = runOnce();
      if (result.error) {
        throw new Error(`Failed to run wrangler ${args.join(" ")}: ${result.error.message}`);
      }
    }
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}

main();
