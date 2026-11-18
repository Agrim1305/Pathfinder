// Checks the Adelaide page's words (docs/adelaide/text.js): pin names, the
// From and To search, and the "What just happened" sentence.
// Run from the project root: node tests/test_text.js
const assert = require("assert");
const T = require("../docs/adelaide/text.js");
const AG = require("../docs/adelaide/graph.js");

let checks = 0;
const eq = (a, b, msg) => (assert.strictEqual(a, b, msg), checks++);

// ---------- pin names, on a small made-up map (metres) ----------
// Grenfell St runs east along y = 0. An unnamed path runs north from it, and
// a lane crosses the street at x = 0.
const nodes = [[0, 0], [100, 0], [50, 40], [50, 70], [0, 100], [400, 450]];
const G = {
  names: ["", "Grenfell St", "Gawler Place"],
  nx: nodes.map((p) => p[0]), ny: nodes.map((p) => p[1]),
  edges: [
    { a: 0, b: 1, cls: 1, nm: 1, pts: [0, 0, 100, 0] }, // Grenfell St
    { a: 1, b: 2, cls: 4, nm: 0, pts: [100, 0, 50, 40] }, // unnamed path
    { a: 2, b: 3, cls: 4, nm: 0, pts: [50, 40, 50, 70] }, // unnamed path
    { a: 0, b: 4, cls: 3, nm: 2, pts: [0, 0, 0, 100] }, // Gawler Place, a lane
  ],
};
const none = [];
eq(T.placeName(G, 1, none), "Grenfell St", "a junction on a named street takes its name");
eq(T.placeName(G, 0, none), "Grenfell St", "where two streets meet, the more important one names the pin");
eq(T.placeName(G, 2, none), "Grenfell St", "an unnamed path 40 m from a named street is named after the street, not 'a path'");
eq(T.placeName(G, 3, none), "Gawler Place", "the nearest named street within 60 m wins (50 m to Gawler Place, 70 m to Grenfell St)");
eq(T.placeName(G, 5, none), "a path near Gawler Place", "nothing named within 60 m: a path near the nearest named street");
eq(T.placeName(G, 2, [["Rundle Mall", 50, 30]]), "near Rundle Mall", "a landmark closer than any street names the pin");
eq(T.placeName(G, 2, [["Rundle Mall", 50, 80]]), "Grenfell St", "a street closer than the landmark wins");
eq(T.placeName(G, 2, [["Rundle Mall", 50, 0]]), "Grenfell St", "a tie goes to the street");
eq(T.placeName(G, 5, [["Rundle Mall", 380, 400]]), "near Rundle Mall", "a landmark within 60 m beats 'a path near'");

// ---------- the From and To search ----------
const names = ["", "Rundle St", "Little Rundle St", "Grundle Lane", "King William St", "King's Court", "Kingston St", "Victoria Square"];
const list = T.entries({ names }, [{ name: "Victoria Square", node: 1 }, { name: "Rundle Mall", node: 2 }]);
const labels = (q, n) => T.search(q, list, n).map((e) => e.label);
eq(list.filter((e) => e.label === "Victoria Square").length, 1, "a street named like a landmark is listed once, as the landmark");
assert.deepStrictEqual(labels(""), ["Rundle Mall", "Victoria Square"], "an empty box lists the places");
checks++;
assert.deepStrictEqual(labels("rundle"), ["Rundle Mall", "Rundle St", "Little Rundle St", "Grundle Lane"], "names that start with it, then a word that starts with it, then inside a word; places first");
checks++;
assert.deepStrictEqual(labels("RUNDLE"), labels("rundle"), "case does not matter");
checks++;
assert.deepStrictEqual(labels("kings"), ["King's Court", "Kingston St"], "apostrophes are ignored");
checks++;
assert.deepStrictEqual(labels("king w"), ["King William St"], "several words match as typed");
checks++;
assert.deepStrictEqual(labels("st", 3).length, 3, "the list stops at the limit");
checks++;
assert.deepStrictEqual(labels("zzz"), [], "no match, no results");
checks++;

// ---------- on the real Adelaide data ----------
const raw = require("../docs/adelaide/data/adelaide_cbd.json");
const D = AG.load(raw);
const places = raw.pl.map(([n, x, y]) => [n, x / 2, y / 2]);
for (const v of [D.sp, D.ep]) assert.ok(!T.placeName(D, v, places).startsWith("a path"), "the example pins sit on named streets"), checks++;
const kws = D.names.indexOf("King William St"), at = T.streetNode(D, kws);
assert.ok(D.edges.some((e) => e.nm === kws && (e.a === at || e.b === at)), "choosing a street starts on that street"), checks++;
const real = T.entries(D, raw.pl.map(([name]) => ({ name, node: 0 })));
eq(T.search("rundle", real)[0].label, "Rundle Mall", "Rundle Mall comes first for 'rundle'");

// ---------- what just happened ----------
const R = AG.solve(D, D.sp, D.ep);
const line = T.insight(R);
assert.ok(/^A\* found the same \d+ min walk as Dijkstra but checked \d+% fewer junctions \([\d,]+ instead of [\d,]+\)\. BFS counts street segments, not metres, so its route is \d+ min longer\.$/.test(line), line), checks++;
const run = (n, dist) => ({ path: [0], order: { length: n }, dist });
eq(T.insight({ A: run(10, 700), U: run(10, 700), B: run(10, 702) }), "A* and Dijkstra found the same 8 min walk and checked about as many junctions (10 and 10). BFS found an equally short route this time, even though it counts street segments, not metres.", "no saving and the same walk");
eq(T.insight({ A: run(5, 630), U: run(20, 630), B: run(9, 660) }).split(". ")[1], "BFS counts street segments, not metres, so its route is 30 m longer.", "under a minute longer is said in metres");
eq(T.insight({ A: { path: null, order: [], dist: Infinity }, U: run(3, 0), B: run(3, 0) }).startsWith("No walking route"), true, "no route");
assert.ok(!/\u2014/.test(Object.values(T).filter((f) => typeof f === "function").join("")), "no em dashes in the page's words"), checks++;

console.log(`${checks} of ${checks} checks passed for the pin names, the place search and the summary sentence`);
