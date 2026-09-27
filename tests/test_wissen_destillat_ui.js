/* Waechter: Wissens-Destillat unter /wissen (Import aus knowledge-distiller).
 *
 * Gemessen wird am ECHTEN DOM: die echte `wissen.html` mit dem echten
 * `wissen_destillat.js`, `icons.js` und `i18n.js` – ein UI-Test, der weniger
 * laedt als die Seite, prueft eine Kette, die es nicht gibt. Geklickt und
 * getippt wird wirklich; ob ein Container ERSCHEINT und wohin ein Klick
 * fuehrt, kann eine Quelltext-Suche nicht beantworten.
 *
 * Geprueft wird die EIGENSCHAFT, nicht ein Wortlaut:
 *   1. der Container liegt ZWISCHEN Informationsextraktor und Confluence –
 *      gemessen an der DOM-Reihenfolge, nicht an der Zeile im Markup
 *   2. Sichtbarkeit GENAU WIE DER EXTRAKTOR: ohne Wissensgruppe versteckt
 *   3. der Markdown-Renderer laesst KEIN fremdes Markup durch (der Text kommt
 *      vom Modell, das hochgeladene Fremddokumente verarbeitet hat)
 *   4. Bilder: Download bettet ein, die Wissensdatenbank bekommt den Hinweis
 *   5. der Destillieren-Knopf ist ohne Text GESPERRT MIT GRUND
 *   6. die Uebernahme sendet die gewaehlten Gruppen und weist eine leere
 *      Auswahl ab, BEVOR sie den Server fragt
 *   7. kein Lookbehind-LITERAL in der Datei (wuerde auf Safari < 16.4 schon
 *      beim Parsen werfen – dann waere der ganze Container tot)
 */
'use strict';
const fs = require('fs');
const path = require('path');

// jsdom liegt je Maschine anders. Fehlt es: EXIT 2, nicht 0 – "konnte nicht
// laufen" darf nie wie "bestanden" aussehen.
let JSDOM;
for (const kandidat of [process.env.JSDOM_PATH, 'jsdom',
                        path.resolve(__dirname, '../node_modules/jsdom'),
                        path.resolve(__dirname, '../data/node_modules/jsdom'),
                        '/tmp/node_modules/jsdom',
                        '/usr/share/nodejs/jsdom'].filter(Boolean)) {
    try { JSDOM = require(kandidat).JSDOM; break; } catch (e) { /* naechster */ }
}
if (!JSDOM) {
    console.log('\x1b[31mABBRUCH: jsdom nicht installiert (JSDOM_PATH setzen)\x1b[0m');
    process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
let ok = 0, fail = 0;
let bilanz = false;

// ⚠ FRUEH REGISTRIEREN. Stuende das erst am Dateiende, gaebe es kein Fenster,
// in dem es mit bilanz===false laeuft – der Wachhund koennte nie feuern
// (Register: genau so gebaut und gemessen worden).
process.on('exit', function (code) {
    if (!bilanz) {
        console.log('\n\x1b[31mABGEBROCHEN – keine Bilanz\x1b[0m');
        if (code === 0) process.exitCode = 1;
    }
});

function abschnitt(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }
function check(name, cond, detail) {
    if (typeof name !== 'string') {
        console.log('\x1b[31mABBRUCH: check() falsch herum aufgerufen\x1b[0m');
        process.exit(2);
    }
    if (cond) { ok++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
    else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? ' – ' + detail : '')); }
}

