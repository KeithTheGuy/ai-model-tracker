// Headless smoke test: runs the inline site script with stub DOM against the
// real data files and asserts the render output. Run: node scripts/smoke-test.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const models = JSON.parse(readFileSync(new URL("../data/models.json", import.meta.url), "utf8"));
const events = JSON.parse(readFileSync(new URL("../data/events.json", import.meta.url), "utf8"));
const src = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];

const captured = {};
function el(id) {
  const store = { style: {}, value: "" };
  return new Proxy(store, {
    get(t, k) {
      if (k === "addEventListener") return () => {};
      if (k === "innerHTML") return t._html || "";
      if (k === "textContent") return t._text || "";
      return t[k];
    },
    set(t, k, v) {
      if (k === "innerHTML") { t._html = v; captured[id + ".html"] = v; }
      else if (k === "textContent") { t._text = v; captured[id + ".text"] = v; }
      else t[k] = v;
      return true;
    },
  });
}

const els = {};
const sandbox = {
  console, Date, Math, JSON, Promise,
  document: { getElementById: id => (els[id] ??= el(id)) },
  setInterval: () => {},
  fetch: url => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(url.includes("events") ? events : models),
  }),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
await new Promise(r => setTimeout(r, 50));

const feedRows = ((captured["feed.html"] || "").match(/class="ev"/g) || []).length;
const tableRows = ((captured["rows.html"] || "").match(/<tr>/g) || []).length;
const statCells = ((captured["stats.html"] || "").match(/class="st"/g) || []).length;

const checks = [
  ["stats rendered (5 cells)", statCells === 5],
  ["feed has events", feedRows >= 10],
  ["feed shows NEW chips", /chip add/.test(captured["feed.html"] || "")],
  ["catalog rows match model count", tableRows === models.models.length],
  ["sync time set", /SYNC/.test(captured["sync.text"] || "")],
  ["prices formatted", /\$\d/.test(captured["rows.html"] || "")],
  ["no error shown", !(captured["err.text"] || "").length],
];

let fail = 0;
for (const [name, ok] of checks) {
  console.log((ok ? "PASS" : "FAIL") + "  " + name);
  if (!ok) fail++;
}
console.log("---");
console.log("feed rows:", feedRows, "| table rows:", tableRows);
console.log("stats:", (captured["stats.html"] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160));
process.exit(fail ? 1 : 0);
