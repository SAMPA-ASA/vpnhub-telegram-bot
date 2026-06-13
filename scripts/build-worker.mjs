import { createRequire } from "node:module";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const wranglerEntry = require.resolve("wrangler");
const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const configPath = resolve(rootDir, "wrangler.toml");
const tempConfigPath = resolve(rootDir, `.wrangler.build.${process.pid}.toml`);
const authScriptPath = resolve(rootDir, "scripts", "ensure-cloudflare-auth.mjs");

function createWranglerEnv() {
  const env = {
    ...process.env,
  };

  delete env.CF_PROXY_URL;
  delete env.HTTPS_PROXY;
  delete env.HTTP_PROXY;
  delete env.https_proxy;
  delete env.http_proxy;
  delete env.ALL_PROXY;
  delete env.all_proxy;
  delete env.npm_config_proxy;
  delete env.npm_config_https_proxy;
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

function getTodayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readConfig() {
  return readFileSync(configPath, "utf8");
}

function normalizeCompatibilityDate(text) {
  const compatibilityDateLine = /^compatibility_date\s*=\s*"([^"]*)"\s*$/m;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const fallbackCompatibilityDate = getTodayIsoDate();
  const match = text.match(compatibilityDateLine);

  if (match && match[1].trim()) {
    return text;
  }

  const replacement = `compatibility_date = "${fallbackCompatibilityDate}"`;
  if (match) {
    return text.replace(compatibilityDateLine, replacement);
  }

  const mainLine = /^main\s*=\s*"[^"]*"\s*$/m;
  if (mainLine.test(text)) {
    return text.replace(mainLine, (line) => `${line}${newline}${replacement}`);
  }

  const nameLine = /^name\s*=\s*"[^"]*"\s*$/m;
  if (nameLine.test(text)) {
    return text.replace(nameLine, (line) => `${line}${newline}${replacement}`);
  }

  return `${replacement}${newline}${text}`;
}

function runWrangler(args) {
  const runOnce = () =>
    spawnSync(process.execPath, [wranglerEntry, ...args], {
      cwd: rootDir,
      encoding: "utf8",
      env: createWranglerEnv(),
    });

  let result = runOnce();

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

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

      if (result.stdout) {
        process.stdout.write(result.stdout);
      }

      if (result.stderr) {
        process.stderr.write(result.stderr);
      }

      if (result.error) {
        throw new Error(`Failed to run wrangler ${args.join(" ")}: ${result.error.message}`);
      }
    }
  }

  if (result.status !== 0) {
    throw new Error(`Wrangler exited with code ${result.status}.`);
  }
}

function main() {
  const originalConfig = readConfig();
  const normalizedConfig = normalizeCompatibilityDate(originalConfig);
  const configToUse = normalizedConfig === originalConfig ? configPath : tempConfigPath;

  if (configToUse === tempConfigPath) {
    writeFileSync(tempConfigPath, normalizedConfig, "utf8");
    console.log(
      `compatibility_date was empty; using today's date ${getTodayIsoDate()} for this build.`
    );
  }

  try {
    runWrangler(["deploy", "--dry-run", "--outdir", "build", "--config", configToUse, ...process.argv.slice(2)]);
  } finally {
    if (configToUse === tempConfigPath && existsSync(tempConfigPath)) {
      unlinkSync(tempConfigPath);
    }
  }
}

main();
