const suites = [
  await import("../test/extraction.test.js"),
  await import("../test/storage.test.js"),
  await import("../test/bot.test.js"),
  await import("../test/webhook.test.js"),
];

let passed = 0;
let failed = 0;

for (const suite of suites) {
  for (const entry of suite.tests || []) {
    try {
      await entry.fn();
      console.log(`✓ ${entry.name}`);
      passed += 1;
    } catch (error) {
      failed += 1;
      console.error(`✗ ${entry.name}`);
      console.error(error);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
