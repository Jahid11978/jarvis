#!/usr/bin/env python3
"""Gegenproben zu tests/test_chat_bild_verlauf.py – beisst der Waechter EINZELN?

Jede Probe dreht GENAU EINE Stelle des Fixes zurueck. Gearbeitet wird auf einer
KOPIE (``CBV_ROOT``), nie im Arbeitsbaum – der Betreiber arbeitet parallel an
denselben Dateien. Gemessen wird der EXIT-CODE (1 = beisst), jede Ersetzung hat
eine Trefferkontrolle.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WAECHTER = ROOT / "tests" / "test_chat_bild_verlauf.py"
DATEIEN = ["backend/main.py", "frontend/js/chat.js"]

PROBEN = [
    ("Ablagename wird nicht herausgemeldet", "backend/main.py",
     "        ablage.append(ziel.name)\n", "        pass\n"),
    ("WS-Handler reicht ablage= nicht herein", "backend/main.py",
     "_vorh_i,\n                            ablage=_abl_i)", "_vorh_i)"),
    ("Ereignis traegt leere Liste", "backend/main.py",
     '"items": _bild_ablagen}', '"items": []}'),
    ("Endpunkt ohne Eigentuemer-Pruefung", "backend/main.py",
     "if not p.is_file() or not _documents.may_access(name, user, _is_admin_user(user)):",
     "if not p.is_file():"),
    ("Endpunkt liefert SVG", "backend/main.py",
     '"gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp"}\n    m = re.fullmatch',
     '"gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp", "svg": "image/svg+xml",\n'
     '              "html": "text/html"}\n    m = re.fullmatch'),
    ("Endpunkt ohne nosniff", "backend/main.py",
     ',\n                                 "X-Content-Type-Options": "nosniff"}', '}'),
    ("fremde Sitzung wird beschrieben", "frontend/js/chat.js",
     "if (!entry || !_chatHistory.includes(entry) || !Array.isArray(msg.items)) return;",
     "if (!entry || !Array.isArray(msg.items)) return;"),
    ("Verlauf zeigt keine Bilder", "frontend/js/chat.js",
     "            _renderAttachments(bubble, { attachments: _atts });\n", ""),
    ("_dataUrl kennt den Verweis nicht", "frontend/js/chat.js",
     "if (!att.data && att.doc) {", "if (false) {"),
    ("Hinweis wird nie entfernt", "frontend/js/chat.js",
     "            _shownText = entry.text.slice(0, entry.text.length - entry.att_note.length);\n", ""),
    ("teilweise Verweise entfernen den Hinweis", "frontend/js/chat.js",
     "                && _atts.length === entry.att_count) {", "                ) {"),
    ("totes Bild ohne Rueckfall", "frontend/js/chat.js",
     "if (gal && !gal.querySelector('.uc-ig-cell')) bubble.textContent = entry.text;", ""),
]


def lauf(wurzel):
    r = subprocess.run([sys.executable, str(WAECHTER)], capture_output=True, text=True,
                       env={**os.environ, "CBV_ROOT": str(wurzel)}, timeout=180)
    fails = sum(1 for z in r.stdout.splitlines() if z.strip().startswith("✗"))
    return r.returncode, fails, r.stdout


def kopie():
    d = Path(tempfile.mkdtemp(prefix="gegen_cbv_"))
    for rel in DATEIEN:
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, d / rel)
    return d


# Jede Datei, die eine Probe anfasst, muss in der Kopie stehen – als Regel.
if {pr[1] for pr in PROBEN} - set(DATEIEN):
    print("ABBRUCH: Probe auf Datei ausserhalb von DATEIEN")
    sys.exit(2)

basis = kopie()
try:
    rc, _f, out = lauf(basis)
finally:
    shutil.rmtree(basis, ignore_errors=True)
if rc != 0:
    print(out[-1500:])
    print(f"ABBRUCH: Basislauf nicht gruen (exit {rc}) – keine Gegenprobe deutbar")
    sys.exit(2)
print("Basislauf gruen\n")

beissen = 0
for titel, rel, alt, neu in PROBEN:
    d = kopie()
    try:
        p = d / rel
        s = p.read_text(encoding="utf-8")
        if s.count(alt) != 1:
            print(f"  ? {titel}: Ziel {s.count(alt)}x getroffen – Probe unbrauchbar")
            sys.exit(2)
        p.write_text(s.replace(alt, neu), encoding="utf-8")
        rc, fails, _o = lauf(d)
    finally:
        shutil.rmtree(d, ignore_errors=True)
    ok = rc == 1
    beissen += ok
    print(f"  {'✓' if ok else '✗'} {titel}: exit {rc}, {fails} FAIL")

print(f"\n{beissen} von {len(PROBEN)} Gegenproben beissen einzeln")
sys.exit(0 if beissen == len(PROBEN) else 1)
