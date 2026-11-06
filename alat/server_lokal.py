"""Server pratinjau lokal tanpa cache (agar perubahan JS/Python langsung terlihat).

    python alat/server_lokal.py            # http://localhost:8780
    python alat/server_lokal.py 9000
"""
import functools
import http.server
import sys
from pathlib import Path

AKAR = Path(__file__).resolve().parents[1]


class TanpaCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".geojson": "application/geo+json", ".py": "text/plain; charset=utf-8"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8780
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(TanpaCache, directory=str(AKAR))) as s:
        print(f"SIGMA QA lokal: http://localhost:{port}")
        s.serve_forever()
