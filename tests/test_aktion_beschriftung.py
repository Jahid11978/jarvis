#!/usr/bin/env python3
"""Waechter: Beschriftung der letzten Handlung in "Angemeldete Benutzer".

Gemeldet (2026-09-27): bei Short-Tracks-Nutzung stand dort nur "Aktion" -
der Pfad /api/tracks/ fehlte in der Bereichstabelle, und die Seite /tracks
fehlte in der Whitelist von POST /api/activity. Die Beschriftung ist seitdem
zweistufig (main.py::_action_label): genauer Endpunkt, sonst Bereich (+ Verb).

Geprueft wird die ECHTE Funktion samt ECHTER Tabellen, per ast aus main.py
herausgeloest (main.py selbst ist nicht importierbar - es zieht die Live-
Konfiguration). Gegen die ECHTEN Routen aller backend/*.py.

Exit 0 = gruen, 1 = Fehler, 2 = konnte nicht laufen.
"""
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OK = FAIL = 0


def check(text, bed, info=""):
    global OK, FAIL
    if bed:
        OK += 1
        print(f"  OK   {text}")
    else:
        FAIL += 1
        print(f"  FAIL {text}" + (f"  [{info}]" if info else ""))


def abbruch(grund):
    print(f"NICHT PRUEFBAR: {grund}")
    sys.exit(2)


src = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
baum = ast.parse(src)
ns = {"re": re}
NAMEN = {"_ID", "_ACTION_DETAILS", "_ACTION_LABELS", "_ACTION_VERBEN",
         "_ACTION_IGNORE", "_ACTIVITY_PAGES"}
gefunden = set()
note_activity = None
for n in baum.body:
    if isinstance(n, ast.Assign):
        for t in n.targets:
            if isinstance(t, ast.Name) and t.id in NAMEN:
                exec(compile(ast.Module([n], []), "main.py", "exec"), ns)
                gefunden.add(t.id)
    elif isinstance(n, ast.FunctionDef) and n.name == "_action_label":
        exec(compile(ast.Module([n], []), "main.py", "exec"), ns)
        gefunden.add(n.name)
    elif isinstance(n, ast.FunctionDef) and n.name == "_note_activity":
        note_activity = n

print("\n1. Positivkontrolle")
fehlt = (NAMEN | {"_action_label"}) - gefunden
if fehlt:
    abbruch(f"nicht in main.py gefunden: {sorted(fehlt)}")
L = ns["_action_label"]
ROUTE = re.compile(r'@app\.(post|put|patch|delete)\("(/api/[^"]*)"')
routen = []
for f in sorted((ROOT / "backend").glob("*.py")):
    for m, pfad in ROUTE.findall(f.read_text(encoding="utf-8")):
        routen.append((m.upper(), pfad))
if len(routen) < 100:
    abbruch(f"nur {len(routen)} veraendernde Routen gefunden - Muster passt nicht mehr")
check(f"{len(routen)} veraendernde Routen gelesen", True)
check("unbekannter Pfad bleibt 'Aktion' (die Funktion unterscheidet ueberhaupt)",
      L("/api/gibtesnicht", "POST") == "Aktion", L("/api/gibtesnicht", "POST"))

print("\n2. Der gemeldete Fall: Short Tracks")
erwartet = [
    ("POST", "/api/tracks/drop", "Short Tracks · Datei abgelegt"),
    ("POST", "/api/tracks/drop_url", "Short Tracks · Web-Adresse abgelegt"),
    ("POST", "/api/tracks/dumps", "Short Tracks · Ablage angelegt"),
    ("PUT", "/api/tracks/dumps/d1", "Short Tracks · Ablage bearbeitet"),
    ("DELETE", "/api/tracks/dumps/d1", "Short Tracks · Ablage gelöscht"),
    ("POST", "/api/tracks/dumps/d1/reset", "Short Tracks · Ablage zurückgesetzt"),
    ("DELETE", "/api/tracks/jobs/j1", "Short Tracks · Lauf entfernt"),
]
for m, p, soll in erwartet:
    ist = L(p, m)
    check(f"{m} {p} -> {soll}", ist == soll, ist)
