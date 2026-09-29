/* ===========================================================================
   Netzplan in zwei Ebenen:
     Kontrollebene: rs und die BGP-Sitzungen zu asa, hijacker und asb.
                    Nachrichten eines Schritts = UPDATEs im Mitschnitt rs_enp0s8.pcap,
                    Best Path von rs = Loc-RIB-Meldungen der BMP-Ausleitung.
     Datenebene:    Weiterleitung ueber das Segment ixp-peering.
                    Eintrag von asa/asb = letzte Abfrage der Routing-Tabelle,
                    Verkehr von clienta = letzte Messung (traceroute, curl).
   Jeder Router steht in beiden Ebenen in derselben Spalte.
   =========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const M = App.modell;
  const svgns = 'http://www.w3.org/2000/svg';

  const B = 236, H = 60;
  const X = { asa: 190, hijacker: 500, asb: 810 };
  const Y_KTRL = 212, Y_BUS = 340, Y_ROUTER = 420, Y_ENDE = 550;
  const ROLLE = { rs: 'rs', asa: 'isp', clienta: 'isp', asb: 'bob', weblegit: 'bob', hijacker: 'eve', webevil: 'eve' };

  // Bereits vor dem Szenario bestehende eigene Praefixe von asa und asb (BMP Loc-RIB ab 18:44:40,
  // vor dem ersten Messpunkt T0 um 18:45:01) -- der tatsaechliche Ausgangszustand der Kontrollebene.
  const EIGENE_PRAEFIXE = [{ pfx: '203.0.113.0/24', vm: 'asa' }, { pfx: '198.51.96.0/20', vm: 'asb' }];

  const KNOTEN = {
    'k:rs':       { x: 500, y: 76, w: 400, h: 100, label: 'rs', sub: 'Route-Server · AS64500 · 192.0.2.1', system: 'rs' },
    'k:asa':      { x: X.asa, y: Y_KTRL, w: B, h: H, label: 'asa', sub: 'AS64499 · 192.0.2.12', system: 'asa' },
    'k:hijacker': { x: X.hijacker, y: Y_KTRL, w: B, h: H, label: 'hijacker', sub: 'AS64511 · 192.0.2.66', system: 'hijacker' },
    'k:asb':      { x: X.asb, y: Y_KTRL, w: B, h: H, label: 'asb', sub: 'AS64496 · 192.0.2.11', system: 'asb' },
    'd:asa':      { x: X.asa, y: Y_ROUTER, w: B, h: H, label: 'asa', sub: '203.0.113.1', system: 'asa' },
    'd:hijacker': { x: X.hijacker, y: Y_ROUTER, w: B, h: H, label: 'hijacker', sub: '198.51.100.1', system: 'hijacker' },
    'd:asb':      { x: X.asb, y: Y_ROUTER, w: B, h: H, label: 'asb', sub: '198.51.96.1', system: 'asb' },
    'd:clienta':  { x: X.asa, y: Y_ENDE, w: B, h: H, label: 'clienta', sub: 'Alice · 203.0.113.10', system: 'clienta' },
    'd:webevil':  { x: X.hijacker, y: Y_ENDE, w: B, h: H, label: 'webevil', sub: 'Eve · 198.51.100.10', system: 'webevil' },
    'd:weblegit': { x: X.asb, y: Y_ENDE, w: B, h: H, label: 'weblegit', sub: 'Bob · 198.51.100.10', system: 'weblegit' },
  };
  const ZUGANG = {
    asa: { ende: 'd:clienta', label: 'access-asa · 203.0.113.0/24' },
    hijacker: { ende: 'd:webevil', label: 'access-hijacker · 198.51.100.0/24' },
    asb: { ende: 'd:weblegit', label: 'access-asb · 198.51.96.0/20' },
  };
  // Sitzungen: Ansatzpunkt an rs und am Router
  const SITZUNG = {};
  Object.keys(X).forEach((vm, i) => {
    const rs = KNOTEN['k:rs'], r = KNOTEN['k:' + vm];
    SITZUNG[vm] = { rs: { x: rs.x + (i - 1) * 90, y: rs.y + rs.h / 2 }, router: { x: r.x, y: r.y - r.h / 2 } };
  });
  const SPUR = 6;   // Abstand der beiden Richtungen von der Sitzungslinie

  // Farbe einer Ankuendigung = Rolle ihres Ursprungs-AS (rechtes Ende des AS_PATH)
  const AS_FARBE = { '64511': 'var(--m-eve)', '64496': 'var(--m-bob)', '64499': 'var(--m-isp)' };
  const SYSTEM_FARBE = { asa: 'var(--m-isp)', asb: 'var(--m-bob)', hijacker: 'var(--m-eve)', rs: 'var(--m-rs)' };

  const INFO = {
    rs: { rolle: 'Route-Server des Austauschpunkts', as: 'AS64500', adressen: [['enp0s8', '192.0.2.1/24', 'ixp-peering']],
      ankuendigt: 'nichts Eigenes', konfig: 'Konfiguration/rs.txt' },
    asa: { rolle: 'Alices Zugangsprovider', as: 'AS64499', adressen: [['enp0s8', '192.0.2.12/24', 'ixp-peering'], ['enp0s10', '203.0.113.1/24', 'access-asa']],
      ankuendigt: '203.0.113.0/24', konfig: 'Konfiguration/asa.txt' },
    asb: { rolle: 'Bobs AS', as: 'AS64496', adressen: [['enp0s8', '192.0.2.11/24', 'ixp-peering'], ['enp0s10', '198.51.96.1/20', 'access-asb']],
      ankuendigt: '198.51.96.0/20 (route-map RS-OUT: 64496 64496 64496)', konfig: 'Konfiguration/asb.txt' },
    hijacker: { rolle: 'Eve', as: 'AS64511', adressen: [['enp0s8', '192.0.2.66/24', 'ixp-peering'], ['enp0s10', '198.51.100.1/24', 'access-hijacker']],
      ankuendigt: 'Szenario 1: 198.51.100.0/24 · Szenario 2: 198.51.96.0/20', konfig: 'Konfiguration/hijacker.txt' },
    clienta: { rolle: 'Alice', as: null, adressen: [['enp0s8', '203.0.113.10/24', 'access-asa']], ankuendigt: 'kein BGP' },
    weblegit: { rolle: 'Bobs Webserver', as: null, adressen: [['enp0s8', '198.51.100.10/20', 'access-asb']], ankuendigt: 'kein BGP' },
    webevil: { rolle: 'Eves Webserver', as: null, adressen: [['enp0s8', '198.51.100.10/24', 'access-hijacker']], ankuendigt: 'kein BGP' },
  };

  let svg, flugEbene, knotenEbene, infoEl, knotenKlick, auswahlHandler;
  const zeilen = {};   // Knoten -> [Zustandszeile 1, Zustandszeile 2]
  let rsZeilen = [];   // rs: eine Zeile je Praefix (Ausgangszustand + Angriffspraefix)

  function el(tag, attrs, eltern) {
    const e = document.createElementNS(svgns, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (eltern) eltern.appendChild(e);
    return e;
  }
  function text(eltern, x, y, inhalt, cls, anker) {
    const t = el('text', { x, y, class: cls, 'text-anchor': anker || 'middle' }, eltern);
    t.textContent = inhalt;
    return t;
  }

  /* ---------------- Aufbau ---------------- */
  function aufbauen(svgEl, infoContainer, onKnoten, onAuswahl) {
    svg = svgEl; infoEl = infoContainer; knotenKlick = onKnoten; auswahlHandler = onAuswahl;
    svg.innerHTML = '';

    const grund = el('g', {}, svg);
    el('rect', { x: 6, y: 6, width: 988, height: 262, rx: 6, class: 'ebene-flaeche' }, grund);
    el('rect', { x: 6, y: 278, width: 988, height: 336, rx: 6, class: 'ebene-flaeche' }, grund);
    text(grund, 22, 30, 'KONTROLLEBENE', 'ebene-titel', 'start');
    text(grund, 22, 46, 'BGP · TCP/179', 'ebene-sub', 'start');
    text(grund, 22, 302, 'DATENEBENE', 'ebene-titel', 'start');
    text(grund, 22, 318, 'IP-Weiterleitung', 'ebene-sub', 'start');

    // Legende oben rechts
    const lg = el('g', { transform: 'translate(730,26)' }, grund);
    const raute = (g, voll, farbe) => el('polygon', { points: '8,-6 14,0 8,6 2,0', fill: voll ? farbe : 'var(--flaeche)', stroke: farbe, 'stroke-width': voll ? 0 : 1.6 }, g);
    const zeile = (y, zeichnen, beschr) => { zeichnen(el('g', { transform: `translate(0,${y})` }, lg)); text(lg, 24, y + 3.5, beschr, 'legende-text', 'start'); };
    zeile(0, (g) => raute(g, true, 'var(--text-2)'), 'Ankündigung');
    zeile(16, (g) => raute(g, false, 'var(--text-2)'), 'Rücknahme');
    zeile(32, (g) => el('line', { x1: 0, y1: 0, x2: 16, y2: 0, stroke: 'var(--text-2)', 'stroke-width': 2, 'stroke-dasharray': '4 3' }, g), 'Rückmeldung an rs');
    zeile(48, (g) => el('circle', { cx: 8, cy: 0, r: 4.5, fill: 'var(--text-2)' }, g), 'Datenverkehr clienta');
    const as = el('g', { transform: 'translate(0,68)' }, lg);
    text(as, 0, 3.5, 'Ursprung', 'legende-text', 'start');
    [['64511', 'var(--m-eve)'], ['64496', 'var(--m-bob)'], ['64499', 'var(--m-isp)']].forEach(([t, f], i) => {
      el('rect', { x: 54 + i * 62, y: -5, width: 10, height: 10, rx: 2, fill: f }, as);
      text(as, 54 + i * 62 + 15, 3.5, t, 'legende-as', 'start');
    });

    // Kontrollebene: Sitzungen
    const sitz = el('g', {}, svg);
    Object.keys(SITZUNG).forEach((vm) => {
      const s = SITZUNG[vm];
      el('line', { x1: s.rs.x, y1: s.rs.y, x2: s.router.x, y2: s.router.y, class: 'sitzung' }, sitz);
    });

    // Datenebene: ixp-peering, Anschluesse, Zugangssegmente
    const netz = el('g', {}, svg);
    el('line', { x1: 70, y1: Y_BUS, x2: 930, y2: Y_BUS, class: 'bus' }, netz);
    text(netz, 930, Y_BUS - 10, 'ixp-peering · 192.0.2.0/24', 'segment-text', 'end');
    Object.keys(X).forEach((vm) => {
      el('line', { x1: X[vm], y1: Y_BUS, x2: X[vm], y2: Y_ROUTER - H / 2, class: 'anschluss' }, netz);
      el('circle', { cx: X[vm], cy: Y_BUS, r: 4, class: 'anschluss-punkt' }, netz);
      el('line', { x1: X[vm], y1: Y_ROUTER + H / 2, x2: X[vm], y2: Y_ENDE - H / 2, class: 'zugang rolle-' + ROLLE[vm] }, netz);
      text(netz, X[vm] + 10, (Y_ROUTER + Y_ENDE) / 2 + 4, ZUGANG[vm].label, 'segment-text', 'start');
    });

    flugEbene = el('g', {}, svg);
    knotenEbene = el('g', {}, svg);
    Object.keys(KNOTEN).forEach((k) => {
      const n = KNOTEN[k];
      const g = el('g', { class: 'knoten rolle-' + ROLLE[n.system], 'data-knoten': k, 'data-system': n.system,
        transform: `translate(${n.x - n.w / 2},${n.y - n.h / 2})` }, knotenEbene);
      el('rect', { width: n.w, height: n.h, rx: 4, class: 'knoten-kasten' }, g);
      el('path', { d: `M4 0.6 V${n.h - 0.6} A4 4 0 0 1 0.6 ${n.h - 4} V4 A4 4 0 0 1 4 0.6 Z`, class: 'knoten-akzent' }, g);
      text(g, 14, 20, n.label, 'knoten-titel', 'start');
      text(g, n.w - 10, 20, n.sub, 'knoten-sub', 'end');
      if (k === 'k:rs') {
        rsZeilen = [0, 1, 2].map((i) => text(g, 14, 40 + i * 17, '', i === 0 ? 'knoten-zustand' : 'knoten-zustand-2', 'start'));
      } else {
        zeilen[k] = [text(g, 14, 38, '', 'knoten-zustand', 'start'), text(g, 14, 52, '', 'knoten-zustand-2', 'start')];
      }
      el('title', {}, g).textContent = n.system;
      g.addEventListener('click', (ev) => { ev.stopPropagation(); knotenKlick && knotenKlick(n.system); });
    });
    infoEl.querySelector('.ei-close').addEventListener('click', infoAus);
  }

  /* ---------------- Wege ---------------- */
  function punkt(p) { return typeof p === 'string' ? KNOTEN[p] : p; }
  function randAnteil(von, kasten) {
    const dx = Math.abs(kasten.x - von.x), dy = Math.abs(kasten.y - von.y);
    const kx = dx ? (kasten.w / 2 + 6) / dx : Infinity, ky = dy ? (kasten.h / 2 + 6) / dy : Infinity;
    return Math.min(0.45, kx, ky);
  }
  // Position auf einem Weg aus Knoten und Punkten; an Knoten beginnt und endet er an der Kastenkante
  function punktAuf(weg, t) {
    const p = weg.map(punkt);
    const l = [];
    for (let i = 0; i < p.length - 1; i++) l.push(Math.hypot(p[i + 1].x - p[i].x, p[i + 1].y - p[i].y));
    const ges = l.reduce((a, b) => a + b, 0);
    const anf = p[0].w ? randAnteil(p[1], p[0]) * l[0] : 0;
    const end = p[p.length - 1].w ? randAnteil(p[p.length - 2], p[p.length - 1]) * l[l.length - 1] : 0;
    let d = anf + t * (ges - anf - end);
    for (let i = 0; i < l.length; i++) {
      if (d <= l[i] || i === l.length - 1) {
        const lt = l[i] ? Math.min(1, d / l[i]) : 0;
        return { x: p[i].x + (p[i + 1].x - p[i].x) * lt, y: p[i].y + (p[i + 1].y - p[i].y) * lt };
      }
      d -= l[i];
    }
    return { x: p[0].x, y: p[0].y };
  }
  // Spur einer Nachricht auf der Sitzung: je Richtung eine Seite der Linie
  function spur(vm, zumRs) {
    const s = SITZUNG[vm];
    const dx = s.router.x - s.rs.x, dy = s.router.y - s.rs.y, l = Math.hypot(dx, dy);
    const o = zumRs ? -SPUR : SPUR;
    const nx = -dy / l * o, ny = dx / l * o;
    const a0 = { x: s.rs.x + nx, y: s.rs.y + ny }, b0 = { x: s.router.x + nx, y: s.router.y + ny };
    // Enden knapp ausserhalb der Kaesten, damit die Marke am Ziel sichtbar bleibt
    const aufHoehe = (y) => ({ x: a0.x + (y - a0.y) / (b0.y - a0.y) * (b0.x - a0.x), y });
    const a = aufHoehe(s.rs.y + 9), b = aufHoehe(s.router.y - 9);
    return zumRs ? [b, a] : [a, b];
  }
  // Datenweg: clienta -> asa -> ixp-peering -> Router -> Server, als eigene Spur neben den Leitungen
  const DATEN_DX = -13, DATEN_DY = 11;
  function datenweg(ziel) {
    const vm = ziel === 'webevil' ? 'hijacker' : 'asb';
    const c = KNOTEN['d:clienta'], e = KNOTEN[ZUGANG[vm].ende];
    return [{ x: c.x + DATEN_DX, y: c.y - c.h / 2 - 5 }, { x: X.asa + DATEN_DX, y: Y_BUS + DATEN_DY },
      { x: X[vm] + DATEN_DX, y: Y_BUS + DATEN_DY }, { x: X[vm] + DATEN_DX, y: e.y - e.h / 2 - 5 }];
  }

  function ursprung(pfad) { const t = (pfad || '').trim().split(/\s+/); return t[t.length - 1] || ''; }

  function fluegeFuer(sz, schritt) {
    const fl = [];
    if (schritt.art === 'ereignis') {
      const jePaar = {};
      schritt.pakete.forEach((p) => {
        const von = M.IP_SYSTEM[p.von], an = M.IP_SYSTEM[p.an];
        if (!von || !an) return;
        const zumRs = an === 'rs', vm = zumRs ? von : an;
        const k = von + '>' + an;
        const nr = jePaar[k] = (jePaar[k] || 0) + 1;
        fl.push({
          weg: spur(vm, zumRs), art: p.ev === 'W' ? 'ruecknahme' : 'ankuendigung',
          farbe: p.ev === 'W' ? SYSTEM_FARBE[von] : (AS_FARBE[ursprung(p.pfad)] || 'var(--m-rs)'),
          gestrichelt: p.ev === 'A' && zumRs && new Set(p.pfad.split(' ')).size > 1,
          span: [(nr - 1) * 0.2, 1],
          knoten: ['k:' + von, 'k:' + an],
          label: `${p.zeit}  ${von} → ${an}  ${p.ev === 'W' ? 'Rücknahme' : 'Ankündigung'} ${p.praefix}${p.pfad ? '  Pfad ' + p.pfad : ''}`,
        });
      });
    } else if (schritt.art === 'zustand') {
      const m = M.messungClienta(sz.id, schritt.cursor);
      if (m) {
        const eve = m.hop2 === '192.0.2.66';
        const ziel = eve ? 'webevil' : 'weblegit';
        const hin = datenweg(ziel);
        fl.push({
          weg: hin.concat(hin.slice(0, -1).reverse()), linie: hin, art: 'daten', farbe: eve ? 'var(--m-eve)' : 'var(--m-bob)',
          knoten: ['d:clienta', 'd:asa', eve ? 'd:hijacker' : 'd:asb', 'd:' + ziel],
          label: 'clienta → 198.51.100.10 · ' + m.http + ' · Hop 2 ' + m.hop2,
        });
      }
    }
    return fl;
  }

  function marke(art, x, y, farbe) {
    if (art === 'daten') return el('circle', { cx: x, cy: y, r: 5.5, fill: farbe, class: 'marke' }, flugEbene);
    const pts = `${x},${y - 7} ${x + 7},${y} ${x},${y + 7} ${x - 7},${y}`;
    if (art === 'ruecknahme') return el('polygon', { points: pts, fill: 'var(--flaeche)', stroke: farbe, 'stroke-width': 2, class: 'marke' }, flugEbene);
    return el('polygon', { points: pts, fill: farbe, class: 'marke' }, flugEbene);
  }

  function fluegeZeichnen(fluege, fortschritt) {
    flugEbene.innerHTML = '';
    fluege.forEach((f) => {
      const pts = (f.linie || f.weg).map(punkt).map((p) => `${p.x},${p.y}`).join(' ');
      el('polyline', { points: pts, class: 'flugbahn', stroke: f.farbe,
        'stroke-dasharray': f.gestrichelt ? '5 4' : (f.art === 'ruecknahme' ? '2 3' : 'none') }, flugEbene);
    });
    fluege.forEach((f) => {
      const [a, b] = f.span || [0, 1];
      const lt = Math.max(0, Math.min(1, (fortschritt - a) / (b - a)));
      const p = punktAuf(f.weg, lt);
      const m = marke(f.art, p.x, p.y, f.farbe);
      el('title', {}, m).textContent = f.label;
    });
  }

  /* ---------------- Zustaende in den Kaesten ---------------- */
  function setze(k, z1, z2, farbe) {
    const [t1, t2] = zeilen[k];
    t1.textContent = z1 || ''; t2.textContent = z2 || '';
    t1.style.fill = farbe || '';
  }

  // rs: eine Zeile je Praefix. Zuerst das Angriffspraefix (bei Szenario 2 identisch mit Bobs
  // eigenem), danach die uebrigen bereits vor dem Szenario bestehenden eigenen Praefixe -- so
  // bleibt der tatsaechliche Ausgangszustand der Kontrollebene durchgehend sichtbar, nicht nur
  // was der Angriff veraendert.
  function rsZeilenBauen(sz, t) {
    const ziel = EIGENE_PRAEFIXE.find((e) => e.pfx === sz.praefix);
    const rest = EIGENE_PRAEFIXE.filter((e) => e !== ziel);
    const reihen = [{ pfx: sz.praefix, marke: ziel ? ziel.vm + ' · Ziel' : 'Ziel' }]
      .concat(rest.map((e) => ({ pfx: e.pfx, marke: e.vm })));
    return reihen.map((r) => {
      const b = M.bestPathRs(r.pfx, t);
      return {
        text: r.pfx + ' (' + r.marke + ') ' + (b.vorhanden ? '→ ' + b.pfad : '→ —'),
        farbe: b.vorhanden ? (AS_FARBE[ursprung(b.pfad)] || '') : '',
        titel: b.vorhanden ? 'NH ' + b.nh + ' · BMP Loc-RIB ' + M.zeitText(b.t, 3)
          : b.t != null ? 'BMP Loc-RIB ' + M.zeitText(b.t, 3) + ' zurückgezogen' : 'noch keine Ankündigung',
      };
    });
  }
  function setzeRs(reihen) {
    rsZeilen.forEach((el2, i) => {
      const r = reihen[i];
      el2.textContent = r ? r.text : '';
      el2.style.fill = r ? r.farbe : '';
      let t = el2.querySelector('title');
      if (!t && r) { t = document.createElementNS(svgns, 'title'); el2.appendChild(t); }
      if (t) t.textContent = r ? r.titel : '';
    });
  }

  function befehlZeit(sz, phase) { const s = sz.schritte.find((x) => x.phase === phase && x.art === 'befehl'); return s ? s.cursor : Infinity; }

  // Kontrollebene: rs (Best Path je Praefix) und die eigene Ankuendigung jedes Routers.
  function kontrollZustaende(sz, t) {
    setzeRs(rsZeilenBauen(sz, t));
    setze('k:asa', 'network 203.0.113.0/24', '', '');
    setze('k:asb', 'network 198.51.96.0/20', 'RS-OUT: 64496 64496 64496', '');
    const aktiv = t >= befehlZeit(sz, 'T1') && t < befehlZeit(sz, 'T3');
    setze('k:hijacker', aktiv ? 'network ' + sz.praefix : 'network —', '', aktiv ? 'var(--m-eve)' : '');
  }
  // Datenebene: Routing-Tabellen von asa/asb und die Messung von clienta.
  function datenZustaende(sz, t) {
    ['asa', 'asb'].forEach((vm) => {
      const r = M.routingEintrag(sz.id, vm, t);
      if (!r) { setze('d:' + vm, '198.51.100.10: —', 'Routing-Tabelle', ''); return; }
      const weg = r.nh.startsWith('directly') ? 'direkt ' + r.schnittstelle : 'via ' + r.nh;
      setze('d:' + vm, r.praefix + ' ' + weg, 'Routing-Tabelle ' + r.phase, r.nh === '192.0.2.66' ? 'var(--m-eve)' : 'var(--m-bob)');
    });
    setze('d:hijacker', '', '', '');
    const m = M.messungClienta(sz.id, t);
    if (m) setze('d:clienta', m.http, 'Hop 2 ' + m.hop2 + ' · Messung ' + m.phase, m.hop2 === '192.0.2.66' ? 'var(--m-eve)' : 'var(--m-bob)');
    else setze('d:clienta', '', '', '');
  }
  // Zugriffe auf die beiden Webserver bis zu diesem Zeitpunkt im Szenario.
  function webserverZustaende(sz, t) {
    [['d:weblegit', 'weblegit-log', 'var(--m-bob)'], ['d:webevil', 'webevil-log', 'var(--m-eve)']].forEach(([k, id, farbe]) => {
      const liste = M.ARTEFAKT[id].ansichten[0].eintraege.filter((e) => e.t <= t && e.t > sz.fensterBeginn);
      if (liste.length) setze(k, 'GET ' + M.zeitText(liste[liste.length - 1].t, 0), 'access.log · ' + liste.length + ' Zugriff' + (liste.length > 1 ? 'e' : ''), farbe);
      else setze(k, '', 'access.log · 0 Zugriffe', '');
    });
  }
  function zustaende(sz, schritt) {
    const t = schritt.cursor;
    kontrollZustaende(sz, t);
    datenZustaende(sz, t);
    webserverZustaende(sz, t);
  }

  /* ---------------- Info-Karte ---------------- */
  function infoAus() { infoEl.classList.add('hidden'); }
  function knotenInfo(system) {
    const info = INFO[system]; if (!info) return;
    infoEl.querySelector('.ei-title').textContent = system;
    const adr = info.adressen.map(([nic, ip, seg]) => `<dt>${nic}</dt><dd>${ip} <span class="ei-seg">${seg}</span></dd>`).join('');
    const konfig = info.konfig ? M.rohdatei(info.konfig).split('\n')
      .filter((z) => z && !/^(Building configuration|Current configuration|end)/.test(z)).join('\n') : '';
    const anzahl = M.ARTEFAKTE.filter((a) => a.system === system).length;
    infoEl.querySelector('.ei-body').innerHTML = `
      <div class="ei-rolle">${info.rolle}</div>
      <dl class="ei-fakten">${info.as ? `<dt>AS</dt><dd>${info.as}</dd>` : ''}${adr}<dt>kündigt an</dt><dd>${info.ankuendigt}</dd></dl>
      ${anzahl ? `<button class="ei-knopf">${anzahl} Artefakt${anzahl > 1 ? 'e' : ''} anzeigen</button>` : ''}
      ${konfig ? `<details class="ei-konfig"><summary>show running-config</summary><pre>${esc(konfig)}</pre></details>` : ''}`;
    const knopf = infoEl.querySelector('.ei-knopf');
    if (knopf) knopf.addEventListener('click', () => auswahlHandler && auswahlHandler(system));
    infoEl.classList.remove('hidden');
  }
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  /* ---------------- Zeichnen ---------------- */
  function zeichnen(sz, schritt, fortschritt) {
    const fluege = fluegeFuer(sz, schritt);
    fluegeZeichnen(fluege, fortschritt);
    zustaende(sz, schritt);
    // Ereignis: beteiligte Knoten der Kontrollebene; Befehl: hijacker; Zustand: alle
    let aktiv = null;
    if (schritt.art === 'ereignis') { aktiv = new Set(['k:rs']); fluege.forEach((f) => f.knoten.forEach((k) => aktiv.add(k))); }
    else if (schritt.art === 'befehl') aktiv = new Set(['k:hijacker']);
    knotenEbene.querySelectorAll('.knoten').forEach((g) => {
      const k = g.getAttribute('data-knoten');
      g.classList.toggle('dim', !!aktiv && !aktiv.has(k));
      g.classList.toggle('puls', schritt.art === 'befehl' && k === 'k:hijacker');
    });
  }
  function markiereKnoten(system) {
    knotenEbene.querySelectorAll('.knoten').forEach((g) => g.classList.toggle('selected', !!system && g.getAttribute('data-system') === system));
  }

  App.netz = { aufbauen, zeichnen, knotenInfo, infoAus, markiereKnoten };
})(window.App);
