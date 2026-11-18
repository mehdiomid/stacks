"""Times the app's new-folder proposals on this Mac: with and without the pre-read, on the GPU and the CPU."""
import json, threading
import run_bench as rb

server = rb.ThreadingHTTPServer(("127.0.0.1", rb.PORT), rb.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
out = {}
for device in ("gpu", "cpu"):
    r = rb.run_job("namer-speed", warm=False, extra=f"&device={device}", gpu=(device == "gpu"))
    out[device] = r
    print(json.dumps({k: r.get(k) for k in ("device", "gpuAvailable", "threads", "loadMs", "noPreRead", "preReadMs", "withPreRead", "peakRssMb", "error")}, indent=1), flush=True)
(rb.RAW / "namer-speed.json").write_text(json.dumps(out, indent=1))
server.shutdown()