const HTML = fs.readFileSync(path.join(ROOT, 'frontend/wissen.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'frontend/js/wissen_destillat.js'), 'utf8');
const I18N = fs.readFileSync(path.join(ROOT, 'frontend/js/i18n.js'), 'utf8');
const ICONS = fs.readFileSync(path.join(ROOT, 'frontend/js/icons.js'), 'utf8');

/* Baut die echte Seite und fuehrt das echte Modul aus.
 * `gruppen`: Wissensgruppen des Scope (leer = kein Bereich).
 * `antworten`: Routen der fetch-Attrappe, ueber den PFAD (nicht die volle URL:
 * ein spaeter ergaenztes ?x= verfehlt sonst jede Route).            */
function seite(gruppen, antworten) {
    const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'https://x/wissen' });
    const w = dom.window;
    w.localStorage.setItem('jarvis_token', 'tok');
    const gesendet = [];
    w.fetch = function (url, opt) {
        const pfad = String(url).split('?')[0];
        gesendet.push({ pfad: pfad, opt: opt || {} });
        const a = (antworten || {})[pfad];
        const d = typeof a === 'function' ? a() : (a || { ok: true });
        return Promise.resolve({
            status: d.__status || 200,
            json: function () { return Promise.resolve(d); }
        });
    };
    w.eval(ICONS);
    w.eval(I18N);
    w.eval(JS);
    w.WissenDestillat.init({
        scope: { groups: gruppen || [], folders: [], user: 'tester' },
        token: 'tok'
    });
    return { w: w, doc: w.document, gesendet: gesendet };
}

const GRUPPEN = [{ id: 'technik', name: 'Technik', color: '#4f6ef7' },
                 { id: 'vertrieb', name: 'Vertrieb', color: '#22c55e' }];

// ════════════════════════════════════════════════════════════════════════════
abschnitt('1. Der Container liegt ZWISCHEN Extraktor und Confluence');
{
    const { doc } = seite(GRUPPEN, {});
    const alle = Array.prototype.map.call(
        doc.querySelectorAll('.wi-section'), function (s) { return s.id; });
    const iUp = alle.indexOf('wi-sec-upload');
    const iDe = alle.indexOf('wi-sec-destillat');
    const iCf = alle.indexOf('wi-sec-cfbind');
    check('alle drei Container existieren',
          iUp >= 0 && iDe >= 0 && iCf >= 0, alle.join(', '));
    // ⚠ GEMESSEN AN DER DOM-REIHENFOLGE. Eine Suche nach der Zeilennummer im
    // Markup waere eine Aussage ueber die Datei, nicht ueber die Seite.
    check('Destillat steht NACH dem Informationsextraktor', iUp >= 0 && iDe > iUp,
          iUp + ' / ' + iDe);
    check('Destillat steht VOR der Confluence-Einbindung', iCf >= 0 && iDe < iCf,
          iDe + ' / ' + iCf);

    const sec = doc.getElementById('wi-sec-destillat');
    check('hat eine Kopfzeile mit Klapp-Pfeil (wie die Nachbarn)',
          !!(sec && sec.querySelector('h2 .wi-sec-tog')));
    check('die Kopfzeile ist uebersetzbar',
          !!(sec && sec.querySelector('h2 [data-i18n="wissen.sec_dest"]')));
}

// ════════════════════════════════════════════════════════════════════════════
abschnitt('2. Sichtbarkeit wie der Informationsextraktor');
{
    const mit = seite(GRUPPEN, {});
    const secMit = mit.doc.getElementById('wi-sec-destillat');
    check('MIT Wissensgruppe: sichtbar', !secMit.classList.contains('hidden'));

    const ohne = seite([], {});
    const secOhne = ohne.doc.getElementById('wi-sec-destillat');
    check('OHNE Wissensgruppe: versteckt', secOhne.classList.contains('hidden'));
    // Gegenprobe der Messung: der Extraktor verhaelt sich genauso. Ohne diese
    // Zeile koennte die Zusage "wie der Extraktor" auseinanderlaufen, ohne dass
    // es auffaellt.
    check('… und das Modul sendet dann NICHTS', ohne.gesendet.length === 0,
          JSON.stringify(ohne.gesendet.map(function (g) { return g.pfad; })));
}

