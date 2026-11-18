"""Runs the naming test with prompts v2 and v3 on every naming model (4 threads), then scores the names."""
import json, threading
import run_bench as rb

server = rb.ThreadingHTTPServer(("127.0.0.1", rb.PORT), rb.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
jobs = json.loads((rb.BENCH / "jobs.json").read_text())
for g in jobs["gen"]:
    for v in ("v2", "v3"):
        r = rb.run_job(f"gen:{g['id']}", warm=False, extra=f"&prompt={v}&threads=4")
        (rb.RAW / f"gen-{g['id']}-{v}.json").write_text(json.dumps(r, indent=1))
        print(g["id"], v, [x["answer"] for x in r.get("results", [])], r.get("error"), flush=True)
r = rb.run_job("score-names", warm=False)
(rb.RAW / "score-names.json").write_text(json.dumps(r, indent=1))
(rb.RAW / "sizes.json").write_text(json.dumps(rb.file_sizes(), indent=1))
server.shutdown()
