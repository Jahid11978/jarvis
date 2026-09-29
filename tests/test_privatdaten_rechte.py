#!/usr/bin/env python3
"""Waechter fuer Befund K3 (ECHT, 2026-09-29): Chat-Verlaeufe und Gedaechtnisse
aller Benutzer waren fuer jeden lokalen Benutzer lesbar.

Gemessen auf ECHT: ``data/chat_history/`` 0755 mit ``<benutzer>.json`` 0644,
27 x ``data/memory_<benutzer>.json`` 0644, dazu ``userchat_history.json``,
``support_history.json``, ``user_sessions.json``, ``issues.json``,
``feedback.json`` 0644. Die Shell-Befehle der Domain-Benutzer laufen als
``jarvis_sandbox`` – ein ``cat`` braucht nur das "o+r".

GEPRUEFT WIRD DIE WIRKUNG, NICHT DAS VORKOMMEN: die echten Funktionen laufen in
einem Sandkasten, danach wird der Dateimodus gemessen. Drei Wege, weil jeder
fuer sich schon einmal der Grund war, dass eine Haertung verpuffte:

1. ``harden_data_dirs`` beim Start (Altbestand, inkl. Muster memory_*.json).
2. Schreibwege mit ``tmp`` + ``replace`` (user_sessions, issues): jede Speicherung
   legt eine NEUE Datei mit der umask an – ein chmod beim Start hielte nur bis
   zum naechsten Flush.
3. Das erste Gedaechtnis eines NEUEN Benutzers (tools/memory.py).

Gegenprobe: dasselbe gegen die ungehaertete Fassung zaehlt die FAILs.
"""
import os
import stat
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

_ok = _fail = 0


def check(bez, bedingung):
    """check(Beschreibung, Bedingung) – vertauschte Reihenfolge bricht mit Exit 2 ab."""
    global _ok, _fail
    if not isinstance(bez, str) or isinstance(bedingung, str):
        print(f"ABBRUCH: check(Beschreibung, Bedingung) vertauscht: {bez!r}")
        sys.exit(2)
    if bedingung:
        _ok += 1
        print(f"OK   {bez}")
    else:
        _fail += 1
        print(f"FAIL {bez}")


def modus(p: Path) -> int:
    return stat.S_IMODE(p.stat().st_mode)


def fremd_lesbar(p: Path) -> bool:
    return bool(modus(p) & stat.S_IROTH)


# ── backend.config nur als Stub (der echte Import schreibt die Live-settings.json)
if "backend.config" in sys.modules:
    print("ABBRUCH: backend.config ist bereits geladen.")
    sys.exit(2)
_cfg = types.ModuleType("backend.config")


class _C:
    def get_setting(self, k, d=None):
        return d

    def get(self, k, d=None):
        return d


_cfg.config = _C()
SANDKASTEN = Path(tempfile.mkdtemp(prefix="jarvis_k3_"))
_cfg.PROJECT_ROOT = SANDKASTEN
sys.modules["backend.config"] = _cfg

# Die umask des Dienstes nachbilden: genau sie erzeugt 0644.
os.umask(0o022)

from backend import sandbox as sb                    # noqa: E402

# ── Sandkasten umbiegen; ohne das wuerde die ECHTE data/ angefasst ─────────────
sb.PROJECT_ROOT = SANDKASTEN
if Path(sb.PROJECT_ROOT).resolve() == ROOT.resolve():
    print("ABBRUCH: PROJECT_ROOT zeigt noch auf das Repo.")
    sys.exit(2)

D = SANDKASTEN / "data"
(D / "chat_history").mkdir(parents=True)
(D / "rag").mkdir()
(D / "knowledge").mkdir()
for p in (D, D / "chat_history", D / "rag", D / "knowledge"):
    p.chmod(0o755)
alt = {
    "chat_history/anna.muster.json": "[]",
    "memory_anna.muster.json": "{}",
    "memory_anna.muster.json.bak": "{}",
    "userchat_history.json": "{}",
    "support_history.json": "{}",
    "user_sessions.json": "{}",
    "issues.json": "[]",
    "feedback.json": "[]",
    "rag/handbuch.txt": "Wissen",
}
for rel, inhalt in alt.items():
    f = D / rel
    f.write_text(inhalt, encoding="utf-8")
    f.chmod(0o644)

