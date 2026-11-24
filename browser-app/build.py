#!/usr/bin/env python3
"""Assemble the single-file offline HTML app from its parts."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "Rectification Tracker.html")


def read(name):
    with open(os.path.join(HERE, name), "r", encoding="utf-8") as f:
        return f.read()


def safe_js(js):
    # Avoid the HTML parser closing the <script> block early.
    return js.replace("</script", "<\\/script")


def main():
    html = read("index.template.html")
    html = html.replace("{{CSS}}", read("app.css"))
    html = html.replace("{{SHEETJS}}", safe_js(read("xlsx.full.min.js")))
    html = html.replace("{{APPJS}}", safe_js(read("app.js")))
    for ph in ("{{CSS}}", "{{SHEETJS}}", "{{APPJS}}"):
        assert ph not in html, "placeholder not replaced: " + ph
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
