// Pulls the OpenRouter model catalog (free, no key), diffs it against the last
// snapshot, and appends typed events (add/remove/price/context) to the feed.
// Writes data/models.json + data/events.json. Runs locally and in CI.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const API = "https://openrouter.ai/api/v1/models";
const MODELS_OUT = new URL("../data/models.json", import.meta.url);
const EVENTS_OUT = new URL("../data/events.json", import.meta.url);
const MAX_EVENTS = 800;
const SEED_DAYS = 45;

async function getCatalog(attempt = 0) {
  try {
    const res = await fetch(API, { headers: { "User-Agent": "modelwatch/1.0 (github.com/KeithTheGuy/ai-model-tracker)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.data)) throw new Error("unexpected shape");
    return json.data;
  } catch (err) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      return getCatalog(attempt + 1);
    }
    throw err;
  }
}

// $/token string -> $/million tokens, rounded to avoid float noise
const perM = s => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 1e6 * 1e4) / 1e4 : null;
};

function trim(raw) {
  return {
    id: raw.id,
    name: (raw.name || raw.id).replace(/^[^:]+:\s*/, ""),
    lab: raw.id.split("/")[0],
    created: raw.created ?? null,
    ctx: raw.context_length ?? null,
    in: perM(raw.pricing?.prompt),
    out: perM(raw.pricing?.completion),
    mod: raw.architecture?.modality ?? null,
  };
}

const catalog = (await getCatalog()).map(trim);

// A wildly shrunken catalog is an API glitch, not mass extinction — bail out
// rather than writing garbage events.
if (catalog.length < 100) {
  console.log(`Catalog suspiciously small (${catalog.length}); skipping this run.`);
  process.exit(0);
}

const now = Math.floor(Date.now() / 1000);
const prev = existsSync(MODELS_OUT) ? JSON.parse(readFileSync(MODELS_OUT, "utf8")) : null;
const feed = existsSync(EVENTS_OUT) ? JSON.parse(readFileSync(EVENTS_OUT, "utf8")) : { events: [] };
const events = [];

if (!prev) {
  // First run: synthesize "added" events from creation dates so the feed has
  // real history on day one.
  for (const m of catalog) {
    if (m.created && m.created > now - SEED_DAYS * 86400) {
      events.push({ t: m.created, e: "add", id: m.id, name: m.name, lab: m.lab, d: { in: m.in, out: m.out, ctx: m.ctx } });
    }
  }
  console.log(`Seeded feed with ${events.length} releases from the last ${SEED_DAYS} days.`);
} else {
  const old = new Map(prev.models.map(m => [m.id, m]));
  const cur = new Map(catalog.map(m => [m.id, m]));

  const removed = [...old.keys()].filter(id => !cur.has(id));
  if (removed.length > 30) {
    console.log(`Refusing to record ${removed.length} simultaneous removals (likely API glitch).`);
    process.exit(0);
  }
  for (const id of removed) {
    const m = old.get(id);
    events.push({ t: now, e: "rm", id, name: m.name, lab: m.lab, d: {} });
  }
  for (const m of catalog) {
    const o = old.get(m.id);
    if (!o) {
      events.push({ t: m.created && m.created > now - 7 * 86400 ? m.created : now, e: "add", id: m.id, name: m.name, lab: m.lab, d: { in: m.in, out: m.out, ctx: m.ctx } });
      continue;
    }
    if ((o.in !== m.in || o.out !== m.out) && m.in != null && o.in != null) {
      events.push({ t: now, e: "price", id: m.id, name: m.name, lab: m.lab, d: { in: [o.in, m.in], out: [o.out, m.out] } });
    }
    if (o.ctx !== m.ctx && o.ctx && m.ctx) {
      events.push({ t: now, e: "ctx", id: m.id, name: m.name, lab: m.lab, d: { ctx: [o.ctx, m.ctx] } });
    }
  }
}

const allEvents = [...feed.events, ...events]
  .sort((a, b) => a.t - b.t)
  .slice(-MAX_EVENTS);

writeFileSync(MODELS_OUT, JSON.stringify({ updated: now, models: catalog }));
writeFileSync(EVENTS_OUT, JSON.stringify({ updated: now, events: allEvents }));
console.log(`${catalog.length} models | ${events.length} new events | feed size ${allEvents.length}`);
