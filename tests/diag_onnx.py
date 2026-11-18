"""Quick check: naming models on the ONNX runtime (4 names each), and the EmbeddingGemma retry."""
import json, sys, threading
import run_bench as rb

server = rb.ThreadingHTTPServer(("127.0.0.1", rb.PORT), rb.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
for job in sys.argv[1:]:
    w = rb.run_job(job, warm=True)
    print(job, "warm", {k: w.get(k) for k in ("loadMs", "wallS", "peakRssMb", "error")}, flush=True)
    r = rb.run_job(job, warm=False, extra="&limit=4" if "gen:" in job else "")
    r["warm"] = {k: w.get(k) for k in ("loadMs", "wallS", "peakRssMb", "error")}
    (rb.RAW / f"{'diag-' if 'gen:' in job else ''}{job.replace(':', '-')}.json").write_text(json.dumps(r, indent=1))
    print(job, {k: r.get(k) for k in ("loadMs", "peakRssMb", "error")}, [(x["truth"], x["answer"], round(x["ms"])) for x in r.get("results", [])], flush=True)
server.shutdown()
