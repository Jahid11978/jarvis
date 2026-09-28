"""SECRET_KEY aufloesen – ohne je einen oeffentlich bekannten Wert zu verwenden.

Mit dem SECRET_KEY werden die Sitzungstokens (``main.generate_token``) und die
Abruf-Schluessel (``download_key``) per HMAC signiert. Wer ihn kennt, stellt
sich fuer JEDEN Benutzernamen ein gueltiges Token aus – ohne Kennwort.

Vorfall 2026-09-28: ``.env.example`` (oeffentlich auf GitHub) trug einen
Beispielwert, ``docs/install.sh`` kopierte die Vorlage unveraendert nach
``.env`` – eine Installation lief damit auf dem Schluessel aus dem Repo.
Deshalb gilt ein Platzhalter hier wie ein FEHLENDER Wert: es wird ein
Zufallsschluessel erzeugt und in ``data/.secret_key`` abgelegt.

Bewusst ohne Import von ``backend.config`` – damit ein Test diese Logik
pruefen kann, ohne die Live-``settings.json`` anzufassen.
"""
import os
import secrets
from pathlib import Path

# Werte, die je in Vorlage oder Doku standen. Alles mit "change-me" am Anfang
# gilt ebenfalls als Platzhalter (Abwandlungen in Anleitungen).
BEKANNTE_PLATZHALTER = frozenset({
    "change-me-to-a-secure-random-string-min-32-chars",   # .env.example bis 2026-09
    "change-me-to-a-random-string",                       # README
})


def ist_platzhalter(wert: str) -> bool:
    """True fuer leer, bekannte Beispielwerte und alles, was mit 'change-me' beginnt."""
    w = (wert or "").strip()
    if not w:
        return True
    return w in BEKANNTE_PLATZHALTER or w.lower().startswith("change-me")


def aufloesen(env_wert: str, datei: Path) -> str:
    """Liefert den zu verwendenden SECRET_KEY.

    Reihenfolge: gesetzter Wert aus der Umgebung, sofern KEIN Platzhalter ->
    sonst ``datei`` (frueher erzeugt) -> sonst neu erzeugen und in ``datei``
    ablegen (0600). Ein Platzhalter in ``datei`` wird ebenfalls verworfen.
    """
    if not ist_platzhalter(env_wert):
        return env_wert.strip()
    if env_wert and env_wert.strip():
        print("[SECURITY] SECRET_KEY in .env ist ein oeffentlich bekannter "
              "Beispielwert und wird IGNORIERT – es gilt der Schluessel aus "
              f"{datei}. Bitte die Zeile SECRET_KEY in .env leeren.", flush=True)
    wert = ""
    if datei.exists():
        wert = datei.read_text().strip()
    if ist_platzhalter(wert):
        wert = secrets.token_hex(32)
        datei.parent.mkdir(parents=True, exist_ok=True)
        datei.write_text(wert)
        os.chmod(str(datei), 0o600)
        print(f"[SECURITY] SECRET_KEY auto-generiert und in {datei} gespeichert", flush=True)
    return wert
