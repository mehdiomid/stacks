"""Thresholds for the app's local mode: snowflake-arctic-embed-xs with folders scored by their average."""
import json, threading
import run_bench as rb

rb.vendor()
server = rb.ThreadingHTTPServer(("127.0.0.1", rb.PORT), rb.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
rb.run_job("arctic-xs", warm=True, extra="&how=centroid")
r = rb.run_job("arctic-xs", warm=False, extra="&how=centroid")
(rb.RAW / "arctic-xs-centroid.json").write_text(json.dumps(r, indent=1))
server.shutdown()
known = sorted(x["top"] for x in r["choice"])
novel = sorted(x["top"] for x in r["novel"])
print("top-1", sum(x["rank"] == 1 for x in r["choice"]) / len(known), "top-3", sum(x["rank"] <= 3 for x in r["choice"]) / len(known))
for keep in (0.95, 0.9, 0.85, 0.8):
    t = known[int((1 - keep) * len(known))]
    print(f"keep {keep:.0%} of fitting items -> threshold {t:.3f}, flags {sum(n < t for n in novel) / len(novel):.0%} of new-folder items")
for j in r["joins"]:
    print("JOIN" if j["join"] else "no  ", f"{j['candidates'][0]['sim']:.3f}", j["title"][:50], "->", j["candidates"][0]["title"][:40])
