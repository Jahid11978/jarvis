"""Meta-Operationen des Brokers (Freigabeliste, Audit) – EINE Fassung fuer beide Wege.

Bis 2026-09-29 standen sie zweimal: im Daemon und im root-Fallback des Clients
(``broker_client._local_dispatch``). Die zweite Fassung protokollierte beim
Loeschen nicht einmal – zwei Fassungen derselben Regel laufen auseinander.

Befund K2: ``broker.policy_decide`` war "immer erlaubt". Seitdem gilt:

* Eine Entscheidung, die etwas EINSCHRAENKT (``deny``, ``pending``), braucht
  keinen Nachweis – schlimmstenfalls kann ein kompromittiertes Backend eine
  Funktion sperren, aber keine Rechte gewinnen.
* ``allow`` und ``remove`` brauchen den Freigabe-Code (``freigabe.pruefen``).
  ``remove`` gehoert dazu, weil ein geloeschter Eintrag einer Systemoperation
  beim naechsten Aufruf wieder AUTOMATISCH erlaubt angelegt wird – das Loeschen
  einer Ablehnung waere sonst eine Freigabe durch die Hintertuer.
* Jede Entscheidung und jeder abgewiesene Versuch steht im Audit, mit der
  uid des Aufrufers aus dem Kernel (SO_PEERCRED), nicht mit dessen Angabe.
"""

import os

from backend.broker import freigabe, policy


def _stand() -> dict:
    """Woher kommt der laufende Broker-Code? (STAND-Datei der Installation)"""
    from backend.broker import CODE_ROOT
    try:
        import json
        return json.loads((CODE_ROOT / "STAND").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {"quelle": "arbeitsbaum", "pfad": str(CODE_ROOT)}


def _nachweis(args: dict, by: str, op: str, key: str, peer: str) -> dict | None:
    """None = Nachweis gueltig; sonst die Fehlerantwort (bereits auditiert)."""
    ok, grund = freigabe.pruefen(args.get("nachweis"))
    if ok:
        return None
    policy.audit(by, op, key, "abgewiesen", detail=f"Freigabe-Code: {grund}", peer=peer)
    return {"ok": False, "grund": grund,
            "error": freigabe.MELDUNG.get(grund, "Freigabe-Code ungueltig")}


def behandeln(op: str, args: dict, peer: str = "") -> dict | None:
    """Antwort fuer eine Meta-Op, oder None, wenn ``op`` keine ist."""
    args = args or {}
    by = str(args.get("by", ""))
    key = str(args.get("key", ""))
    if op == "broker.ping":
        return {"ok": True, "pid": os.getpid(), "euid": os.geteuid(),
                "stand": _stand(), "freigabe_code": freigabe.eingerichtet()}
    if op == "broker.policy_list":
        return {"ok": True, "ops": policy.list_ops(),
                "freigabe_code": freigabe.eingerichtet()}
    if op == "broker.audit_tail":
        return {"ok": True, "entries": policy.audit_tail(int(args.get("n") or 100))}
    if op == "broker.policy_decide":
        decision = str(args.get("decision", ""))
        if decision == policy.ALLOW:
            fehler = _nachweis(args, by, op, key, peer)
            if fehler:
                return fehler
        entry = policy.decide(key, decision, by)
        if entry is None:
            return {"ok": False, "error": "Unbekannter Key oder ungueltige Entscheidung"}
        policy.audit(by, op, key, decision, peer=peer)
        return {"ok": True, "entry": entry}
    if op == "broker.policy_remove":
        fehler = _nachweis(args, by, op, key, peer)
        if fehler:
            return fehler
        ok = policy.remove(key)
        if ok:
            policy.audit(by, op, key, "removed", peer=peer)
        return {"ok": ok}
    return None
