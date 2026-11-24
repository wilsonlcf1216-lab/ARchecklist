"""One-click launcher: starts the tracker and opens it in your browser.

Double-click the platform launcher instead of running this directly:
  Windows : "Start Rectification Tracker.bat"
  macOS   : "Start Rectification Tracker.command"
  Linux   : "Start Rectification Tracker.sh"
"""
import os
import socket
import sys
import threading
import time
import webbrowser
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, HERE)

import db  # noqa: E402
from server import Handler  # noqa: E402


def find_free_port(start=8010, tries=50):
    for port in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start


def main():
    db.init_db()
    port = find_free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"

    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    print("=" * 60)
    print("  Rectification Tracker is running")
    print(f"  Open in your browser:  {url}")
    print(f"  Data folder:           {db.DATA_DIR}")
    print("  Close this window (or press Ctrl+C) to stop.")
    print("=" * 60)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        httpd.shutdown()
        print("\nStopped.")


if __name__ == "__main__":
    main()
