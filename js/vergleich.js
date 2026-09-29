/* ===========================================================================
   Vergleich der beiden Szenarien (Abschluss des Vortrags). Erreichbar ueber den
   Knopf im Kopf, die Taste V oder "vor" nach dem letzten Schritt von Szenario 2.
   Die Kennzahlen werden aus denselben Primaerdaten berechnet wie die Schritte:
   Mitschnitt (UPDATEs), BMP (Loc-RIB), Routing-Tabellen, Messprotokoll, rib.mrt.
   =========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const M = App.modell;
  const EVE = '192.0.2.66';

  // Statische Einordnung je Szenario (Entscheidung laut BGP-Entscheidungsprozess)
  const EINORDNUNG = {
    s1: {
      art: 'Sub-Präfix-Hijack',
      ansage: '198.51.100.0/24 – spezifischer als Bobs 198.51.96.0/20',
      grund: 'Längste Präfixübereinstimmung: die /24 schlägt die /20 bei der Weiterleitung, unabhängig vom AS-Pfad.',
    },
    s2: {
      art: 'Gleiches Präfix, falscher Ursprung',
      ansage: '198.51.96.0/20 – dasselbe Präfix wie Bob',
      grund: 'Kürzerer AS-Pfad: 64511 (1 Eintrag) schlägt Bobs 64496 64496 64496 (3 Einträge) in der Best-Path-Auswahl.',
    },
  };

  let el = null;

  function kennzahlen(id) {
    const sz = M.SZENARIEN[id];
    const l = sz.schritte;
    const ereignisse = (p) => l.filter((s) => s.phase === p && s.art === 'ereignis');
    const pakete = (p) => ereignisse(p).reduce((n, s) => n + s.pakete.length, 0);
    const loc = (p) => ereignisse(p).flatMap((s) => s.bmp.filter((b) => b.sicht === 'Loc-RIB'));
    const vonEve = (p) => ereignisse(p).flatMap((s) => s.pakete).find((x) => x.von === EVE);
    const ms = (a, b) => (a && b ? Math.round((b.t - a.t) * 1000) + ' ms' : '–');

    const t1Eve = vonEve('T1'), t1Loc = loc('T1');
    const t3Eve = vonEve('T3'), t3Loc = loc('T3');
    const t2 = l.find((s) => s.phase === 'T2').cursor;
    const t4 = l.find((s) => s.phase === 'T4').cursor;
    const weg = (vm) => {
      const r = M.routingEintrag(id, vm, t2);
      if (!r) return { text: '–', eve: false };
      const eve = r.nh === EVE;
      return { eve, text: r.praefix + (r.nh.startsWith('directly') ? ' direkt (' + r.schnittstelle + ')' : ' via ' + r.nh) };
    };
    const mess = M.messungClienta(id, t2);
    const messT4 = M.messungClienta(id, t4);
    const bpT4 = M.bestPathRs(sz.praefix, t4);
    // rib.mrt: erhalten ist nur der Dump von 18:47:00 -- enthaelt er Eves Ursprung fuer das Praefix?
    const dump = M.ARTEFAKT['rs-rib-mrt'].dump;
    const dumpEve = dump.zeilen.some((z) => { const f = z.split('|'); return f[5] === sz.praefix && /(^| )64511$/.test(f[6]); });
    const dumpNachT4 = dump.t > t4;
    const mrtEve = M.ARTEFAKT['rs-mrt'].ansichten[0].eintraege
      .filter((e) => e.t >= l[0].vorher && e.t <= t4 && e.text.split('|')[5] === sz.praefix).length;

    return {
      sz, einordnung: EINORDNUNG[id],
      bestPathMs: ms(t1Eve, t1Loc[0]),
      zwischenschritte: Math.max(0, t3Loc.length - 1),
      erholungMs: ms(t3Eve, t3Loc[t3Loc.length - 1]),
      updatesT1: pakete('T1'), updatesT3: pakete('T3'),
      asa: weg('asa'), asb: weg('asb'),
      clienta: mess ? { eve: mess.hop2 === EVE, text: 'Hop 2 ' + mess.hop2 + ' · „' + mess.seite + '“' } : { eve: false, text: '–' },
      clientaT4: messT4 ? 'Hop 2 ' + messT4.hop2 + ' · „' + messT4.seite + '“' : '–',
      bpT4: bpT4.vorhanden ? sz.praefix + ' → ' + bpT4.pfad : sz.praefix + ' nicht in der Loc-RIB',
      mrtEve, dumpEve, dumpNachT4,
    };
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function marke(eve, text) { return `<span class="vg-marke ${eve ? 'vg-eve' : 'vg-bob'}">${eve ? 'Eve' : 'Bob'}</span> ${App.faerbe(text)}`; }

  function aufbauen() {
    const [a, b] = M.SZENARIO_REIHE.map(kennzahlen);
    const zeile = (titel, fa, fb, hinweis) => `<tr><th>${titel}${hinweis ? `<small>${hinweis}</small>` : ''}</th><td>${fa}</td><td>${fb}</td></tr>`;
    const gruppe = (titel) => `<tr class="vg-gruppe"><th colspan="3">${titel}</th></tr>`;
    const spur = (k) => [
      k.mrtEve + ' Zeilen in updates.mrt',
      k.dumpEve ? 'rib.mrt 18:47:00 zeigt Eves Pfad noch nach T4' : (k.dumpNachT4 ? 'rib.mrt 18:47:00: bereits sauber' : 'rib.mrt: kein Dump im Angriffsfenster erhalten'),
      'Mitschnitt und BMP vollständig',
    ].map((x) => `<div>${esc(x)}</div>`).join('');

    el.querySelector('.vg-inhalt').innerHTML = `
      <table class="vg-tabelle">
        <thead><tr><th></th>
          <th><span class="vg-nr">Szenario ${a.sz.nr}</span>${esc(a.einordnung.art)}</th>
          <th><span class="vg-nr">Szenario ${b.sz.nr}</span>${esc(b.einordnung.art)}</th></tr></thead>
        <tbody>
          ${gruppe('Angriff')}
          ${zeile('Eve kündigt an', App.faerbe(a.einordnung.ansage), App.faerbe(b.einordnung.ansage))}
          ${zeile('Warum Eve gewinnt', esc(a.einordnung.grund), esc(b.einordnung.grund))}
          ${zeile('Best Path auf rs', esc(a.bestPathMs) + ' nach Eintreffen', esc(b.bestPathMs) + ' nach Eintreffen', 'Mitschnitt → BMP Loc-RIB')}
          ${zeile('UPDATEs bei rs (T1)', a.updatesT1, b.updatesT1, 'rs_enp0s8.pcap, beide Richtungen')}
          ${gruppe('Wirkung bei T2 (Messpunkt)')}
          ${zeile('asa leitet', marke(a.asa.eve, a.asa.text), marke(b.asa.eve, b.asa.text), 'show ip route')}
          ${zeile('asb leitet', marke(a.asb.eve, a.asb.text), marke(b.asb.eve, b.asb.text), 'Bobs eigenes AS')}
          ${zeile('clienta (Alice)', marke(a.clienta.eve, a.clienta.text), marke(b.clienta.eve, b.clienta.text), 'traceroute, curl')}
          ${gruppe('Rücknahme (T3 → T4)')}
          ${zeile('UPDATEs bei rs (T3)', a.updatesT3, b.updatesT3, 'rs_enp0s8.pcap, beide Richtungen')}
          ${zeile('Zwischenzustände in der Loc-RIB', a.zwischenschritte, b.zwischenschritte, 'Rückmeldungen werden kurz Best Path')}
          ${zeile('Wieder sauber nach', esc(a.erholungMs), esc(b.erholungMs), 'Eves Rücknahme → letzter Loc-RIB-Wechsel')}
          ${zeile('rs bei T4', App.faerbe(a.bpT4), App.faerbe(b.bpT4), 'BMP Loc-RIB')}
          ${gruppe('Nachweis nach T4')}
          ${zeile('RIBs im RAM (vtysh)', 'keine Spur mehr', 'keine Spur mehr', 'nur Momentaufnahme')}
          ${zeile('Fortlaufende Aufzeichnungen', spur(a), spur(b))}
        </tbody>
      </table>
      <p class="vg-fazit"><b>Fazit:</b> In beiden Szenarien übernimmt rs Eves Pfad innerhalb von Millisekunden und verteilt ihn an alle
        Nachbarn. Der Sub-Präfix-Hijack wirkt auch bei asb, weil die /24 spezifischer ist als Bobs eigene /20; beim gleichen Präfix
        behält asb seine lokal erzeugte Route. Nach der Rücknahme sind die Tabellen im RAM wieder sauber – belegen lässt sich der
        Angriff dann nur noch mit den fortlaufenden Aufzeichnungen (MRT, Mitschnitt, BMP).</p>`;
  }

  function oeffnen() {
    if (!el) return;
    aufbauen();
    el.classList.remove('versteckt');
    el.querySelector('.vg-zu').focus();
  }
  function schliessen() { if (el) el.classList.add('versteckt'); }
  function offen() { return !!el && !el.classList.contains('versteckt'); }

  function init(element) {
    el = element;
    el.querySelector('.vg-zu').addEventListener('click', schliessen);
    el.addEventListener('click', (e) => { if (e.target === el) schliessen(); });
    document.addEventListener('keydown', (e) => {
      if (!offen()) return;
      // Zurueck (Pfeil/Bild auf/Esc/V) schliesst den Vergleich und fuehrt zum letzten Schritt
      if (['Escape', 'ArrowLeft', 'PageUp', 'v', 'V'].includes(e.key)) { e.preventDefault(); schliessen(); }
    });
  }

  App.vergleich = { init, oeffnen, schliessen, offen };
})(window.App);
