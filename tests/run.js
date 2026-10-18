import { readFile } from "node:fs/promises";
import { parseCSV } from "../js/data.js";
import { runTests } from "./pricing.test.js";

const names = ["seasons", "hotels", "golf", "transfers", "extras", "offers", "fx", "settings"];
const data = Object.fromEntries(await Promise.all(names.map(async (name) => {
  const { headers, records } = parseCSV(await readFile(new URL(`../data/${name}.csv`, import.meta.url), "utf8"));
  return [name, { headers, records, loadError: null }];
})));
const result = await runTests(data);
for (const test of result.results) {
  console.log(`${test.passed ? "PASS" : "FAIL"} ${test.name}${test.error ? `: ${test.error}` : ""}`);
}
console.log(`\n${result.passed}/${result.total} tests passed`);
if (result.failed.length) process.exitCode = 1;
