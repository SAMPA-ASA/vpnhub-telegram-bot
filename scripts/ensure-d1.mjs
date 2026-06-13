import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const wranglerEntry = require.resolve("wrangler");
const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const configPath = resolve(rootDir, "wrangler.toml");
const authScriptPath = resolve(rootDir, "scripts", "ensure-cloudflare-auth.mjs");

let cachedWranglerCredentials = null;

function createBaseWranglerEnv(extraEnv = {}) {
    const env = {
        ...process.env,
        ...extraEnv,
    };

    if (!env.CLOUDFLARE_API_TOKEN && env.CF_API_TOKEN) {
        env.CLOUDFLARE_API_TOKEN = env.CF_API_TOKEN;
    }

    // این‌ها مخصوص npm هستند و نباید به Wrangler تحمیل شوند.
    delete env.npm_config_proxy;
    delete env.npm_config_https_proxy;

    return env;
}

function hasCloudflareAuthEnv(env) {
    return Boolean(
        env.CLOUDFLARE_API_TOKEN?.trim() ||
        (env.CLOUDFLARE_API_KEY?.trim() && env.CLOUDFLARE_EMAIL?.trim())
    );
}

function readWranglerAuthToken() {
    const result = spawnSync(process.execPath, [wranglerEntry, "auth", "token", "--json"], {
        cwd: rootDir,
        env: createBaseWranglerEnv(),
        encoding: "utf8",
    });

    if (result.error || result.status !== 0) {
        return null;
    }

    try {
        const parsed = JSON.parse(result.stdout || "{}");

        if (parsed?.token) {
            return {
                type: parsed.type || "token",
                token: parsed.token,
            };
        }

        if (parsed?.key && parsed?.email) {
            return {
                type: "api_key",
                key: parsed.key,
                email: parsed.email,
            };
        }

        return null;
    } catch {
        return null;
    }
}

function ensureOAuthLogin() {
    const result = spawnSync(process.execPath, [authScriptPath], {
        cwd: rootDir,
        env: createBaseWranglerEnv(),
        stdio: "inherit",
    });

    if (result.error) {
        throw new Error(`Failed to start Cloudflare OAuth login: ${result.error.message}`);
    }

    if (result.status !== 0) {
        throw new Error(`Cloudflare OAuth login exited with code ${result.status}.`);
    }
}

function getWranglerCredentials() {
    if (cachedWranglerCredentials) {
        return cachedWranglerCredentials;
    }

    let credentials = readWranglerAuthToken();

    if (!credentials) {
        console.log("Cloudflare API token was not found. Starting Wrangler OAuth login...");
        ensureOAuthLogin();
        credentials = readWranglerAuthToken();
    }

    if (!credentials) {
        throw new Error("Wrangler authentication is required, but no API token or OAuth token could be obtained.");
    }

    cachedWranglerCredentials = credentials;
    return credentials;
}

function applyWranglerCredentials(env, credentials) {
    if (credentials.token) {
        env.CLOUDFLARE_API_TOKEN = credentials.token;
        return;
    }

    if (credentials.key && credentials.email) {
        env.CLOUDFLARE_API_KEY = credentials.key;
        env.CLOUDFLARE_EMAIL = credentials.email;
    }
}

function createWranglerEnv(extraEnv = {}) {
    const env = createBaseWranglerEnv(extraEnv);

    if (!hasCloudflareAuthEnv(env)) {
        applyWranglerCredentials(env, getWranglerCredentials());
    }

    return env;
}

function getTodayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isWranglerAuthFailureOutput(output) {
    return /Authentication error/i.test(output) ||
        /code:\s*10000/i.test(output) ||
        /No API token found/i.test(output) ||
        /non-interactive environment/i.test(output) ||
        /CLOUDFLARE_API_TOKEN/i.test(output) ||
        /user auth missing api token non interactive/i.test(output);
}

function runWrangler(args, extraEnv = {}) {
    const runOnce = () =>
        spawnSync(process.execPath, [wranglerEntry, ...args], {
            cwd: rootDir,
            env: createWranglerEnv(extraEnv),
            encoding: "utf8",
        });

    const result = runOnce();

    if (result.error) {
        throw new Error(`Failed to run wrangler ${args.join(" ")}: ${result.error.message}`);
    }

    if (result.status === 0) {
        return result;
    }

    const output = `${result.stdout || ""}\n${result.stderr || ""}`;

    if (!isWranglerAuthFailureOutput(output)) {
        return result;
    }

    const baseEnv = createBaseWranglerEnv(extraEnv);

    // اگر کاربر خودش API token داده، آن را override نکنیم.
    // در این حالت خطا یعنی token اشتباه/ناکافی است.
    if (hasCloudflareAuthEnv(baseEnv)) {
        return result;
    }

    console.log("Wrangler authentication failed. Re-authenticating with OAuth...");
    cachedWranglerCredentials = null;

    const authResult = spawnSync(process.execPath, [authScriptPath, "--reset"], {
        cwd: rootDir,
        env: baseEnv,
        stdio: "inherit",
    });

    if (authResult.error) {
        throw new Error(`Failed to refresh Cloudflare authentication: ${authResult.error.message}`);
    }

    if (authResult.status !== 0) {
        throw new Error(`Cloudflare authentication refresh exited with code ${authResult.status}.`);
    }

    cachedWranglerCredentials = null;

    const retryResult = runOnce();

    if (retryResult.error) {
        throw new Error(`Failed to run wrangler ${args.join(" ")}: ${retryResult.error.message}`);
    }

    return retryResult;
}