# ── Positivkontrolle: Ausgangslage ist wirklich die von ECHT ───────────────────
if not all(fremd_lesbar(D / r) for r in alt) or modus(D / "chat_history") != 0o755:
    print("ABBRUCH: Ausgangslage (0644/0755) liess sich nicht herstellen.")
    sys.exit(2)
if not hasattr(sb, "harden_data_dirs"):
    print("ABBRUCH: sandbox.harden_data_dirs fehlt.")
    sys.exit(2)

# ══ 1. Start-Haertung ════════════════════════════════════════════════════════
sb.harden_data_dirs()
check("chat_history/ fuer Fremde nicht mehr begehbar",
      not (modus(D / "chat_history") & (stat.S_IROTH | stat.S_IXOTH)))
# chat_history/<benutzer>.json darf 0644 bleiben – das geschlossene Verzeichnis
# ist die Schranke (wie bei data/chats).
for rel in ("memory_anna.muster.json", "memory_anna.muster.json.bak",
            "userchat_history.json", "support_history.json",
            "user_sessions.json", "issues.json", "feedback.json"):
    check(f"{rel} nach Start-Haertung nicht fremd lesbar", not fremd_lesbar(D / rel))
# Gegenrichtung: was die Shell lesen SOLL, bleibt lesbar.
check("data/ bleibt begehbar (Wissen)", bool(modus(D) & stat.S_IXOTH))
check("data/rag bleibt lesbar", bool(modus(D / "rag") & stat.S_IROTH))
check("data/rag/handbuch.txt bleibt lesbar", fremd_lesbar(D / "rag/handbuch.txt"))
check("data/knowledge bleibt begehbar", bool(modus(D / "knowledge") & stat.S_IXOTH))

# ══ 2. Atomare Schreibwege ═══════════════════════════════════════════════════
from backend import user_sessions as us            # noqa: E402
us.STORE_PATH = D / "user_sessions.json"
us._users.clear()
us._users["anna.muster"] = {"ip": "10.0.0.1"}
us._write_unlocked()
check("user_sessions.json nach Speichern nicht fremd lesbar",
      not fremd_lesbar(D / "user_sessions.json"))

from backend import issues as iss                  # noqa: E402
iss.ISSUES_FILE = D / "issues.json"
iss.ADMIN_SEEN_FILE = D / "issues_admin_seen.json"
iss._save_all([{"id": "1", "text": "Meldung"}])
check("issues.json nach Speichern nicht fremd lesbar", not fremd_lesbar(D / "issues.json"))
iss._save_admin_seen({"admin": "2026-09-29"})
check("issues_admin_seen.json nach Speichern nicht fremd lesbar",
      not fremd_lesbar(D / "issues_admin_seen.json"))

# ══ 3. Neues Gedaechtnis ═════════════════════════════════════════════════════
from backend.tools import memory as mem            # noqa: E402
mem._DATA_DIR = D
mem.MEMORY_FILE = D / "memory.json"
neu = mem._get_memory_path("bert.neu")
if neu.exists() or neu.parent != D:
    print(f"ABBRUCH: Gedaechtnispfad unerwartet: {neu}")
    sys.exit(2)
mem._save_memory_dict({"lieblingsfarbe": "blau"}, "bert.neu")
check("neues memory_<benutzer>.json nicht fremd lesbar",
      neu.exists() and not fremd_lesbar(neu))
mem._save_memory_dict({"lieblingsfarbe": "gruen"}, "bert.neu")
bak = neu.with_suffix(".json.bak")
check("memory_<benutzer>.json.bak nicht fremd lesbar", bak.exists() and not fremd_lesbar(bak))
check("memory_<benutzer>.json nach zweitem Speichern nicht fremd lesbar", not fremd_lesbar(neu))

# ══ 4. Neues chat_history-Verzeichnis (frische Installation) ═════════════════
import shutil                                        # noqa: E402
from backend import chat_history as ch             # noqa: E402
ch._DIR = SANDKASTEN / "frisch" / "chat_history"
ch.append("anna.muster", {"role": "user", "text": "hallo"})
check("frisch angelegtes chat_history/ fuer Fremde nicht begehbar",
      ch._DIR.is_dir() and not (modus(ch._DIR) & (stat.S_IROTH | stat.S_IXOTH)))

shutil.rmtree(SANDKASTEN, ignore_errors=True)
print(f"\n{_ok} OK, {_fail} FAIL")
if _ok == 0:
    sys.exit(2)
sys.exit(1 if _fail else 0)
