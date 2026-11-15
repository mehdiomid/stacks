"""Speed check for the naming models: thread count and grammar on/off (4 names each)."""
import json, sys, threading
import run_bench as rb

rb.vendor()
server = rb.ThreadingHTTPServer(("127.0.0.1", rb.PORT), rb.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
model = sys.argv[1] if len(sys.argv) > 1 else "qwen25-05b"
out = {}
for label, extra in [("2 threads, grammar", "&threads=2"), ("4 threads, grammar", "&threads=4"), ("4 threads, no grammar", "&threads=4&grammar=0"), ("8 threads, no grammar", "&threads=8&grammar=0")]:
    r = rb.run_job(f"gen:{model}", warm=False, extra=extra + "&limit=4")
    rs = r.get("results", [])
    out[label] = {"threads": r.get("threads"), "ms": [round(x["ms"]) for x in rs], "answers": [x["answer"] for x in rs], "timings": [x.get("timings") for x in rs], "error": r.get("error")}
    print(label, out[label]["threads"], out[label]["ms"], out[label]["answers"], flush=True)
(rb.RAW / f"diag-speed-{model}.json").write_text(json.dumps(out, indent=1))
server.shutdown()
