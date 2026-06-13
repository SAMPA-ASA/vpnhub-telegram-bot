import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const configPath = resolve(rootDir, "wrangler.toml");

function getLocalISODate() {
  const now = new Date();
  const yyyy = String(now.getFullYear()).padStart(4, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function getFallbackCompatibilityDate() {
  const value = process.env.CF_COMPATIBILITY_DATE?.trim() || getLocalISODate();

  if (!isValidISODate(value)) {
    throw new Error(
      `CF_COMPATIBILITY_DATE must be a valid ISO date in YYYY-MM-DD format, but got "${value}".`
    );
  }

  return value;
}

function main() {
  if (!existsSync(configPath)) {
    throw new Error(`wrangler.toml was not found at ${configPath}`);
  }

  const fallbackDate = getFallbackCompatibilityDate();
  let text = readFileSync(configPath, "utf8");

  const compatibilityLinePattern =
    /^(\s*compatibility_date\s*=\s*)(["'])(.*?)\2(\s*(?:#.*)?)$/m;

  const match = text.match(compatibilityLinePattern);

  if (match) {
    const currentValue = match[3].trim();

    if (currentValue && !isValidISODate(currentValue)) {
      throw new Error(
        `wrangler.toml has an invalid compatibility_date: "${currentValue}". Expected YYYY-MM-DD.`
      );
    }

    if (!currentValue) {
      text = text.replace(
        compatibilityLinePattern,
        `$1"${fallbackDate}"$4`
      );

      writeFileSync(configPath, text);
      console.log(`Updated empty compatibility_date to "${fallbackDate}" in wrangler.toml.`);
    }

    return;
  }

  const lineToInsert = `compatibility_date = "${fallbackDate}"`;

  if (/^main\s*=.*$/m.test(text)) {
    text = text.replace(/^main\s*=.*$/m, (line) => `${line}\n${lineToInsert}`);
  } else if (/^name\s*=.*$/m.test(text)) {
    text = text.replace(/^name\s*=.*$/m, (line) => `${line}\n${lineToInsert}`);
  } else {
    text = `${lineToInsert}\n${text}`;
  }

  writeFileSync(configPath, text);
  console.log(`Added compatibility_date = "${fallbackDate}" to wrangler.toml.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}