check("Seite /tracks meldet 'Short Tracks' (Whitelist von /api/activity)",
      ns["_ACTIVITY_PAGES"].get("tracks") == "Short Tracks", ns["_ACTIVITY_PAGES"].get("tracks"))

print("\n3. Stufe 2: Bereich + Verb")
check("DELETE ohne eigenen Eintrag -> Bereich · gelöscht",
      L("/api/knowledge/groups/g1", "DELETE") == "Wissen · gelöscht", L("/api/knowledge/groups/g1", "DELETE"))
check("PATCH ohne eigenen Eintrag -> Bereich · geändert",
      L("/api/knowledge/groups/g1", "PATCH") == "Wissen · geändert", L("/api/knowledge/groups/g1", "PATCH"))
check("POST ohne eigenen Eintrag -> nur der Bereich (nicht geraten)",
      L("/api/knowledge/reindex", "POST") == "Wissen", L("/api/knowledge/reindex", "POST"))
check("die Methode zaehlt: PUT auf den POST-Endpunkt ist nicht 'angelegt'",
      "angelegt" not in L("/api/tracks/dumps", "PUT"), L("/api/tracks/dumps", "PUT"))
check("ganzer Pfad, kein Praefix: /dumps/x/reset ist nicht 'bearbeitet'",
      L("/api/tracks/dumps/x/reset", "PUT") != "Short Tracks · Ablage bearbeitet",
      L("/api/tracks/dumps/x/reset", "PUT"))

print("\n4. Generell: keine Route mehr mit nichtssagendem 'Aktion'")
# /api/login laeuft ohne Anmeldung -> nie in _note_activity.
ohne = [(m, p) for m, p in routen
        if not p.startswith(ns["_ACTION_IGNORE"]) and p != "/api/login"
        and L(re.sub(r"\{[^}]+\}", "x1", p), m) == "Aktion"]
check("jede angemeldete veraendernde Route hat eine Beschriftung", not ohne,
      "; ".join(f"{m} {p}" for m, p in ohne[:10]))
lang = [(p, L(re.sub(r"\{[^}]+\}", "x1", p), m)) for m, p in routen]
lang = [x for x in lang if len(x[1]) > 60]
check("keine Beschriftung ueber 60 Zeichen (note_action kuerzt sonst mitten im Wort)",
      not lang, str(lang[:3]))

print("\n5. Jede Seite mit activity.js steht in der Whitelist")
seiten = []
for h in sorted((ROOT / "frontend").glob("*.html")):
    if re.search(r"js/activity\.js", h.read_text(encoding="utf-8")):
        seiten.append(h.stem.lower())
if len(seiten) < 5:
    abbruch(f"nur {len(seiten)} Seiten mit activity.js gefunden")
fehlen = [s for s in seiten if s not in ns["_ACTIVITY_PAGES"]]
check(f"{len(seiten)} Seiten: alle haben eine Beschriftung", not fehlen, ", ".join(fehlen))

print("\n6. Verdrahtung: _note_activity reicht die Methode durch")
if note_activity is None:
    abbruch("_note_activity nicht gefunden")
aufrufe = [c for c in ast.walk(note_activity)
           if isinstance(c, ast.Call) and isinstance(c.func, ast.Name) and c.func.id == "_action_label"]
check("_action_label wird mit (pfad, request.method) gerufen",
      len(aufrufe) == 1 and len(aufrufe[0].args) == 2
      and ast.unparse(aufrufe[0].args[1]) == "request.method",
      ast.unparse(aufrufe[0]) if aufrufe else "kein Aufruf")

print(f"\nERGEBNIS: {OK}/{OK + FAIL}")
sys.exit(1 if FAIL else 0)
