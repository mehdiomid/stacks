"""Speed check for the naming models: quantization type (Q4_K_M vs Q4_0 vs Q8_0), 4 names each."""
import json, sys, threading
import run_bench as rb

server = rb.ThreadingHTTPServer(("127.0.0.1", rb.PORT), rb.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
out = {}
for label, extra in [
    ("Q4_0", "&repo=bartowski/Qwen2.5-0.5B-Instruct-GGUF&file=Qwen2.5-0.5B-Instruct-Q4_0.gguf"),
    ("Q8_0", "&repo=bartowski/Qwen2.5-0.5B-Instruct-GGUF&file=Qwen2.5-0.5B-Instruct-Q8_0.gguf"),
]:
    rb.run_job("gen:qwen25-05b", warm=True, extra=extra)
    for t in (2, 4):
        r = rb.run_job("gen:qwen25-05b", warm=False, extra=f"{extra}&threads={t}&limit=4")
        rs = r.get("results", [])
        tm = [x.get("timings") or {} for x in rs]
        out[f"{label}, {t} threads"] = {"ms": [round(x["ms"]) for x in rs], "prompt_tps": [round(x.get("prompt_per_second", 0), 1) for x in tm], "gen_tps": [round(x.get("predicted_per_second", 0), 1) for x in tm], "error": r.get("error"), "rss": r.get("peakRssMb")}
        print(f"{label}, {t} threads", out[f"{label}, {t} threads"], flush=True)
(rb.RAW / "diag-quant-qwen25-05b.json").write_text(json.dumps(out, indent=1))
server.shutdown()
