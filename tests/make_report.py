"""
Turns tests/results/raw/*.json into tests/RESULTS.md.

The written findings and recommendation come from tests/results/findings.md (written after
reading the numbers); everything else is generated here from the raw results.

Run: python3 tests/make_report.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
RAW = ROOT / "results" / "raw"
jobs = json.loads((ROOT / "bench" / "jobs.json").read_text())
syn = json.loads((ROOT / "data" / "synthetic.json").read_text())


def load(name):
    f = RAW / f"{name}.json"
    return json.loads(f.read_text()) if f.exists() else None


sizes = load("sizes") or {"models": {}, "runtime": {}}
blank = load("blank") or {}
base_rss = blank.get("peakRssMb", 0)
MB = 1e6


def pct(x):
    return f"{100 * x:.0f}%"


def runtime_bytes(kind, key):
    rt = sizes["runtime"]
    pick = {
        "tjs": ["transformers.min.js", "ort/ort-wasm-simd-threaded.asyncify.mjs", "ort/ort-wasm-simd-threaded.asyncify.wasm"],
        "gemma": ["transformers.min.js", "ort/ort-wasm-simd-threaded.asyncify.mjs", "ort/ort-wasm-simd-threaded.asyncify.wasm"],
        "potion": ["transformers.min.js"],
        "gen": ["wllama/index.js", "wllama/wllama.wasm"],
    }.get(kind, [])
    return sum(rt[p][key] for p in pick if p in rt)


# ---------- metrics ----------
def auc(pos, neg):
    """Chance that a known item scores higher than a new-folder item."""
    if not pos or not neg:
        return float("nan")
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def best_threshold(known, novel):
    """Threshold on the top score that best separates 'fits a folder' from 'needs a new folder'."""
    best = (0, 0, 0, 0)
    for t in sorted(set(known + novel)):
        kept = sum(k >= t for k in known) / len(known)
        flagged = sum(n < t for n in novel) / len(novel)
        if (kept + flagged) / 2 > best[0]:
            best = ((kept + flagged) / 2, t, kept, flagged)
    return best


GENERIC = set(
    "a an and the of to for in on with from by vs at is it its how what why your you lecture lectures course courses part unit episode ep "
    "week weeks lesson lessons chapter series introduction intro guide plan tutorial video videos notes explained basics deep learning "
    "machine robot robots robotics from scratch new best".split()
)
corpus_titles = [i["title"] for i in syn["items"]] + [j["title"] for j in syn["joins"]]


def words(t):
    return set(re.findall(r"[a-z0-9]+(?:\.[a-z0-9]+)*", t.lower()))


df = {}
for t in corpus_titles:
    for w in words(t):
        df[w] = df.get(w, 0) + 1


def distinctive(t):
    return {w for w in words(t) if w not in GENERIC and not w.isdigit() and len(w) > 1 and df.get(w, 0) <= 3}


notes_of = {j["title"]: j["notes"] for j in syn["joins"]}


def join_eval(joins, use_names):
    """Best threshold for 'add to that item', with or without the shared-name check."""
    decisions = []
    for j in joins:
        cands = j["candidates"]
        if use_names:
            # The new paste's own notes count too ("Andrej Karpathy, Zero to Hero" under a title that names neither).
            mine = distinctive(j["title"] + " " + notes_of.get(j["title"], ""))
            cands = [c for c in cands if mine & distinctive(c["title"])]
        top = cands[0] if cands else None
        decisions.append((j, top))
    best = None
    for t in sorted({top["sim"] for _, top in decisions if top} | {2.0}):
        tp = fp = fn = wrong = 0
        for j, top in decisions:
            joined = top and top["sim"] >= t
            if j["join"]:
                if joined and top["title"] == j["join"]:
                    tp += 1
                elif joined:
                    wrong += 1
                else:
                    fn += 1
            elif joined:
                fp += 1
        correct = tp + (sum(1 for j, _ in decisions if not j["join"]) - fp)
        if best is None or correct > best[0]:
            best = (correct, t, tp, fp, wrong, fn)
    return best


# ---------- tables ----------
lines = []
w = lines.append
emb_rows = []
for e in jobs["embed"]:
    r = load(e["id"])
    if not r or "choice" not in r:
        emb_rows.append((e, r, None))
        continue
    c = r["choice"]
    top1 = sum(x["rank"] == 1 for x in c) / len(c)
    top3 = sum(x["rank"] <= 3 for x in c) / len(c)
    known = [x["top"] for x in c]
    novel = [x["top"] for x in r["novel"]]
    sep, thr, kept, flagged = best_threshold(known, novel)
    pk = [x for x in r["novel"] if x["parentKnown"]]
    parent_ok = sum(x["predParent"] == x["folder"].split(" › ")[0] for x in pk) / len(pk) if pk else float("nan")
    j_sim = join_eval(r["joins"], False)
    j_name = join_eval(r["joins"], True)
    emb_rows.append((e, r, dict(top1=top1, top3=top3, auc=auc(known, novel), thr=thr, kept=kept, flagged=flagged, parent=parent_ok, j_sim=j_sim, j_name=j_name)))

n_pos = sum(1 for j in syn["joins"] if j["join"])
n_neg = len(syn["joins"]) - n_pos

w("## 1. Embedding models: choosing the folder\n")
w(f"Synthetic library: {len(syn['items'])} items in {len(syn['folders'])} two-level folders. Each item is hidden in turn and the model ranks every folder, described as the app would describe it: its path plus its latest 5 items.\n")
w("| Model | Download (model + runtime, gzip) | Top-1 | Top-3 | Load (cached) | Per paste | Prepare 1,000 items | Extra memory |")
w("|---|---|---|---|---|---|---|---|")
for e, r, m in emb_rows:
    if m is None:
        w(f"| {e['label']} | | failed: {(r or {}).get('error', 'no result')[:80]} | | | | | |")
        continue
    model_mb = sizes["models"].get(e["id"], 0) / MB
    rt_mb = runtime_bytes(e["kind"], "gzip") / MB
    dl = "none" if e["kind"] == "tfidf" else f"{model_mb:.0f} MB + {rt_mb:.1f} MB"
    w(f"| {e['label']} | {dl} | **{pct(m['top1'])}** | {pct(m['top3'])} | {r['loadMs'] / 1000:.1f} s | {r['pasteMs']:.0f} ms | {r['indexMsPerItem']:.0f} s | {max(0, r['peakRssMb'] - base_rss)} MB |")  # ms per item x 1,000 items = seconds
w("")
w(f"- *Per paste*: embedding one {emb_rows[2][1]['pasteWords'] if emb_rows[2][1] else '~100'}-word paste (median of 10). *Prepare 1,000 items*: one-time cost to embed saved items, measured on {len(syn['items'])}.")
w(f"- *Extra memory*: peak memory of the Chrome process tree during the run, minus an empty page ({base_rss} MB).")
w("- *Runtime*: the ONNX runtime and Transformers.js, shared by all models except potion and the baseline. Uncompressed sizes are in section 6.\n")

w("Scoring method (top-1), on the same models: *max* is the closest single item, *centroid* the average of the folder, *hybrid* the mean of both (used above).\n")
w("| Model | max | centroid | hybrid |")
w("|---|---|---|---|")
for e, r, m in emb_rows:
    if m:
        s = r["strategyTop1"]
        w(f"| {e['label']} | {pct(s['max'])} | {pct(s['centroid'])} | {pct(s['hybrid'])} |")
w("")

w("## 2. Noticing that no folder fits\n")
w("Each folder is hidden in turn, with all its items. Its items should then score lower than items that do have a folder. *Separation* is the chance that an item with a folder scores higher than one without (50% = no signal, 100% = perfect). The threshold is the best single cut-off; it was picked on this same data, so real results will be somewhat lower.\n")
w("| Model | Separation | Best threshold | Items with a folder kept | Items needing a new folder flagged | Right parent for a new subfolder |")
w("|---|---|---|---|---|---|")
for e, r, m in emb_rows:
    if m:
        w(f"| {e['label']} | **{pct(m['auc'])}** | {m['thr']:.3f} | {pct(m['kept'])} | {pct(m['flagged'])} | {pct(m['parent'])} |")
w("")

w("## 3. Adding to an existing item\n")
w(f"{len(syn['joins'])} new pastes: {n_pos} continue a saved course (Lecture 5 of a saved CS231n, Couch to 5K week 4…) and {n_neg} are a *different* course on a similar subject (CS234 vs a saved CS285, a Neapolitan pizza video vs a saved sourdough series). The model compares each paste with the latest 5 items of every folder. Threshold picked on this data, as above.\n")
w("| Model | Similarity only: correct | joined right / missed / wrong item | false joins | With shared-name check: correct | joined right / missed / wrong item | false joins |")
w("|---|---|---|---|---|---|---|")
for e, r, m in emb_rows:
    if m:
        a, b = m["j_sim"], m["j_name"]
        w(f"| {e['label']} | {a[0]}/{len(syn['joins'])} | {a[2]} / {a[5]} / {a[4]} | {a[3]}/{n_neg} | **{b[0]}/{len(syn['joins'])}** | {b[2]} / {b[5]} / {b[4]} | {b[3]}/{n_neg} |")
w("")
w("*Shared-name check*: the two titles must share a distinctive word (one that appears in at most 3 titles and isn't a generic word like lecture, course, learning, robot). This is code, not a model.\n")

# ---------- naming ----------
scored = (load("score-names") or {}).get("scored", {})
PROMPTS = {"v1": "rules in text", "v2": "worked examples", "v3": "\"what is it about?\" with examples"}


def usable(r):
    """A name the app could use: not empty, not the parent or an existing sibling, not instruction words."""
    a = r["answer"].strip()
    leaf = a.split(" › ")[-1]
    bad = {"area", "subject", "folder", "okay", "ready", "name", "level", "levels"}
    if not a or set(re.findall(r"[a-z]+", a.lower())) & bad:
        return False
    if r.get("parent") and leaf.lower() in {r["parent"].lower(), *[x.lower() for x in r.get("siblings", [])]}:
        return False
    return True


gen_runs = []
for g in jobs["gen"]:
    for v in PROMPTS:
        r = load(f"gen-{g['id']}-{v}")
        if r and "results" in r:
            gen_runs.append((g, v, r))
w("## 4. Naming a new folder (generative models)\n")
w("Each folder is hidden in turn. The model gets its first item (and, for prompts v1–v2, the parent folder and its other subfolders) and proposes a name: 1–3 words, forced by a grammar. When the whole area is new (Finance, Fitness, Travel, and the real Open Models) it proposes \"Area › Subject\". 20 cases: 17 synthetic, 3 from your export.\n")
w("- *Usable*: not empty, not the parent or an existing subfolder, and not instruction words (\"Area › Subject\", \"Okay. I'm Ready.\").")
w("- *Meaning match*: how close the name is to the real folder name according to bge-small (1.0 = same meaning; unrelated words score about 0.4–0.5).")
w("- Speed is the median per name after the first; the first name of a session is slower (the runtime warms up). v1 ran with 2 threads, v2 and v3 with 4.\n")
w("| Model | Prompt | Usable | Exact name | Meaning match (avg) | Per name (median) | First name | Extra memory |")
w("|---|---|---|---|---|---|---|---|")
for g, v, r in gen_runs:
    rs = r["results"]
    ms = sorted(x["ms"] for x in rs[1:])
    sc = scored.get(f"{g['id']}-{v}", [])
    exact = sum(1 for x in sc if x["answer"].split(" › ")[-1].lower() == x["truth"].split(" › ")[-1].lower())
    avg = sum(x["sim"] for x in sc) / len(sc) if sc else float("nan")
    w(f"| {g['label']} | {v}: {PROMPTS[v]} | {sum(map(usable, rs))}/{len(rs)} | {exact}/{len(rs)} | {avg:.2f} | {ms[len(ms) // 2] / 1000:.1f} s | {rs[0]['ms'] / 1000:.0f} s | {max(0, r['peakRssMb'] - base_rss)} MB |")
w("")
w("| Model | Download (model + runtime, gzip) | First load (download) | Load (cached) |")
w("|---|---|---|---|")
for g in jobs["gen"]:
    r = load(f"gen-{g['id']}-v1") or {}
    first = (r.get("warm") or {}).get("loadMs")
    w(f"| {g['label']} | {sizes['models'].get('gen:' + g['id'], 0) / MB:.0f} MB + {runtime_bytes('gen', 'gzip') / MB:.1f} MB | {first / 1000 if first else float('nan'):.0f} s | {r.get('loadMs', float('nan')) / 1000:.1f} s |")
w("")
for v in ("v3", "v2"):
    runs = [(g, r) for g, vv, r in gen_runs if vv == v]
    if not runs:
        continue
    w(f"Every suggestion with prompt {v}, next to the real folder:\n")
    w("| Set | Real folder | First item | " + " | ".join(g["label"].split(" (")[0] for g, _ in runs) + " |")
    w("|---|---|---|" + "---|" * len(runs))
    for k, c in enumerate(runs[0][1]["results"]):
        cells = [(r["results"][k]["answer"] or f"*error: {r['results'][k].get('error', '')[:40]}*") for _, r in runs]
        w(f"| {c['set']} | {c['truth']} | {c['title'][:60]} | " + " | ".join(cells) + " |")
    w("")

w("### Why naming is slow, and whether another runtime helps\n")
w("llama.cpp's own timings show this CPU reads the prompt at about 7–12 tokens per second in the browser, so a ~150–300 token prompt takes several seconds. Checked on Qwen2.5-0.5B, 4 names each:\n")
w("| Setup | Per name (after the first) | Prompt speed | Peak memory (whole Chrome) |")
w("|---|---|---|---|")
for f, fmt in (("diag-speed-qwen25-05b", "speed"), ("diag-quant-qwen25-05b", "quant")):
    d = load(f)
    if not d:
        continue
    for label, x in d.items():
        ms = x["ms"][1:] if x.get("ms") else []
        tps = x.get("prompt_tps") or [round((t or {}).get("prompt_per_second", 0), 1) for t in x.get("timings", [])]
        w(f"| wllama, Q4_K_M, {label} |" if fmt == "speed" else f"| wllama, {label} |")
        lines[-1] += f" {sum(ms) / len(ms) / 1000:.1f} s | {sum(tps[1:]) / max(1, len(tps) - 1):.1f} tok/s | {x.get('rss', '–')} MB |"
for f, label in (("diag-onnxgen-onnx-qwen25-05b", "ONNX runtime, Qwen2.5-0.5B int8"), ("diag-onnxgen-onnx-smollm2-360m", "ONNX runtime, SmolLM2-360M int8")):
    d = load(f)
    if d and d.get("results"):
        ms = [x["ms"] for x in d["results"][1:]]
        w(f"| {label} | {sum(ms) / len(ms) / 1000:.1f} s | – | {d['peakRssMb']} MB |")
w("")

# ---------- real data ----------
w("## 5. Your real export (5 items, 4 folders)\n")
w("Too small to score: each item is hidden in turn and ranked against the remaining folders. Shown for the strongest small and large models.\n")
for mid in ("bge-small", "arctic-m", "bge-base"):
    r = load(mid)
    if not r or "real" not in r:
        continue
    label = next(e["label"] for e in jobs["embed"] if e["id"] == mid)
    w(f"**{label}**\n")
    w("| Item | Real folder | 1st | 2nd |")
    w("|---|---|---|---|")
    for x in r["real"]:
        rk = x["ranking"]
        w(f"| {x['title'][:60]} | {x['folder']} | {rk[0][0]} ({rk[0][1]}) | {rk[1][0]} ({rk[1][1]}) |")
    w("")

w("## 6. Setup and sizes\n")
meta = blank.get("meta", {})
w(f"- Machine: this Mac, Intel Core i7-8569U (4 cores, 8 threads), 16 GB RAM. Browser: {meta.get('ua', 'Chrome').split(') ')[-1].split(' Safari')[0]}, headless, GPU off (`--disable-gpu`), cross-origin isolated = {meta.get('isolated')} (wasm threads on). The browser saw {meta.get('cores')} cores.")
w("- Libraries: Transformers.js 4.3.2 (ONNX Runtime Web 1.31.0-dev), wllama 3.8.1 (llama.cpp). Models from Hugging Face, cached in a separate Chrome profile.")
w("- Runtime files, uncompressed / gzip:")
for name, v in sizes["runtime"].items():
    w(f"  - `{name}`: {v['raw'] / MB:.1f} MB / {v['gzip'] / MB:.1f} MB")
w("- Code: `make_synthetic.py` (test library), `bench/bench.js` (runs in the browser), `run_bench.py` (server, Chrome, memory; first full run with naming prompt v1), `run_naming.py` (naming prompts v2 and v3, 4 threads), `diag_speed.py` / `diag_quant.py` / `diag_onnx.py` (the speed checks in section 4), `make_report.py` (this report). Raw results: `results/raw/`; written findings: `results/findings.md`.")
w("- Re-run: `python3 tests/make_synthetic.py && python3 tests/run_bench.py && python3 tests/run_naming.py && python3 tests/make_report.py`.\n")

findings = ROOT / "results" / "findings.md"
head = [
    "# Local models for Stacks: assessment\n",
    "Can a model running in the browser, with no API calls, choose the folder for a new paste, notice when no folder fits and name a new one, and add a paste to an existing item? Measured on this Mac, CPU only.\n",
]
body = findings.read_text() if findings.exists() else "*(Findings to be written after reading the results.)*\n"
(ROOT / "RESULTS.md").write_text("\n".join(head) + "\n" + body + "\n" + "\n".join(lines))
print("wrote", ROOT / "RESULTS.md")
