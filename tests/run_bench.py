"""
Runs the local-model benchmark in this Mac's own Chrome (headless, CPU only, separate profile).

  python3 tests/run_bench.py            # every job
  python3 tests/run_bench.py bge-small  # only some jobs (ids from bench/jobs.json, gen ids as gen:<id>)

What it does:
  1. Downloads the two browser libraries once into tests/bench/vendor/ (Transformers.js with its
     ONNX runtime, and wllama), so the page loads them from the same origin.
  2. Serves tests/ on http://localhost:8765 with the headers that allow multi-threaded wasm.
  3. For each job, starts headless Chrome on bench/index.html?job=..., first to download the model
     (warm run, timed, then cached in the profile), then again to measure. It samples the memory
     (RSS) of Chrome's whole process tree while the job runs.
  4. Saves raw results to tests/results/raw/ and writes tests/RESULTS.md (make_report.py).

Nothing here touches the Stacks app or your normal Chrome profile. Models download from Hugging Face.
"""
import gzip
import json
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent
BENCH = ROOT / "bench"
VENDOR = BENCH / "vendor"
RAW = ROOT / "results" / "raw"
PROFILE = ROOT / ".chrome-profile"
PORT = 8765
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TIMEOUT_S = 45 * 60

TJS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/"
ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/"
WLLAMA = "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/"
VENDOR_FILES = {
    "transformers.min.js": TJS + "transformers.min.js",
    "ort/ort-wasm-simd-threaded.asyncify.mjs": ORT + "ort-wasm-simd-threaded.asyncify.mjs",
    "ort/ort-wasm-simd-threaded.asyncify.wasm": ORT + "ort-wasm-simd-threaded.asyncify.wasm",
    "ort/ort-wasm-simd-threaded.mjs": ORT + "ort-wasm-simd-threaded.mjs",
    "ort/ort-wasm-simd-threaded.wasm": ORT + "ort-wasm-simd-threaded.wasm",
    "wllama/index.js": WLLAMA + "index.js",
    "wllama/wllama.wasm": WLLAMA + "wasm/wllama.wasm",
}

results: dict[str, dict] = {}
done = threading.Event()


def vendor():
    for name, url in VENDOR_FILES.items():
        dest = VENDOR / name
        if dest.exists():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        print("downloading", url)
        dest.write_bytes(urllib.request.urlopen(url, timeout=120).read())


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def end_headers(self):
        # Cross-origin isolation, so wasm can use threads (as a real deployment would set up).
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/api/raw/"):
            f = RAW / self.path.split("/api/raw/")[1]
            if not f.exists():
                self.send_error(404)
                return
            body = f.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path.startswith("/api/log"):
            print("   ", body.decode()[:200], flush=True)
        elif self.path.startswith("/api/result"):
            results["last"] = json.loads(body)
            done.set()
        self.send_response(204)
        self.end_headers()


def tree_rss_mb(root_pid: int) -> float:
    """Resident memory of a process and all its children, in MB."""
    out = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,rss="], capture_output=True, text=True).stdout
    rows = [tuple(map(int, line.split())) for line in out.strip().splitlines()]
    kids: dict[int, list[int]] = {}
    rss = {}
    for pid, ppid, r in rows:
        kids.setdefault(ppid, []).append(pid)
        rss[pid] = r
    total, stack = 0, [root_pid]
    while stack:
        p = stack.pop()
        total += rss.get(p, 0)
        stack.extend(kids.get(p, []))
    return total / 1024


def run_job(job: str, warm: bool, extra: str = "", gpu: bool = False) -> dict:
    done.clear()
    results.pop("last", None)
    url = f"http://localhost:{PORT}/bench/index.html?job={job}{'&warm=1' if warm else ''}{extra}"
    proc = subprocess.Popen(
        [CHROME, "--headless=new", *([] if gpu else ["--disable-gpu"]), "--no-first-run", "--no-default-browser-check", "--disable-extensions",
         f"--user-data-dir={PROFILE}", url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    peak, t0 = 0.0, time.time()
    while not done.wait(0.25):
        peak = max(peak, tree_rss_mb(proc.pid))
        if time.time() - t0 > TIMEOUT_S:
            proc.kill()
            return {"error": "timeout"}
    wall = time.time() - t0
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
    time.sleep(1)
    r = results.get("last", {"error": "no result"})
    r.update({"peakRssMb": round(peak), "wallS": round(wall, 1)})
    return r


def file_sizes() -> dict:
    """Download size of each model (from Hugging Face) and of the runtimes (raw and gzip)."""
    jobs = json.loads((BENCH / "jobs.json").read_text())
    sizes = {}
    for e in jobs["embed"]:
        total = 0
        for f in e.get("files", []):
            req = urllib.request.Request(f"https://huggingface.co/{e['repo']}/resolve/main/{f}", method="HEAD")
            h = urllib.request.urlopen(req, timeout=30).headers
            total += int(h.get("x-linked-size") or h.get("content-length") or 0)
        sizes[e["id"]] = total
    for g in jobs["gen"]:
        req = urllib.request.Request(f"https://huggingface.co/{g['repo']}/resolve/main/{g['file']}", method="HEAD")
        h = urllib.request.urlopen(req, timeout=30).headers
        sizes["gen:" + g["id"]] = int(h.get("x-linked-size") or h.get("content-length") or 0)
    runtime = {}
    for name in VENDOR_FILES:
        b = (VENDOR / name).read_bytes()
        runtime[name] = {"raw": len(b), "gzip": len(gzip.compress(b, 6))}
    return {"models": sizes, "runtime": runtime}


def main():
    vendor()
    RAW.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    jobs = json.loads((BENCH / "jobs.json").read_text())
    every = ["blank"] + [e["id"] for e in jobs["embed"]] + ["gen:" + g["id"] for g in jobs["gen"]] + ["score-names"]
    todo = sys.argv[1:] or every
    (RAW / "sizes.json").write_text(json.dumps(file_sizes(), indent=1))
    for job in todo:
        needs_model = job not in ("blank", "tfidf", "score-names")
        if needs_model:
            print(f"== {job}: download / warm run", flush=True)
            w = run_job(job, warm=True)
            print("   ", {k: w.get(k) for k in ("loadMs", "wallS", "peakRssMb", "error")}, flush=True)
        print(f"== {job}: measuring", flush=True)
        r = run_job(job, warm=False)
        if needs_model:
            r["warm"] = {k: w.get(k) for k in ("loadMs", "wallS", "peakRssMb", "error")}
        (RAW / f"{job.replace(':', '-')}.json").write_text(json.dumps(r, indent=1))
        print("   ", {k: r.get(k) for k in ("loadMs", "pasteMs", "indexMsPerItem", "wallS", "peakRssMb", "error")}, flush=True)
    server.shutdown()
    subprocess.run([sys.executable, str(ROOT / "make_report.py")], check=False)


if __name__ == "__main__":
    main()
