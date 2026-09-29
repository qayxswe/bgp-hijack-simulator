/* ===========================================================================
   Wiedergabe: Szenario, Schritt, Animation. Dazu Phasenleiste T0-T4,
   Schrittbeschreibung ueber dem Netzplan und die Ablaufliste.
   =========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const M = App.modell;
  const ANIM_SEKUNDEN = 1.6;      // Dauer der Nachrichten-Animation

  let szId = 's1', index = 0, fortschritt = 1, spielt = false, animiert = false;
  let letzteZeit = null;
  let dom = {};
  let letzterSchritt = null;
  let nurKern = false;            // Vortragsmodus: Vor/Zurueck nur ueber die Kernschritte
  try { nurKern = localStorage.getItem('bgp-sim-kern') === '1'; } catch (e) { /* egal */ }

  const sz = () => M.SZENARIEN[szId];
  const schritt = () => sz().schritte[index];

  function init(refs) {
    dom = refs;
    dom.spielen.addEventListener('click', () => setzeSpielen(!spielt));
    dom.vor.addEventListener('click', () => weiter(1));
    dom.zurueck.addEventListener('click', () => weiter(-1));
    if (dom.kern) dom.kern.addEventListener('click', () => setzeKern(!nurKern));
    setzeKern(nurKern, true);
    document.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (App.vergleich && App.vergleich.offen()) return;          // eigene Tasten im Vergleich
      // Presenter senden meist Bild auf/ab; beides wirkt wie die Pfeiltasten.
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); weiter(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); weiter(-1); }
      else if (e.key === ' ') { e.preventDefault(); setzeSpielen(!spielt); }
      else if (e.key === 'Home') { e.preventDefault(); geheZu(ersterIndex()); }
      else if (e.key === 'End') { e.preventDefault(); geheZu(letzterIndex()); }
      else if (/^[0-4]$/.test(e.key)) { geheZuPhase('T' + e.key); }
      else if (e.key === 'k' || e.key === 'K') { setzeKern(!nurKern); }
      else if (e.key === 's' || e.key === 'S') { wechsleSzenario(szId === 's1' ? 's2' : 's1'); }
      else if ((e.key === 'v' || e.key === 'V') && App.vergleich) { App.vergleich.oeffnen(); }
      else if (e.key === 'Escape') { App.netz.infoAus(); }
    });
    // Direktaufruf eines Schritts: index.html#s2-8
    const m = /^#(s[12])(?:-(\d+))?$/.exec(location.hash);
    if (m) szId = m[1];
    phasenleisteAufbauen();
    ablaufAufbauen();
    geheZu(m && m[2] ? Math.min(+m[2] - 1, sz().schritte.length - 1) : 0);
  }

  function wechsleSzenario(id, amEnde) {
    if (!M.SZENARIEN[id]) return;
    szId = id;
    App.netz.infoAus();
    phasenleisteAufbauen();
    ablaufAufbauen();
    geheZu(amEnde ? letzterIndex() : ersterIndex());
    document.dispatchEvent(new CustomEvent('szenario-gewechselt', { detail: id }));
  }

  /* ---------------- Vortragsfolge ----------------
     Vor/Zurueck (Pfeile, Bild auf/ab, Knoepfe) laufen durchgehend: Szenario 1 -> Szenario 2
     -> Vergleich. Im Kernschritte-Modus werden die uebrigen Schritte uebersprungen. */
  const zaehlt = (s) => !nurKern || s.kern;
  function ersterIndex() { const i = sz().schritte.findIndex(zaehlt); return i < 0 ? 0 : i; }
  function letzterIndex() {
    const l = sz().schritte;
    for (let i = l.length - 1; i >= 0; i--) if (zaehlt(l[i])) return i;
    return l.length - 1;
  }
  function weiter(richtung) {
    const l = sz().schritte;
    for (let i = index + richtung; i >= 0 && i < l.length; i += richtung) {
      if (zaehlt(l[i])) { geheZu(i); return; }
    }
    const reihe = M.SZENARIO_REIHE, pos = reihe.indexOf(szId);
    if (richtung > 0 && pos < reihe.length - 1) wechsleSzenario(reihe[pos + 1]);
    else if (richtung > 0 && App.vergleich) App.vergleich.oeffnen();
    else if (richtung < 0 && pos > 0) wechsleSzenario(reihe[pos - 1], true);
  }
  function setzeKern(an, ohneMerken) {
    nurKern = !!an;
    if (!ohneMerken) try { localStorage.setItem('bgp-sim-kern', nurKern ? '1' : '0'); } catch (e) { /* egal */ }
    document.body.classList.toggle('nur-kern', nurKern);
    if (dom.kern) {
      dom.kern.classList.toggle('an', nurKern);
      dom.kern.setAttribute('aria-pressed', String(nurKern));
      const n = sz().schritte.filter((s) => s.kern).length;
      dom.kern.textContent = nurKern ? 'Kernschritte (' + n + ')' : 'Alle Schritte';
      dom.kern.title = (nurKern ? 'Nur die ' + n + ' Kernschritte' : 'Alle ' + sz().schritte.length + ' Schritte')
        + ' · umschalten mit K';
    }
    if (letzterSchritt) { letzterSchritt = null; bild(); }
  }

  // geheZu bewegt sich zwischen Schritten (← / →, Ablauf, Phasenleiste); das Abspielen der
  // Enthuellungs-Animation eines Schritts startet dabei automatisch mit. Der Spielen-Knopf
  // steuert ausschliesslich diese Animation (anhalten/fortsetzen/wiederholen), nicht die
  // Schrittnavigation -- die beiden sind jetzt getrennt.
  function geheZu(i, ohneAnimation) {
    const n = sz().schritte.length;
    if (i < 0 || i >= n) return;
    index = i;
    fortschritt = ohneAnimation ? 1 : 0;
    spielt = !ohneAnimation;
    if (!ohneAnimation) starteAnimation();
    aktualisiereSpielKnopf();
    bild();
  }
  function geheZuPhase(p) {
    const i = sz().schritte.findIndex((s) => s.phase === p);
    if (i >= 0) geheZu(i);
  }

  const SYMBOL_SPIELEN = '<svg viewBox="0 0 16 16"><polygon points="4,2.5 4,13.5 13,8"/></svg>';
  const SYMBOL_PAUSE = '<svg viewBox="0 0 16 16"><rect x="3.5" y="3" width="3" height="10"/><rect x="9.5" y="3" width="3" height="10"/></svg>';
  const SYMBOL_WIEDERHOLEN = '<svg viewBox="0 0 16 16"><path d="M3.3 8a4.7 4.7 0 1 1 1.4 3.35" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><polygon points="3,5 3.3,8.4 6.5,7.5"/></svg>';

  // Zeigt/beschriftet den Spielen-Knopf passend zum Zustand der Animation dieses Schritts:
  // fertig -> Wiederholen, laeuft -> Anhalten, angehalten mitten drin -> Fortsetzen.
  function aktualisiereSpielKnopf() {
    if (fortschritt >= 1) { dom.spielen.innerHTML = SYMBOL_WIEDERHOLEN; dom.spielen.title = 'Schritt wiederholen (Leertaste)'; }
    else if (spielt) { dom.spielen.innerHTML = SYMBOL_PAUSE; dom.spielen.title = 'Anhalten (Leertaste)'; }
    else { dom.spielen.innerHTML = SYMBOL_SPIELEN; dom.spielen.title = 'Fortsetzen (Leertaste)'; }
  }

  function setzeSpielen(an) {
    if (an) {
      if (fortschritt >= 1) fortschritt = 0;   // fertig: von vorn
      spielt = true;
      starteAnimation();
    } else {
      spielt = false;   // an aktueller Stelle einfrieren
    }
    aktualisiereSpielKnopf();
  }

  function starteAnimation() {
    if (animiert) return;
    animiert = true; letzteZeit = null;
    requestAnimationFrame(takt);
  }
  function takt(ts) {
    if (letzteZeit == null) letzteZeit = ts;
    const dt = Math.min(0.1, (ts - letzteZeit) / 1000);
    letzteZeit = ts;
    if (fortschritt < 1 && spielt) {
      fortschritt = Math.min(1, fortschritt + dt / ANIM_SEKUNDEN);
      bild();
      if (fortschritt >= 1) { spielt = false; aktualisiereSpielKnopf(); }
    }
    if (fortschritt < 1 && spielt) requestAnimationFrame(takt); else animiert = false;
  }

  /* ---------------- Phasenleiste ---------------- */
  function phasenleisteAufbauen() {
    dom.phasen.innerHTML = '';
    M.PHASEN_REIHE.forEach((p) => {
      const schritte = sz().schritte.filter((s) => s.phase === p);
      const seg = document.createElement('div');
      seg.className = 'phase-seg phase-' + M.PHASEN[p].art.toLowerCase();
      seg.dataset.phase = p;
      seg.style.flexGrow = String(Math.max(1.6, schritte.length));
      seg.innerHTML = `<button class="phase-name" title="${p}: ${M.PHASEN[p].name} (${M.PHASEN[p].art}) · Taste ${p[1]}">
          <b>${p}</b> <span>${M.PHASEN[p].name}</span></button>
        <div class="phase-ticks"></div>`;
      seg.querySelector('.phase-name').addEventListener('click', () => geheZuPhase(p));
      const ticks = seg.querySelector('.phase-ticks');
      schritte.forEach((s) => {
        const t = document.createElement('button');
        t.className = 'tick art-' + s.art + (s.kern ? ' kern' : ' neben');
        t.dataset.i = s.index;
        t.title = zeitAnzeige(s) + ' UTC · ' + s.titel;
        t.addEventListener('click', () => geheZu(s.index));
        ticks.appendChild(t);
      });
      dom.phasen.appendChild(seg);
    });
  }

  function ablaufAufbauen() {
    dom.ablauf.innerHTML = '';
    sz().schritte.forEach((s) => {
      const z = document.createElement('button');
      z.className = 'ablauf-zeile art-' + s.art + (s.kern ? ' kern' : ' neben');
      z.dataset.i = s.index;
      z.innerHTML = `<span class="ab-phase">${s.phase}</span><span class="ab-zeit">${zeitAnzeige(s)}</span><span class="ab-titel">${s.titel}</span>`;
      z.addEventListener('click', () => geheZu(s.index));
      dom.ablauf.appendChild(z);
    });
  }

  function zeitAnzeige(s) {
    if (s.art === 'befehl') return s.zeitAnzeige;
    return M.zeitText(s.cursor, 3);
  }

  /* ---------------- Beschreibung ---------------- */
  function knotenName(ip) { return M.IP_SYSTEM[ip] || ip; }
  function beschreibung(s) {
    const z = sz();
    let details = '';
    if (s.art === 'ereignis') {
      const pk = s.pakete.map((p) => `<div class="ev-zeile"><span class="ev-zeit">${p.zeit}</span>
          <span class="ev-weg">${knotenName(p.von)} → ${knotenName(p.an)}</span>
          <span class="ev-art ev-${p.ev}">${p.ev === 'A' ? 'Ankündigung' : 'Rücknahme'}</span>
          <span class="ev-inhalt">${App.faerbe(p.praefix)}${p.pfad ? ' <span class="ev-pfad">Pfad ' + App.faerbe(p.pfad) + '</span>' : ''}</span></div>`).join('');
      const loc = s.bmp.filter((b) => b.sicht === 'Loc-RIB').map((b) => `<div class="ev-zeile ev-loc"><span class="ev-zeit">${b.zeit}</span>
          <span class="ev-weg">rs Loc-RIB</span><span class="ev-art ev-${b.ev}">${b.ev === 'A' ? 'Best Path' : 'entfernt'}</span>
          <span class="ev-inhalt">${App.faerbe(b.praefix)}${b.pfad ? ' <span class="ev-pfad">Pfad ' + App.faerbe(b.pfad) + '</span>' : ''}</span></div>`).join('');
      details = `<div class="ev-kopf">rs_enp0s8.pcap${loc ? ' · BMP Loc-RIB' : ''}</div>${pk}${loc}`;
    } else if (s.art === 'befehl') {
      details = `<div class="ev-kopf">hijacker · journalctl -t sudo</div><div class="ev-roh">${App.faerbe(s.befehl)}</div>`;
    } else {
      // Jede Zeile: wer fragt was ab (Befehl + Ziel), dann das Ergebnis mit Pfeil --
      // beantwortet "wer hat wohin eine Abfrage gemacht".
      const zeile = (sys, befehl, ergebnis, klasse) => `<div class="ev-zeile"><span class="ev-sys">${sys}</span>`
        + `<span class="ev-art ev-befehl-art ${klasse || ''}">${befehl}</span><span class="ev-inhalt">${ergebnis}</span></div>`;
      const reihen = [];
      const bp = M.bestPathRs(z.praefix, s.cursor);
      reihen.push(zeile('rs', 'Loc-RIB ' + z.praefix, bp.vorhanden
        ? '→ ' + App.faerbe('Pfad ' + bp.pfad + ' · NH ' + bp.nh) : '→ kein Eintrag'));
      ['asa', 'asb'].forEach((vm) => {
        const r = M.routingEintrag(z.id, vm, s.cursor);
        if (r) reihen.push(zeile(vm, 'ip route 198.51.100.10', '→ ' + App.faerbe(r.praefix) + ' '
          + App.faerbe(r.nh.startsWith('directly') ? 'directly connected, ' + r.schnittstelle : 'via ' + r.nh)));
      });
      const m = M.messungClienta(z.id, s.cursor);
      if (m) {
        const eve = m.hop2 === '192.0.2.66';
        reihen.push(zeile('clienta', 'curl 198.51.100.10', '→ ' + App.faerbe(m.http) + ' · „' + m.seite + '“', eve ? 'ev-eve' : 'ev-bob'));
        reihen.push(zeile('clienta', 'traceroute 198.51.100.10', '→ Hop 2 ' + App.faerbe(m.hop2) + ' · ping ' + m.ping.replace(/ packets transmitted, (\d+) received.*$/, '/$1')));
      }
      let handschlag = '';
      if (s.phase === 'T0' && App.netz.istHandschlagAn()) {
        const hz = M.sitzungsaufbau.map((p) => `<div class="ev-zeile"><span class="ev-zeit">${p.zeit}</span>
            <span class="ev-weg">${knotenName(p.von)} → ${knotenName(p.an)}</span>
            <span class="ev-art">${p.protokoll}</span>
            <span class="ev-inhalt">${App.faerbe(p.info)}</span></div>`).join('');
        handschlag = `<div class="ev-kopf">Sitzungsaufbau · rs_enp0s8.pcap · Neustart vor T0</div>${hz}`;
      }
      details = `<div class="ev-kopf">Abfragen ${M.zeitText(s.messungVon, 3)}–${M.zeitText(s.cursor, 3)} UTC</div>${reihen.join('')}${handschlag}`;
    }
    dom.phaseChip.innerHTML = `<b>${s.phase}</b> · ${M.PHASEN[s.phase].name}<span class="chip-art">${M.PHASEN[s.phase].art}</span>`;
    dom.phaseChip.className = 'phase-chip phase-' + M.PHASEN[s.phase].art.toLowerCase();
    dom.zaehler.textContent = 'Schritt ' + (s.index + 1) + ' / ' + z.schritte.length;
    dom.titel.textContent = s.titel;
    dom.text.textContent = s.text;
    dom.details.innerHTML = details;
    dom.zeit.textContent = zeitAnzeige(s) + ' UTC';
    if (dom.handschlagBtn) dom.handschlagBtn.classList.toggle('versteckt', s.phase !== 'T0');
  }

  /* ---------------- Bild ---------------- */
  function bild() {
    const z = sz(), s = schritt();
    App.netz.zeichnen(z, s, fortschritt);
    if (letzterSchritt !== s) {
      letzterSchritt = s;
      try { history.replaceState(null, '', '#' + z.id + '-' + (s.index + 1)); } catch (e) { /* file:// in manchen Browsern */ }
      beschreibung(s);
      App.artefakte.zeichnen(z, s);
      dom.phasen.querySelectorAll('.tick').forEach((t) => {
        const i = +t.dataset.i;
        t.classList.toggle('fertig', i < index);
        t.classList.toggle('jetzt', i === index);
      });
      dom.phasen.querySelectorAll('.phase-seg').forEach((seg) => seg.classList.toggle('aktiv', seg.dataset.phase === s.phase));
      dom.ablauf.querySelectorAll('.ablauf-zeile').forEach((a) => {
        const i = +a.dataset.i;
        a.classList.toggle('jetzt', i === index);
        a.classList.toggle('fertig', i < index);
      });
      const akt = dom.ablauf.querySelector('.jetzt');
      if (akt) akt.scrollIntoView({ block: 'nearest' });
      // durchgehende Folge: zurueck nur am Anfang von Szenario 1 gesperrt, vor fuehrt am Ende zum Vergleich
      dom.zurueck.disabled = szId === M.SZENARIO_REIHE[0] && index <= ersterIndex();
      dom.vor.disabled = false;
      dom.vor.title = szId === M.SZENARIO_REIHE[M.SZENARIO_REIHE.length - 1] && index >= letzterIndex()
        ? 'Weiter zum Vergleich der Szenarien (→ / Bild ab)' : 'Schritt vor (→ / Bild ab)';
      if (dom.kern) setzeKernText();
    }
  }

  function setzeKernText() {
    const n = sz().schritte.filter((s) => s.kern).length;
    dom.kern.textContent = nurKern ? 'Kernschritte (' + n + ')' : 'Alle Schritte';
  }

  App.steuerung = {
    init, wechsleSzenario, geheZu, neuZeichnen: () => { letzterSchritt = null; bild(); },
    wiederholen: () => { letzterSchritt = null; geheZu(index, false); },
    szenario: () => szId,
    weiter, setzeKern,
  };
})(window.App);
