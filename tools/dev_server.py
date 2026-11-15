"""Local preview server that never caches, so edits show up on reload.
Usage:  python3 tools/dev_server.py [port]      then open http://localhost:8768
"""
import http.server, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass


Handler.extensions_map.update({'.glb': 'model/gltf-binary', '.webp': 'image/webp', '.js': 'text/javascript'})
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8768
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
