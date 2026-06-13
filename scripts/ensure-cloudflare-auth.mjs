import { createRequire } from "node:module";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const wranglerEntry = require.resolve("wrangler");
const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const authCwd = join(tmpdir(), "vpnhub-wrangler-auth");
mkdirSync(authCwd, { recursive: true });

function createWranglerEnv({ stripAuth = false } = {}) {
    const env = {
        ...process.env,
    };

    // پشتیبانی از alias قدیمی/رایج، ولی Wrangler رسماً CLOUDFLARE_API_TOKEN را می‌خواند.
    if (!env.CLOUDFLARE_API_TOKEN && env.CF_API_TOKEN) {
        env.CLOUDFLARE_API_TOKEN = env.CF_API_TOKEN;
    }

    // برای login/logout باید auth env حذف شود تا OAuth واقعاً اجرا شود.
    if (stripAuth) {
        delete env.CLOUDFLARE_API_TOKEN;
        delete env.CF_API_TOKEN;
        delete env.CLOUDFLARE_API_KEY;
        delete env.CLOUDFLARE_EMAIL;
    }

    return env;
}

function hasExplicitToken() {
    return Boolean(
        process.env.CLOUDFLARE_API_TOKEN?.trim() ||
        process.env.CF_API_TOKEN?.trim()
    );
}

function getAuthConfigPath() {
    if (process.env.APPDATA) {
        return join(process.env.APPDATA, "xdg.config", ".wrangler", "config", "default.toml");
    }

    return join(process.env.USERPROFILE || "", ".wrangler", "config", "default.toml");
}

function runWrangler(args, { stdio = "pipe", stripAuth = false } = {}) {
    return spawnSync(process.execPath, [wranglerEntry, ...args], {
        cwd: authCwd,
        env: createWranglerEnv({ stripAuth }),
        encoding: stdio === "pipe" ? "utf8" : undefined,
        stdio,
    });
}

function getWranglerAuthToken() {
    const result = runWrangler(["auth", "token", "--json"]);

    if (result.error || result.status !== 0) {
        return null;
    }

    try {
        const parsed = JSON.parse(result.stdout || "{}");
        if (parsed?.token) {
            return parsed;
        }

        if (parsed?.key && parsed?.email) {
            return parsed;
        }

        return null;
    } catch {
        return null;
    }
}

function isWhoamiOk() {
    const result = runWrangler(["whoami"]);

    if (result.error || result.status !== 0) {
        return false;
    }

    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    return !/Authentication error/i.test(output) &&
        !/code:\s*10000/i.test(output) &&
        !/No API token found/i.test(output) &&
        !/CLOUDFLARE_API_TOKEN/i.test(output);
}

function clearStoredAuth() {
    const authPath = getAuthConfigPath();
    if (existsSync(authPath)) {
        rmSync(authPath, { force: true });
    }
}

function logoutStoredAuth() {
    const result = runWrangler(["logout"], {
        stdio: "inherit",
        stripAuth: true,
    });

    if (result.error) {
        console.log(`Wrangler logout failed: ${result.error.message}`);
        return;
    }

    if (result.status !== 0) {
        console.log(`Wrangler logout exited with code ${result.status}; clearing stored auth anyway.`);
    }
}

function loginWithWrangler() {
    const result = runWrangler(["login"], {
        stdio: "inherit",
        stripAuth: true,
    });

    if (result.error) {
        throw new Error(`Failed to start wrangler login: ${result.error.message}`);
    }

    return result.status === 0;
}

function loginWithRecovery() {
    console.log("Opening Wrangler OAuth login...");
    if (loginWithWrangler()) {
        return;
    }

    console.log("Wrangler login failed. Logging out local session and trying again...");
    logoutStoredAuth();
    clearStoredAuth();

    if (loginWithWrangler()) {
        return;
    }

    clearStoredAuth();
    throw new Error("Wrangler OAuth login failed after clearing stored auth.");
}

function parseFlags(argv) {
    return new Set(argv.slice(2));
}

function main() {
    const flags = parseFlags(process.argv);
    const forceReset = flags.has("--reset");

    if (hasExplicitToken() && !forceReset) {
        if (isWhoamiOk()) {
            return;
        }

        console.log("CLOUDFLARE_API_TOKEN/CF_API_TOKEN is set, but Wrangler could not authenticate with it.");
        console.log("Ignoring the invalid token and using Wrangler OAuth for this run.");

        delete process.env.CLOUDFLARE_API_TOKEN;
        delete process.env.CF_API_TOKEN;
        delete process.env.CLOUDFLARE_API_KEY;
        delete process.env.CLOUDFLARE_EMAIL;

        // اگر OAuth قبلاً ذخیره شده باشد، بدون reset و بدون login مجدد از همان استفاده کن.
        if (getWranglerAuthToken()) {
            return;
        }

        console.log("No usable Wrangler OAuth session found. Starting Wrangler OAuth login...");
        loginWithRecovery();

        if (!getWranglerAuthToken()) {
            throw new Error("OAuth login completed, but Wrangler did not return an auth token.");
        }

        return;
    }

    if (forceReset) {
        console.log("Resetting Cloudflare OAuth session before login...");
        logoutStoredAuth();
        clearStoredAuth();
        loginWithRecovery();
        return;
    }

    // اگر OAuth قبلاً انجام شده باشد، این فرمان باید credential فعال را برگرداند.
    if (getWranglerAuthToken()) {
        return;
    }

    console.log("Cloudflare API token was not found. Starting Wrangler OAuth login...");
    loginWithRecovery();

    if (!getWranglerAuthToken()) {
        throw new Error("OAuth login completed, but Wrangler did not return an auth token.");
    }
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}