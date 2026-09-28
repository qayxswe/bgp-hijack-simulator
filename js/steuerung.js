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

  const sz = () => M.SZENARIEN[szId];
  const schritt = () => sz().schritte[index];

  function init(refs) {
    dom = refs;
    dom.spielen.innerHTML = SYMBOL_SPIELEN;
    dom.spielen.addEventListener('click', () => setzeSpielen(!spielt));
    dom.vor.addEventListener('click', () => geheZu(index + 1));
    dom.zurueck.addEventListener('click', () => geheZu(index - 1));
    document.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); geheZu(index + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); geheZu(index - 1); }
      else if (e.key === ' ') { e.preventDefault(); setzeSpielen(!spielt); }
      else if (e.key === 'Home') { e.preventDefault(); geheZu(0); }
      else if (e.key === 'End') { e.preventDefault(); geheZu(sz().schritte.length - 1); }
      else if (/^[0-4]$/.test(e.key)) { geheZuPhase('T' + e.key); }
      else if (e.key === 'Escape') { App.netz.infoAus(); }
    });
    // Direktaufruf eines Schritts: index.html#s2-8
    const m = /^#(s[12])(?:-(\d+))?$/.exec(location.hash);
    if (m) szId = m[1];
    phasenleisteAufbauen();
    ablaufAufbauen();
    geheZu(m && m[2] ? Math.min(+m[2] - 1, sz().schritte.length - 1) : 0);
  }

  function wechsleSzenario(id) {
    if (!M.SZENARIEN[id]) return;
    szId = id;
    setzeSpielen(false);
    App.netz.infoAus();
    phasenleisteAufbauen();
    ablaufAufbauen();
    geheZu(0);
  }

  function geheZu(i, ohneAnimation) {
    const n = sz().schritte.length;
    if (i < 0 || i >= n) { if (spielt && i >= n) setzeSpielen(false); return; }
    index = i;
    fortschritt = ohneAnimation ? 1 : 0;
    if (!ohneAnimation) starteAnimation();
    bild();
  }
  function geheZuPhase(p) {
    const i = sz().schritte.findIndex((s) => s.phase === p);
    if (i >= 0) { setzeSpielen(false); geheZu(i); }
  }

  const SYMBOL_SPIELEN = '<svg viewBox="0 0 16 16"><polygon points="4,2.5 4,13.5 13,8"/></svg>';
  const SYMBOL_PAUSE = '<svg viewBox="0 0 16 16"><rect x="3.5" y="3" width="3" height="10"/><rect x="9.5" y="3" width="3" height="10"/></svg>';

  // "Abspielen" zeigt genau einen Schritt mit Animation und haelt danach automatisch an
  // (nicht mehrere Schritte hintereinander). Erneutes Abspielen/Leertaste geht zum naechsten
  // Schritt; am Ende der Liste beginnt es wieder vorn.
  function setzeSpielen(an) {
    spielt = an;
    dom.spielen.innerHTML = spielt ? SYMBOL_PAUSE : SYMBOL_SPIELEN;
    dom.spielen.title = spielt ? 'Anhalten (Leertaste)' : 'Nächster Schritt (Leertaste)';
    if (spielt) {
      if (fortschritt >= 1) {
        if (index >= sz().schritte.length - 1) geheZu(0); else geheZu(index + 1);
      } else {
        starteAnimation();
      }
    }
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
    if (fortschritt < 1) {
      fortschritt = Math.min(1, fortschritt + dt / ANIM_SEKUNDEN);
      bild();
      if (fortschritt >= 1 && spielt) setzeSpielen(false);   // nach dem Schritt automatisch anhalten
    }
    if (fortschritt < 1) requestAnimationFrame(takt); else animiert = false;
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
        t.className = 'tick art-' + s.art;
        t.dataset.i = s.index;
        t.title = zeitAnzeige(s) + ' UTC · ' + s.titel;
        t.addEventListener('click', () => { setzeSpielen(false); geheZu(s.index); });
        ticks.appendChild(t);
      });
      dom.phasen.appendChild(seg);
    });
  }

  function ablaufAufbauen() {
    dom.ablauf.innerHTML = '';
    sz().schritte.forEach((s) => {
      const z = document.createElement('button');
      z.className = 'ablauf-zeile art-' + s.art;
      z.dataset.i = s.index;
      z.innerHTML = `<span class="ab-phase">${s.phase}</span><span class="ab-zeit">${zeitAnzeige(s)}</span><span class="ab-titel">${s.titel}</span>`;
      z.addEventListener('click', () => { setzeSpielen(false); geheZu(s.index); });
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
      const zeile = (sys, art, inhalt, klasse) => `<div class="ev-zeile"><span class="ev-sys">${sys}</span>`
        + `<span class="ev-art ${klasse || ''}">${art}</span><span class="ev-inhalt">${inhalt}</span></div>`;
      const reihen = [];
      const bp = M.bestPathRs(z.praefix, s.cursor);
      reihen.push(zeile('rs', 'Loc-RIB', bp.vorhanden
        ? App.faerbe(z.praefix + ' Pfad ' + bp.pfad + ' NH ' + bp.nh) : App.faerbe(z.praefix) + ' —'));
      ['asa', 'asb'].forEach((vm) => {
        const r = M.routingEintrag(z.id, vm, s.cursor);
        if (r) reihen.push(zeile(vm, 'show ip route', App.faerbe(r.praefix + (r.nh.startsWith('directly') ? ' directly connected, ' + r.schnittstelle : ' via ' + r.nh))));
      });
      const m = M.messungClienta(z.id, s.cursor);
      if (m) {
        const eve = m.hop2 === '192.0.2.66';
        reihen.push(zeile('clienta', 'curl', App.faerbe(m.http) + ' · „' + m.seite + '“', eve ? 'ev-eve' : 'ev-bob'));
        reihen.push(zeile('clienta', 'traceroute', 'Hop 2 ' + App.faerbe(m.hop2) + ' · ping ' + m.ping.replace(/ packets transmitted, (\d+) received.*$/, '/$1')));
      }
      details = `<div class="ev-kopf">Abfragen ${M.zeitText(s.messungVon, 3)}–${M.zeitText(s.cursor, 3)} UTC</div>${reihen.join('')}`;
    }
    dom.phaseChip.innerHTML = `<b>${s.phase}</b> · ${M.PHASEN[s.phase].name}<span class="chip-art">${M.PHASEN[s.phase].art}</span>`;
    dom.phaseChip.className = 'phase-chip phase-' + M.PHASEN[s.phase].art.toLowerCase();
    dom.zaehler.textContent = 'Schritt ' + (s.index + 1) + ' / ' + z.schritte.length;
    dom.titel.textContent = s.titel;
    dom.text.textContent = s.text;
    dom.details.innerHTML = details;
    dom.zeit.textContent = zeitAnzeige(s) + ' UTC';
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
      dom.zurueck.disabled = index === 0;
      dom.vor.disabled = index === z.schritte.length - 1;
    }
  }

  App.steuerung = {
    init, wechsleSzenario, geheZu, neuZeichnen: () => { letzterSchritt = null; bild(); },
    szenario: () => szId,
  };
})(window.App);