// ════════════════════════════════════════════════════════════════════════════
abschnitt('3. Markdown-Renderer: Fremdtext kann kein Markup einschleusen');
{
    const { w } = seite(GRUPPEN, {});
    const md = w.WissenDestillat._md;

    const boese = md('<img src=x onerror=alert(1)> <script>alert(2)</script>');
    check('kein <img> aus dem Inhalt', boese.indexOf('<img') === -1, boese.slice(0, 60));
    check('kein <script> aus dem Inhalt', boese.toLowerCase().indexOf('<script') === -1);

    // Die Regeln selbst muessen aber arbeiten – sonst waere "sicher" trivial.
    check('Ueberschrift wird gerendert', md('# Titel').indexOf('<h1>Titel</h1>') >= 0);
    check('Fettschrift wird gerendert',
          md('ein **wichtiges** Wort').indexOf('<strong>wichtiges</strong>') >= 0);
    check('Liste wird gerendert', /<ul><li>a<\/li><li>b<\/li><\/ul>/.test(md('- a\n- b')));
    check('Codeblock bleibt Code',
          md('```\n**nicht fett**\n```').indexOf('<strong>') === -1);

    // ⚠ NUR http(s) und unsere data:-Bilder. Ein `javascript:`-Link liefe im
    // Origin von /wissen – dort liegt das Sitzungstoken im localStorage.
    check('javascript:-Link wird NICHT verlinkt',
          md('[klick](javascript:alert(1))').indexOf('<a ') === -1);
    check('http-Link wird verlinkt',
          md('[x](https://example.com)').indexOf('href="https://example.com"') >= 0);
    check('fremdes Bild-Schema wird verworfen (nur Alt-Text bleibt)',
          md('![alt](javascript:x)').indexOf('<img') === -1);
    check('unser data:-Bild wird gezeigt',
          md('![b](data:image/png;base64,AAAA)').indexOf('<img src="data:image/png') >= 0);
}

// ════════════════════════════════════════════════════════════════════════════
abschnitt('4. Bild-Marker');
{
    const { w } = seite(GRUPPEN, {});
    check('_mitBildern ersetzt nur bekannte Marker',
          w.WissenDestillat._mitBildern('[BILD-1] [BILD-7]').indexOf('[BILD-7]') >= 0);
}

// ════════════════════════════════════════════════════════════════════════════
abschnitt('5. Destillieren-Knopf: gesperrt MIT Grund');
{
    const { w, doc, gesendet } = seite(GRUPPEN, {});
    const run = doc.getElementById('wi-dest-run');
    const ta = doc.getElementById('wi-dest-text');
    check('ohne Text gesperrt', run.disabled === true);
    check('… und der Grund steht im title', (run.title || '').length > 0, run.title);

    ta.value = 'Ein Text zum Destillieren';
    ta.dispatchEvent(new w.Event('input'));
    check('mit Text frei', run.disabled === false);
    check('… und ohne title (kein unerklaertes Zeichen)', !run.title);

    const vorher = gesendet.length;
    run.click();
    check('Klick loest genau EINEN Lauf aus',
          gesendet.length - vorher === 1,
          JSON.stringify(gesendet.map(function (g) { return g.pfad; })));
    check('… und zwar an den Destillat-Endpunkt',
          gesendet[gesendet.length - 1].pfad === '/api/wissen/destillat/lauf');
}

