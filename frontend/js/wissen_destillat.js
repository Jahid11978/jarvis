/* Wissens-Destillat – Container unter /wissen.
 *
 * Importiert aus dev-core-busy/knowledge-distiller (2026-09-26). Der dortige
 * Proxy-Teil ist ersatzlos entfallen: er meldet sich bei Jarvis an und schickt
 * den Text per WebSocket – hier laufen wir IN Jarvis, sind angemeldet und
 * rufen die eigenen Endpunkte.
 *
 * ⚠ DIE TEXTEXTRAKTION LAEUFT SERVERSEITIG. Das Original laedt pdf.js und
 * mammoth.js von cdnjs.cloudflare.com; externe Einbindungen sind in diesem
 * Projekt ausdruecklich verboten (Register: "Nie wieder extern einbinden").
 * Gewonnen wird dabei mehr als die Regel – der Server kann OCR fuer gescannte
 * PDFs, XLSX, PPTX und OneNote, der Browser nicht.
 *
 * Schnittstelle: `WissenDestillat.init({ scope, token })` aus wissen.js.
 * Bewusst KEIN eigener Scope-Abruf – `/api/wissen/scope` wird dort ohnehin
 * geholt, und zwei Abrufe liefen beim naechsten Feinschliff auseinander.
 */
