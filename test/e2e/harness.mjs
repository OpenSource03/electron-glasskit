// A minimal test runner for code that has to run inside Electron's main process.
const tests = [];

export function test(name, run) {
  tests.push({ name, run });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check` returns something truthy, and returns it. */
export async function until(check, { timeout = 5000, what = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(25);
  }
}

export async function run(filter) {
  let failed = 0;
  for (const { name, run: body } of tests) {
    if (filter && !name.includes(filter)) continue;
    try {
      await body();
      console.log(`ok   ${name}`);
    } catch (error) {
      failed += 1;
      console.log(
        `FAIL ${name}\n     ${String(error?.stack ?? error)
          .split("\n")
          .join("\n     ")}`,
      );
    }
  }
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  return failed;
}