// ════════════════════════════════════════════════════════════════════════════
abschnitt('6. Uebernahme in die Wissensdatenbank');
{
    const { w, doc, gesendet } = seite(GRUPPEN, {
        '/api/wissen/destillat/lauf': { ok: true, markdown: '# Destillat\n\nInhalt.', bloecke: 1 },
        '/api/wissen/destillat/uebernehmen': { ok: true, __status: 201, id: 'abc', title: 'Destillat' }
    });
    const ta = doc.getElementById('wi-dest-text');
    ta.value = 'Text';
    ta.dispatchEvent(new w.Event('input'));
    doc.getElementById('wi-dest-run').click();

    return new Promise(function (fertig) {
        setTimeout(function () {
            const out = doc.getElementById('wi-dest-out');
            check('nach dem Lauf ist das Ergebnis sichtbar', out.hidden === false);
            check('das Destillat ist gerendert',
                  doc.getElementById('wi-dest-md').innerHTML.indexOf('<h1>Destillat</h1>') >= 0);

            const box = doc.getElementById('wi-dest-takebox');
            check('die Gruppen-Auswahl ist zunaechst ZU', box.hidden === true);
            doc.getElementById('wi-dest-take').click();
            check('Klick auf "In die Wissensdatenbank" oeffnet sie', box.hidden === false);
            check('die Wissensgruppen sind gezeichnet',
                  doc.querySelectorAll('.wi-grp-dest').length === 2);

            // ⚠ LEERE AUSWAHL: abweisen, OHNE den Server zu fragen.
            const vor = gesendet.length;
            doc.getElementById('wi-dest-takego').click();
            check('ohne Gruppe wird NICHT gesendet', gesendet.length === vor);
            check('… und der Grund steht da',
                  (doc.getElementById('wi-dest-takestatus').textContent || '').length > 0);

            doc.querySelector('.wi-grp-dest').checked = true;

            // ⚠ DIE HAKEN MUESSEN EIN ERNEUTES OEFFNEN UEBERLEBEN. Wer die
            // Gruppen bei jedem Zeichnen neu baut, verwirft die Auswahl – der
            // Benutzer hakt an, klappt zu, klappt auf und sendet ins Leere.
            // Gemessen am DOM; im Quelltext waere das nicht zu sehen.
            doc.getElementById('wi-dest-takecancel').click();
            doc.getElementById('wi-dest-take').click();
            check('die gesetzten Haken ueberleben ein erneutes Oeffnen',
                  doc.querySelector('.wi-grp-dest').checked === true);

            doc.getElementById('wi-dest-takego').click();
            setTimeout(function () {
                const letzte = gesendet[gesendet.length - 1];
                check('mit Gruppe wird gesendet',
                      letzte.pfad === '/api/wissen/destillat/uebernehmen', letzte.pfad);
                const rumpf = JSON.parse(letzte.opt.body || '{}');
                check('der Rumpf traegt die gewaehlte Gruppe',
                      JSON.stringify(rumpf.groups) === '["technik"]',
                      JSON.stringify(rumpf.groups));
                check('der Rumpf traegt das Markdown',
                      (rumpf.markdown || '').indexOf('# Destillat') >= 0);
                // ⚠ KEIN Benutzername im Rumpf – der kommt aus der Anmeldung.
                check('KEIN Benutzername im Rumpf',
                      !('user' in rumpf) && !('username' in rumpf));
                fertig();
            }, 30);
        }, 30);
    }).then(weiter);
}

function weiter() {
// ════════════════════════════════════════════════════════════════════════════
abschnitt('7. Kein Lookbehind-LITERAL (sonst stirbt die Datei beim Parsen)');
{
    // ⚠ Ein `(?<=…)` im Regex-LITERAL wirft auf Safari < 16.4 schon beim
    // PARSEN – dann waere nicht die Fettschrift weg, sondern der GANZE
    // Container. Als String im try verschiebt es sich auf die Laufzeit.
    const ohneKommentar = JS.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    check('kein Lookbehind im Regex-Literal',
          !/\/[^\/\n]*\(\?<[=!]/.test(ohneKommentar));
    // ⚠ NICHT `new RegExp\([^)]*\(\?<=` – `[^)]*` kann die inneren Klammern
    // von `(?=\S)` nicht ueberspringen; die Pruefung meldete einen Fehler, den
    // es nicht gibt (Register: "ein Regex ueber den Aufruf scheiterte an
    // inneren Klammern"). Gemessen wird die EIGENSCHAFT ueber das Muster.
    const mDe = JS.match(/_FETT\s*=\s*new RegExp\('((?:[^'\\]|\\.)*)'/);
    check('… sondern ueber new RegExp im try',
          !!mDe && mDe[1].indexOf('(?<=') >= 0 && /catch\s*\([^)]*\)\s*\{[^}]*_FETT\s*=\s*null/.test(JS),
          mDe ? mDe[1] : 'kein new RegExp gefunden');

    // Positivkontrolle: das Muster ist ZEICHENGLEICH zur Fassung in avatar.js
    // (und im Jira-Plugin) – die `\S`-Waechter sind der Unterschied zwischen
    // brauchbar und gefaehrlich (ohne sie werden `2 * 3 * 4` und `*.txt`
    // ausgezeichnet). avatar.js kapselt es in eine IIFE, deshalb wird das
    // MUSTER verglichen und nicht die Schreibweise der Zuweisung.
    const AV = fs.readFileSync(path.join(ROOT, 'frontend/js/avatar.js'), 'utf8');
    const mAv = AV.match(/_FETT_RE[\s\S]{0,120}?new RegExp\('((?:[^'\\]|\\.)*)'/);
    check('Fett-Regel deckungsgleich mit avatar.js',
          !!(mAv && mDe) && mAv[1] === mDe[1],
          mAv && mDe ? (mAv[1] + '  vs  ' + mDe[1]) : 'nicht gefunden');
}

