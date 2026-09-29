#!/usr/bin/env python3
"""Waechter: die Endpunkte liefern das Datum des letzten Confluence-Imports
(Vorgabe 2026-09-28: "(Datum)" hinter [+]/[-] bzw. der importierten Zeile).

GEMESSEN WIRD DIE WIRKUNG: die ECHTEN Funktionskoerper von
``wissen_confluence_pages`` und ``wissen_cf_bindung_lesen`` werden aus
``backend/main.py`` per Syntaxbaum herausgeloest und AUSGEFUEHRT – gegen
Attrappen mit der echten Antwortform. ``backend.main`` selbst wird nicht
importiert (der Import startet den halben Dienst und schreibt die Live-
``settings.json``).

Exit 2, wenn eine der Funktionen nicht gefunden wird ("konnte nicht laufen").
"""
from __future__ import annotations

import ast
import asyncio
import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OK = FAIL = 0


def section(t): print(f"\n\033[1m{t}\033[0m")


def check(desc, cond, info=""):
    global OK, FAIL
    if cond:
        OK += 1; print(f"  \033[32m✓\033[0m {desc}")
    else:
        FAIL += 1; print(f"  \033[31m✗\033[0m {desc}" + (f" – {info}" if info else ""))


section("0. Funktionen aus main.py herausloesen")
BAUM = ast.parse((ROOT / "backend" / "main.py").read_text(encoding="utf-8"))
FN = {n.name: n for n in BAUM.body if isinstance(n, ast.AsyncFunctionDef)}
NAMEN = ("wissen_confluence_pages", "wissen_cf_bindung_lesen")
for nm in NAMEN:
    if nm not in FN:
        print(f"  \033[31m✗\033[0m {nm} nicht gefunden – NICHT PRUEFBAR")
        sys.exit(2)
check("beide Endpunkte gefunden", True)

# ── Attrappen ────────────────────────────────────────────────────────────────
ZEITEN = {"seiten": {"1": "2026-09-28T20:15:00", "3": "2026-09-27T08:00:00"},
          "bereiche": {"NEXUS": "2026-09-28T20:15:00"}}
KAPUTT = {"an": False}
cfa = types.ModuleType("backend.confluence_abgleich")
def _iz():
    if KAPUTT["an"]:
        raise RuntimeError("Stand kaputt")
    return json.loads(json.dumps(ZEITEN))
cfa.import_zeiten = _iz
cc = types.ModuleType("backend.confluence_client")
class ConfluenceError(Exception):
    status = 500
cc.ConfluenceError = ConfluenceError
cfbm = types.ModuleType("backend.confluence_bindung")
class BestandUnlesbar(Exception):
    pass
cfbm.BestandUnlesbar = BestandUnlesbar
cfbm.liste = lambda: []
backend_pkg = types.ModuleType("backend"); backend_pkg.__path__ = []
backend_pkg.confluence_abgleich = cfa
for k, v in {"backend": backend_pkg, "backend.confluence_abgleich": cfa,
             "backend.confluence_client": cc, "backend.confluence_bindung": cfbm}.items():
    sys.modules[k] = v


class JSONResponse:
    def __init__(self, content, status_code=200):
        self.content, self.status_code = content, status_code


class Client:
    configured = True
    def pages_in_space(self, space, limit=500, with_parent=False, with_version=False,
                       with_labels=False):
        return [{"id": "3", "title": "c", "link": "", "parent": "1"},
                {"id": "1", "title": "a", "link": "", "parent": ""},
                {"id": "2", "title": "b", "link": "", "parent": "1"}]


async def _visible(c):
    return [{"key": "NEXUS", "name": "N"}, {"key": "OPS", "name": "O"}]

AKTIV = {"w": (True, True)}
NS = {"JSONResponse": JSONResponse, "Depends": lambda f: None, "require_auth": None,
      "_editable_groups_for": lambda u: ["g1"], "_confluence_client": lambda user="": Client(),
      "_wissen_visible_spaces": _visible, "asyncio": asyncio,
      "_cfb_aktiv": lambda: AKTIV["w"], "_cfb_mit_gruppen": lambda b, u="": b}
for nm in NAMEN:
    f = FN[nm]
    f.decorator_list = []
    exec(compile(ast.Module(body=[f], type_ignores=[]), "main.py", "exec"), NS)


def ruf(nm, **kw):
    return asyncio.run(NS[nm](user="a.bender", **kw))


section("1. Seitenliste: 'importiert' je Seite")
r = ruf("wissen_confluence_pages", space="NEXUS")
seiten = {p["id"]: p for p in (r.content or {}).get("pages") or []}
check("(Positivkontrolle) drei Seiten geliefert", r.status_code == 200 and len(seiten) == 3, str(r.content))
check("⚠ importierte Seite traegt ihr Importdatum",
      seiten.get("1", {}).get("importiert") == "2026-09-28T20:15:00", str(seiten.get("1")))
check("zweite importierte Seite ebenso",
      seiten.get("3", {}).get("importiert") == "2026-09-27T08:00:00", str(seiten.get("3")))
check("⚠ nicht importierte Seite hat KEIN Feld (kein leeres Datum)",
      "importiert" not in seiten.get("2", {}), str(seiten.get("2")))
KAPUTT["an"] = True
r = ruf("wissen_confluence_pages", space="NEXUS")
check("⚠ Stand nicht lesbar: Seitenliste kommt trotzdem, nur ohne Datum",
      r.content.get("ok") is True and len(r.content.get("pages") or []) == 3
      and not any("importiert" in p for p in r.content["pages"]), str(r.content))
KAPUTT["an"] = False


section("2. Bindung: 'importe' je Bereich")
r = ruf("wissen_cf_bindung_lesen")
check("(Positivkontrolle) Antwort ok", r.content.get("ok") is True, str(r.content))
check("⚠ juengster Import je Bereich steht in 'importe'",
      r.content.get("importe") == {"NEXUS": "2026-09-28T20:15:00"}, str(r.content))
AKTIV["w"] = (False, True)
r = ruf("wissen_cf_bindung_lesen")
check("Skill aus: 'importe' leer (der Container erscheint ohnehin nicht)",
      r.content.get("importe") == {}, str(r.content))
AKTIV["w"] = (True, True)
KAPUTT["an"] = True
r = ruf("wissen_cf_bindung_lesen")
check("⚠ Stand nicht lesbar: Bindung bleibt bedienbar, 'importe' leer",
      r.content.get("ok") is True and r.content.get("importe") == {}, str(r.content))

print(f"\n\033[1mErgebnis: {OK}/{OK + FAIL}\033[0m")
sys.exit(1 if FAIL else 0)
