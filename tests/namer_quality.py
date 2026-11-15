"""Compares the app's new-folder prompt with and without your areas listed, on the 20 hidden-folder cases (this Mac, CPU)."""
import json, threading
import run_bench as rb

server = rb.ThreadingHTTPServer(("127.0.0.1", rb.PORT), rb.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
r = rb.run_job("namer-quality", warm=False)
(rb.RAW / "namer-quality.json").write_text(json.dumps(r, indent=1))
server.shutdown()
if r.get("error"):
    print(r["error"])
for v in ("areas", "noAreas"):
    x = r.get(v, {})
    ms = sorted(row["ms"] for row in x.get("rows", []))
    print(f"== {v}: pre-read {x.get('preReadMs', 0) / 1000:.0f}s, median {ms[len(ms) // 2] / 1000 if ms else 0:.1f}s, first {x['rows'][0]['ms'] / 1000 if ms else 0:.1f}s")
for a, b in zip(r["areas"]["rows"], r["noAreas"]["rows"]):
    print(f"{a['truth']:<34} | {a['answer']:<32} | {b['answer']:<32} | {a['title'][:40]}")