// ════════════════════════════════════════════════════════════════════════════
abschnitt('8. i18n: jeder benutzte Schluessel in BEIDEN Sprachen');
{
    const keys = new Set();
    let m;
    const reJs = /\bt\(['"](wissen\.[a-z_0-9]+)['"]/g;
    while ((m = reJs.exec(JS))) keys.add(m[1]);
    const reHtml = /data-i18n(?:-placeholder)?="(wissen\.dest[a-z_0-9]*|wissen\.sec_dest[a-z_0-9]*)"/g;
    while ((m = reHtml.exec(HTML))) keys.add(m[1]);

    check('es werden ueberhaupt Schluessel benutzt', keys.size > 20, String(keys.size));
    const fehlt = [];
    keys.forEach(function (k) {
        // Zweimal = DE und EN. Einmal = eine Sprachfassung fehlt.
        const n = (I18N.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length;
        if (n < 2) fehlt.push(k + '(' + n + ')');
    });
    check('alle in DE und EN vorhanden', fehlt.length === 0, fehlt.join(', '));

    // Die Vorgabe-Auftraege gehen an das MODELL und muessen die Bild-Marker in
    // DERSELBEN Schreibweise nennen wie der Extraktor – sonst gehen sie
    // verloren.
    check('der Vorgabe-Auftrag nennt den Bild-Marker [BILD-N]',
          I18N.indexOf('[BILD-N]') >= 0);
}

// ════════════════════════════════════════════════════════════════════════════
abschnitt('9. Klapp-Registrierung und Einbindung');
{
    const WJS = fs.readFileSync(path.join(ROOT, 'frontend/js/wissen.js'), 'utf8');
    check('wi-sec-destillat ist bei den Klapp-Containern registriert',
          WJS.indexOf("'wi-sec-destillat'") >= 0);
    check('wissen.js ruft WissenDestillat.init', WJS.indexOf('WissenDestillat.init') >= 0);
    check('… und uebergibt Scope UND Token',
          /WissenDestillat\.init\(\{\s*scope:\s*SCOPE,\s*token:\s*token\s*\}\)/.test(WJS));
    // ⚠ OHNE DEN SCRIPT-TAG WAERE DER CONTAINER STILL LEER: `wissen.js` prueft
    // `if (window.WissenDestillat)`, der Aufruf faellt dann wortlos aus. Genau
    // dieser Fall ist im Projekt schon einmal passiert (feedback_admin.js).
    check('wissen.html bindet wissen_destillat.js ein',
          /<script src="\/static\/js\/wissen_destillat\.js\?v=\d+">/.test(HTML));
    check('… VOR wissen.js (das ruft init beim Laden des Scope)',
          HTML.indexOf('wissen_destillat.js') < HTML.indexOf('js/wissen.js'));
    check('WissenPortal.reloadPending existiert (Entwurfsliste nachziehen)',
          WJS.indexOf('window.WissenPortal') >= 0 && WJS.indexOf('reloadPending') >= 0);
}

console.log('\n\x1b[1mErgebnis: ' + ok + '/' + (ok + fail) + '\x1b[0m');
bilanz = true;
process.exit(fail ? 1 : 0);
}