(function () {
    'use strict';

    var SCOPE = null, TOKEN = '';
    var dateien = [];        // [{name, size, ok, fehler}]
    var bilder = [];         // data:-URIs, Index = [BILD-N] - 1
    var quellen = [];        // Namen der erfolgreich gelesenen Dateien
    var destillat = '';      // rohes Markdown der letzten Antwort
    var laeuft = false;

    function $(id) { return document.getElementById(id); }
    function t(k, vars) {
        var s = (window.t ? window.t(k) : k) || k;
        if (vars) { for (var v in vars) s = s.split('{' + v + '}').join(vars[v]); }
        return s;
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }
    function authH(extra) {
        return Object.assign({ 'Authorization': 'Bearer ' + TOKEN }, extra || {});
    }

    // ⚠ LOOKBEHIND ALS STRING, NICHT ALS LITERAL – und das ist kein Stil.
    // Ein `(?<=…)` im Literal wirft schon beim PARSEN der Datei; auf Safari
    // vor 16.4 (alles vor 2023) waere damit nicht die Fettschrift weg, sondern
    // der GANZE Container. Als `new RegExp` im try verschiebt sich das auf die
    // Laufzeit: fehlt die Unterstuetzung, bleibt `**text**` literal stehen und
    // alles andere arbeitet. Steht woertlich im Register (avatar.js, 2026-09-14).
    // Die Fett-Regel ist zeichengleich zu `avatar.js::_FETT_RE` und dem
    // Jira-Plugin – die `\S`-Waechter sind der Unterschied zwischen brauchbar
    // und gefaehrlich: ohne sie werden `2 * 3 * 4` und `*.txt` ausgezeichnet.
    var _FETT = null, _KURSIV = null;
    try {
        _FETT = new RegExp('\\*\\*(?=\\S)([^\\n]+?)(?<=\\S)\\*\\*', 'g');
        _KURSIV = new RegExp('(^|[^*])\\*(?=\\S)([^*\\n]+?)(?<=\\S)\\*(?!\\*)', 'g');
    } catch (e) { _FETT = null; _KURSIV = null; }

    // ── Markdown ────────────────────────────────────────────────────────
    // Minimaler Renderer, uebernommen aus dem Original und GEHAERTET.
    //
    // ⚠ MASKIERT WIRD ZUERST. Der Text kommt vom Modell, das hochgeladene
    // Fremddokumente verarbeitet hat – ein `<img src=x onerror=...>` darin
    // liefe sonst im Origin von /wissen, und dort liegt das Sitzungstoken im
    // localStorage. Erst `esc()`, dann die Markdown-Regeln: danach kann kein
    // Markup mehr aus dem Inhalt entstehen, nur noch aus unseren Regeln.
    function md(text) {
        var s = esc(String(text || ''));

        // Codebloecke zuerst wegsichern, damit die Regeln darunter nicht
        // hineingreifen (ein `**` in einem Codebeispiel ist kein Fettdruck).
        var blocks = [], bi = 0;
        s = s.replace(/```[a-zA-Z0-9]*\n([\s\S]*?)```/g, function (m, code) {
            blocks.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
            return '\u0000BLOCK' + (bi++) + '\u0000';
        });
        var inline = [], ii = 0;
        s = s.replace(/`([^`\n]+)`/g, function (m, code) {
            inline.push('<code>' + code + '</code>');
            return '\u0000CODE' + (ii++) + '\u0000';
        });

        // Bilder VOR den Links: `![alt](url)` ist sonst ein Link mit `!` davor.
        // Erlaubt sind nur data:-Bilder (unsere eingebetteten) und http(s).
        s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, url) {
            if (/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/.test(url)
                || /^https?:\/\//.test(url)) {
                return '<img src="' + url + '" alt="' + alt + '">';
            }
            return alt || '';   // alles andere: nur der Alt-Text
        });
        // Nur http(s) wird verlinkt. `javascript:` und `data:` bleiben damit
        // strukturell aussen vor – ein Link darauf liefe im Origin von /wissen.
        s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        s = s.replace(/^###### (.+)$/gm, '<h3>$1</h3>')
             .replace(/^##### (.+)$/gm, '<h3>$1</h3>')
             .replace(/^#### (.+)$/gm, '<h3>$1</h3>')
             .replace(/^### (.+)$/gm, '<h3>$1</h3>')
             .replace(/^## (.+)$/gm, '<h2>$1</h2>')
             .replace(/^# (.+)$/gm, '<h1>$1</h1>');
        s = s.replace(/^\s*---\s*$/gm, '<hr>');
        if (_FETT) s = s.replace(_FETT, '<strong>$1</strong>');
        if (_KURSIV) s = s.replace(_KURSIV, '$1<em>$2</em>');

        // Listen: zusammenhaengende Zeilen zu EINER Liste buendeln.
        s = s.replace(/(?:^[-*+] .+$\n?)+/gm, function (block) {
            var li = block.trim().split('\n').map(function (z) {
                return '<li>' + z.replace(/^[-*+] /, '') + '</li>';
            }).join('');
            return '<ul>' + li + '</ul>\n';
        });
        s = s.replace(/(?:^\d+\. .+$\n?)+/gm, function (block) {
            var li = block.trim().split('\n').map(function (z) {
                return '<li>' + z.replace(/^\d+\. /, '') + '</li>';
            }).join('');
            return '<ol>' + li + '</ol>\n';
        });

        s = s.split(/\n{2,}/).map(function (abs) {
            var a = abs.trim();
            if (!a) return '';
            if (/^<(h[123]|ul|ol|pre|hr|img)/.test(a)) return a;
            if (a.indexOf('\u0000BLOCK') === 0) return a;
            return '<p>' + a.replace(/\n/g, '<br>') + '</p>';
        }).join('\n');

        s = s.replace(/\u0000BLOCK(\d+)\u0000/g, function (m, i) { return blocks[+i]; });
        s = s.replace(/\u0000CODE(\d+)\u0000/g, function (m, i) { return inline[+i]; });
        return s;
    }

    // `[BILD-N]` -> eingebettetes Bild. NUR fuer Anzeige und Download; was in
    // die Wissensdatenbank geht, ersetzt der Server durch einen Hinweis (ein
    // Base64-Bild wuerde dort zu Dutzenden nutzloser Vektor-Chunks).
    function mitBildern(text) {
        return String(text || '').replace(/\[BILD-(\d+)\]/g, function (m, n) {
            var i = parseInt(n, 10) - 1;
            return (i >= 0 && i < bilder.length)
                ? '\n\n![Bild](' + bilder[i] + ')\n\n' : m;
        });
    }

    // ── Anzeige ─────────────────────────────────────────────────────────
    function status(el, msg, art) {
        var e = $(el); if (!e) return;
        e.innerHTML = msg
            ? '<span class="' + (art === 'err' ? 'wi-err' : art === 'ok' ? 'wi-ok' : '')
              + '">' + esc(msg) + '</span>' : '';
    }
    function fortschritt(pct) {
        var bar = $('wi-dest-bar'), fill = $('wi-dest-fill');
        if (!bar || !fill) return;
        if (pct == null) { bar.hidden = true; fill.style.width = '0%'; return; }
        bar.hidden = false;
        fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    }
    function bytes(b) {
        if (b < 1024) return b + ' B';
        if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
        return (b / 1024 / 1024).toFixed(1) + ' MB';
    }

    function dateilisteZeichnen() {
        var box = $('wi-dest-filelist'); if (!box) return;
        if (!dateien.length) { box.innerHTML = ''; return; }
        box.innerHTML = dateien.map(function (d, i) {
            return '<div class="wi-item wi-dest-file">'
                + '<span class="nm" title="' + esc(d.name) + '">' + esc(d.name) + '</span>'
                + (d.fehler ? '<span class="er" title="' + esc(d.fehler) + '">'
                              + esc(t('wissen.dest_unreadable')) + '</span>'
                            : '<span class="sz">' + bytes(d.size) + '</span>')
                + '<button type="button" class="wi-icon-btn" data-idx="' + i + '" title="'
                + esc(t('common.delete')) + '" aria-label="' + esc(t('common.delete')) + '">'
                + (window.JarvisIcons ? window.JarvisIcons.trash() : '') + '</button>'
                + '</div>';
        }).join('');
        Array.prototype.forEach.call(box.querySelectorAll('button[data-idx]'), function (b) {
            b.addEventListener('click', function () {
                dateien.splice(parseInt(b.getAttribute('data-idx'), 10), 1);
                dateilisteZeichnen();
            });
        });
    }

    function zaehlerZeichnen() {
        var ta = $('wi-dest-text'), z = $('wi-dest-count');
        if (!ta || !z) return;
        var n = ta.value.length;
        z.textContent = n ? t('wissen.dest_chars', { n: n.toLocaleString() }) : '';
        var run = $('wi-dest-run');
        // Gesperrt MIT GRUND statt verborgen (Projektregel): ein Knopf, der je
        // nach Datenlage verschwindet, ist unerklaerbar.
        if (run) {
            run.disabled = laeuft || !ta.value.trim();
            run.title = laeuft ? t('wissen.dest_running')
                : (ta.value.trim() ? '' : t('wissen.dest_need_text'));
        }
    }

    // ── Extraktion ──────────────────────────────────────────────────────
    function dateienNehmen(liste) {
        if (!liste || !liste.length) return;
        var fd = new FormData();
        var neu = [];
        Array.prototype.forEach.call(liste, function (f) {
            fd.append('files', f, f.name);
            neu.push({ name: f.name, size: f.size });
        });
        dateien = dateien.concat(neu);
        dateilisteZeichnen();
        status('wi-dest-exstatus', t('wissen.dest_extracting'));

        fetch('/api/wissen/destillat/extract', {
            method: 'POST', headers: authH(), body: fd
        })
            .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
            .then(function (res) {
                if (res.s !== 200 || !res.d.ok) {
                    status('wi-dest-exstatus', res.d.error || t('wissen.dest_extract_failed'), 'err');
                    return;
                }
                var d = res.d;
                // Fehler je Datei an der ZEILE vermerken, nicht nur als Summe:
                // "3 Fehler" sagt nicht, WELCHE Datei nicht lesbar war.
                dateien.forEach(function (x) {
                    if (d.fehler && d.fehler[x.name]) x.fehler = d.fehler[x.name];
                });
                dateilisteZeichnen();
                bilder = d.bilder || [];
                quellen = d.ok || [];

                var ta = $('wi-dest-text');
                if (ta) {
                    // ANHAENGEN, nicht ersetzen: wer schon Text eingegeben oder
                    // eine erste Datei gelesen hat, verliert ihn sonst.
                    ta.value = ta.value.trim()
                        ? ta.value.replace(/\s*$/, '') + '\n\n' + d.text : d.text;
                    zaehlerZeichnen();
                }
                var teile = [t('wissen.dest_extracted', { n: (d.ok || []).length })];
                var fehlZahl = Object.keys(d.fehler || {}).length;
                if (fehlZahl) teile.push(t('wissen.dest_failed_n', { n: fehlZahl }));
                // Eine Kuerzung wird BEZIFFERT, nie stillschweigend gemacht.
                if (d.gekappt) teile.push(t('wissen.dest_capped'));
                status('wi-dest-exstatus', teile.join(' · '), fehlZahl ? 'err' : 'ok');
            })
            .catch(function (e) {
                status('wi-dest-exstatus', String(e && e.message || e), 'err');
            });
    }

    // ── Lauf ────────────────────────────────────────────────────────────
    function destillieren() {
        var ta = $('wi-dest-text');
        if (!ta || !ta.value.trim() || laeuft) return;
        laeuft = true;
        zaehlerZeichnen();
        var run = $('wi-dest-run');
        if (run) { run.disabled = true; run.title = t('wissen.dest_running'); }
        status('wi-dest-status', t('wissen.dest_running'));
        fortschritt(8);

        // Der Balken bewegt sich waehrend des Laufs weiter. Es ist bewusst eine
        // SCHAETZUNG und keine Messung – der Endpunkt antwortet erst am Ende;
        // er laeuft deshalb nur bis 90 und nie auf 100.
        var tick = setInterval(function () {
            var f = $('wi-dest-fill');
            if (!f) return;
            var jetzt = parseFloat(f.style.width) || 8;
            if (jetzt < 90) fortschritt(jetzt + 2);
        }, 2000);

        fetch('/api/wissen/destillat/lauf', {
            method: 'POST', headers: authH({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                text: ta.value,
                prompt: ($('wi-dest-prompt') || {}).value || '',
                gruppen_prompt: ($('wi-dest-gruppen') || {}).value || '',
                je_datei: ($('wi-dest-mode') || {}).value === 'file'
            })
        })
            .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
            .then(function (res) {
                clearInterval(tick);
                if (res.s !== 200 || !res.d.ok) {
                    fortschritt(null);
                    status('wi-dest-status', res.d.error || t('wissen.dest_failed'), 'err');
                    return;
                }
                fortschritt(100);
                destillat = res.d.markdown || '';
                ergebnisZeichnen(res.d);
                status('wi-dest-status', t('wissen.dest_done'), 'ok');
                setTimeout(function () { fortschritt(null); }, 1200);
            })
            .catch(function (e) {
                clearInterval(tick);
                fortschritt(null);
                status('wi-dest-status', String(e && e.message || e), 'err');
            })
            .then(function () {
                laeuft = false;
                zaehlerZeichnen();
            });
    }

    function ergebnisZeichnen(d) {
        var out = $('wi-dest-out'), box = $('wi-dest-md');
        if (!out || !box) return;
        out.hidden = false;
        box.innerHTML = md(mitBildern(destillat));
        var meta = [t('wissen.dest_chars', { n: destillat.length.toLocaleString() })];
        if (d && d.bloecke > 1) meta.push(t('wissen.dest_blocks', { n: d.bloecke }));
        if (d && d.gekappt) meta.push(t('wissen.dest_capped'));
        var m = $('wi-dest-meta'); if (m) m.textContent = meta.join(' · ');
        var tb = $('wi-dest-takebox'); if (tb) tb.hidden = true;
        status('wi-dest-takestatus', '');
    }

    // ── Ergebnis verwerten ──────────────────────────────────────────────
    function dateiname() {
        var d = new Date();
        return 'destillat_' + d.toISOString().slice(0, 10) + '.md';
    }
    function kopieren() {
        var text = mitBildern(destillat);
        if (!navigator.clipboard) {
            status('wi-dest-takestatus', t('wissen.dest_copy_manual'), 'err');
            return;
        }
        navigator.clipboard.writeText(text).then(function () {
            status('wi-dest-status', t('wissen.dest_copied'), 'ok');
        }).catch(function () {
            // Fehlschlag MELDEN: in der Zwischenablage sieht man nichts, und
            // `navigator.clipboard` fehlt in unsicheren Kontexten ganz.
            status('wi-dest-status', t('wissen.dest_copy_manual'), 'err');
        });
    }
    function herunterladen() {
        var blob = new Blob([mitBildern(destillat)],
                            { type: 'text/markdown;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = dateiname();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        status('wi-dest-status', t('wissen.dest_saved'), 'ok');
    }

    function gruppenBoxen() {
        if (!SCOPE || !SCOPE.groups) return '';
        return SCOPE.groups.map(function (g) {
            // Bei genau EINER Gruppe gibt es nichts zu waehlen – vorbelegen.
            var an = SCOPE.groups.length === 1;
            return '<label class="wi-grpbox" style="border-color:' + esc(g.color) + ';">'
                + '<input type="checkbox" class="wi-grp-dest" value="' + esc(g.id) + '"'
                + (an ? ' checked' : '') + '>'
                + '<span style="font-weight:600;">' + esc(g.name) + '</span></label>';
        }).join('');
    }
    function gewaehlteGruppen() {
        return Array.prototype.slice.call(
            document.querySelectorAll('.wi-grp-dest:checked')
        ).map(function (c) { return c.value; });
    }

    function uebernahmeZeigen() {
        var box = $('wi-dest-takebox'); if (!box) return;
        var g = $('wi-dest-groups');
        // Nur EINMAL zeichnen: ein Neuaufbau verwuerfe die gesetzten Haken.
        if (g && !g.innerHTML.trim()) g.innerHTML = gruppenBoxen();
        box.hidden = false;
        status('wi-dest-takestatus', '');
    }

    function uebernehmen() {
        var groups = gewaehlteGruppen();
        if (!groups.length) {
            // VORHANDENER Schluessel, kein neuer: gleiche Bedeutung, gleicher
            // Text – zwei Schluessel dafuer liefen beim naechsten
            // Umformulieren auseinander.
            status('wi-dest-takestatus', t('wissen.pick_group'), 'err');
            return;
        }
        var btn = $('wi-dest-takego');
        if (btn) btn.disabled = true;
        status('wi-dest-takestatus', t('wissen.dest_taking'));
        fetch('/api/wissen/destillat/uebernehmen', {
            method: 'POST', headers: authH({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                markdown: destillat, groups: groups,
                quelle: quellen.join(', '), bilder: bilder
            })
        })
            .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
            .then(function (res) {
                if (res.s !== 201 || !res.d.ok) {
                    status('wi-dest-takestatus', res.d.error || t('wissen.dest_take_failed'), 'err');
                    return;
                }
                status('wi-dest-takestatus',
                       t('wissen.dest_taken', { titel: res.d.title || '' }), 'ok');
                // Die Entwurfsliste weiter unten muss den neuen Eintrag zeigen –
                // sonst sucht der Benutzer ihn dort vergeblich.
                if (window.WissenPortal && window.WissenPortal.reloadPending) {
                    window.WissenPortal.reloadPending();
                }
            })
            .catch(function (e) {
                status('wi-dest-takestatus', String(e && e.message || e), 'err');
            })
            .then(function () { if (btn) btn.disabled = false; });
    }

    // ── Aufbau ──────────────────────────────────────────────────────────
    function vorgabenSetzen() {
        // Die Vorgabe-Aufträge kommen aus i18n, damit sie dem Sprachwechsel
        // folgen – der Text ist eine Anweisung an das Modell und gehoert in die
        // Sprache des Benutzers.
        var p = $('wi-dest-prompt'), g = $('wi-dest-gruppen');
        if (p) p.value = t('wissen.dest_prompt_default');
        if (g) g.value = t('wissen.dest_gruppen_default');
    }

    function init(opt) {
        opt = opt || {};
        SCOPE = opt.scope || null;
        TOKEN = opt.token || '';
        var sec = $('wi-sec-destillat');
        if (!sec) return;
        // Sichtbarkeit GENAU WIE DER INFORMATIONSEXTRAKTOR: ohne Wissensgruppe
        // gibt es kein Ziel fuer die Uebernahme und keinen Bereich.
        if (!SCOPE || !SCOPE.groups || !SCOPE.groups.length) {
            sec.classList.add('hidden');
            return;
        }
        sec.classList.remove('hidden');
        if (sec.getAttribute('data-bereit') === '1') return;
        sec.setAttribute('data-bereit', '1');

        vorgabenSetzen();
        zaehlerZeichnen();

        var drop = $('wi-dest-drop'), input = $('wi-dest-files');
        if (drop && input) {
            drop.addEventListener('click', function () { input.click(); });
            input.addEventListener('change', function () {
                dateienNehmen(input.files);
                input.value = '';   // dieselbe Datei erneut waehlbar
            });
            ['dragenter', 'dragover'].forEach(function (ev) {
                drop.addEventListener(ev, function (e) {
                    // NUR bei Dateien abfangen – gezogener Text soll sich
                    // weiterhin normal verhalten.
                    if (e.dataTransfer && Array.prototype.indexOf.call(
                            e.dataTransfer.types || [], 'Files') === -1) return;
                    e.preventDefault(); drop.classList.add('drag');
                });
            });
            ['dragleave', 'drop'].forEach(function (ev) {
                drop.addEventListener(ev, function () { drop.classList.remove('drag'); });
            });
            drop.addEventListener('drop', function (e) {
                if (!e.dataTransfer || !e.dataTransfer.files.length) return;
                e.preventDefault();
                dateienNehmen(e.dataTransfer.files);
            });
        }

        var ta = $('wi-dest-text');
        if (ta) ta.addEventListener('input', zaehlerZeichnen);

        var run = $('wi-dest-run'); if (run) run.addEventListener('click', destillieren);
        var rst = $('wi-dest-reset'); if (rst) rst.addEventListener('click', function () {
            vorgabenSetzen();
            status('wi-dest-status', t('wissen.dest_reset_done'), 'ok');
        });
        var cp = $('wi-dest-copy'); if (cp) cp.addEventListener('click', kopieren);
        var dl = $('wi-dest-dl'); if (dl) dl.addEventListener('click', herunterladen);
        var tk = $('wi-dest-take'); if (tk) tk.addEventListener('click', uebernahmeZeigen);
        var tg = $('wi-dest-takego'); if (tg) tg.addEventListener('click', uebernehmen);
        var tc = $('wi-dest-takecancel');
        if (tc) tc.addEventListener('click', function () {
            var b = $('wi-dest-takebox'); if (b) b.hidden = true;
        });

        // Die Vorgabe-Aufträge folgen dem Sprachwechsel. `applyLang()` erreicht
        // sie nicht – sie stehen als WERT in einem Textfeld, nicht als
        // data-i18n-Text. Ein vom Benutzer geaenderter Auftrag bleibt aber
        // stehen: seine Arbeit gehoert ihm.
        window.addEventListener('jarvis-lang-changed', function () {
            var p = $('wi-dest-prompt'), g = $('wi-dest-gruppen');
            if (p && !p.dataset.beruehrt) p.value = t('wissen.dest_prompt_default');
            if (g && !g.dataset.beruehrt) g.value = t('wissen.dest_gruppen_default');
            zaehlerZeichnen();
        });
        ['wi-dest-prompt', 'wi-dest-gruppen'].forEach(function (id) {
            var e = $(id);
            if (e) e.addEventListener('input', function () { e.dataset.beruehrt = '1'; });
        });
    }

    window.WissenDestillat = { init: init, _md: md, _mitBildern: mitBildern };
})();