function readConfig() {
  return readFileSync(configPath, "utf8");
}

function normalizeCompatibilityDate(text) {
  const compatibilityDateLine = /^compatibility_date\s*=\s*"([^"]*)"\s*$/m;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const today = getTodayIsoDate();
  const match = text.match(compatibilityDateLine);

  if (match && match[1].trim()) {
    return text;
  }

  const replacement = `compatibility_date = "${today}"`;
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

function getConfigValue(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match ? match[1] : "";
}

function updateDatabaseId(text, databaseId) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const blockMatch = text.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[\[|\s*$)/);
  if (!blockMatch) {
    throw new Error("Could not locate the D1 database block in wrangler.toml.");
  }

  const block = blockMatch[0];
  const idLine = /^(\s*database_id\s*=\s*")[^"]+("\s*)$/m;
  let updatedBlock = block;

  if (idLine.test(block)) {
    updatedBlock = block.replace(idLine, `$1${databaseId}$2`);
  } else {
    const nameLine = /^(\s*database_name\s*=\s*"[^"]+"\s*)$/m;
    if (!nameLine.test(block)) {
      throw new Error("The D1 database block is missing database_name or database_id.");
    }
    updatedBlock = block.replace(nameLine, `$1${newline}  database_id = "${databaseId}"`);
  }

  return text.replace(block, updatedBlock);
}

function writeDatabaseId(databaseId) {
  const original = readConfig();
  const updated = updateDatabaseId(original, databaseId);
  if (updated !== original) {
    writeFileSync(configPath, updated, "utf8");
  }
}

function parseDatabaseList(stdout) {
  const value = stdout.trim();
  if (!value) {
    return [];
  }

  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

function findDatabaseByName(databases, databaseName) {
  return databases.find((db) => db && (db.name === databaseName || db.database_name === databaseName));
}

function getDatabaseId(database) {
  return database.uuid || database.id || database.database_id || "";
}

async function main() {
  const originalConfig = readConfig();
  const normalizedConfig = normalizeCompatibilityDate(originalConfig);
  if (normalizedConfig !== originalConfig) {
    writeFileSync(configPath, normalizedConfig, "utf8");
    console.log(`compatibility_date was empty; using today's date ${getTodayIsoDate()}.`);
  }

  const configText = normalizedConfig;
  const databaseName = getConfigValue(configText, "database_name") || "vpnhub_bot";

  console.log(`Checking D1 database '${databaseName}'...`);
  let listResult = runWrangler(["d1", "list", "--json"]);
  if (listResult.status !== 0) {
    throw new Error(
      `Failed to list D1 databases.\n${listResult.stderr || listResult.stdout || "No output from Wrangler."}`
    );
  }

  let databases = parseDatabaseList(listResult.stdout);
  let database = findDatabaseByName(databases, databaseName);

  if (!database) {
    console.log(`D1 database '${databaseName}' was not found. Creating it...`);
    const createResult = runWrangler(["d1", "create", databaseName], { CI: "1" });
    if (createResult.status !== 0) {
      listResult = runWrangler(["d1", "list", "--json"]);
      if (listResult.status !== 0) {
        throw new Error(
          `Failed to create D1 database '${databaseName}'.\n${createResult.stderr || createResult.stdout || "No output from Wrangler."}`
        );
      }
    }

    listResult = runWrangler(["d1", "list", "--json"]);
    if (listResult.status !== 0) {
      throw new Error(
        `Failed to refresh D1 databases after create.\n${listResult.stderr || listResult.stdout || "No output from Wrangler."}`
      );
    }

    databases = parseDatabaseList(listResult.stdout);
    database = findDatabaseByName(databases, databaseName);

    if (!database) {
      throw new Error(
        `Wrangler did not return the newly created D1 database '${databaseName}'.`
      );
    }
  }

  const databaseId = getDatabaseId(database);
  if (!databaseId) {
    throw new Error(`Database '${databaseName}' was found, but it has no id.`);
  }

  writeDatabaseId(databaseId);
  console.log(`Using D1 database '${databaseName}' (${databaseId}).`);
}

await main();
