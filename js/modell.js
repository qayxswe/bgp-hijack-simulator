/* ===========================================================================
   Modell: liest die woertlich eingebetteten Primaerdaten (js/rohdaten.js) und
   macht daraus
     - je Artefakt eine Liste zeitlich eingeordneter Eintraege,
     - je Szenario die Schritte T0 bis T4 aus der Hausarbeit.

   Zeiten sind Sekunden seit Mitternacht UTC am 24.09.2026.

   Einordnung der Eintraege:
     Mitschnitt (bgp-updates-rs.txt) und BMP tragen Mikro- bzw.
     Millisekunden und werden direkt eingeordnet. MRT-Dump und Textprotokoll
     tragen nur ganze Sekunden. Jede ihrer Zeilen wird deshalb dem UPDATE auf
     der Leitung zugeordnet, das sie festhaelt (gleicher Nachbar, gleiches
     Praefix, gleiche Reihenfolge). Angezeigt wird immer die Zeile selbst,
     also mit ihrer eigenen, groeberen Zeitangabe.
   =========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const R = window.ROHDATEN;
  const MITTERNACHT = 1790208000;          // 2026-09-24T00:00:00Z als Unixzeit

  /* ---------------- Systeme ---------------- */
  const IP_SYSTEM = { '192.0.2.1': 'rs', '192.0.2.11': 'asb', '192.0.2.12': 'asa', '192.0.2.66': 'hijacker' };

  /* ---------------- Zeit ---------------- */
  function hms(s) {
    const m = /(\d{2}):(\d{2}):(\d{2})(\.\d+)?/.exec(s);
    if (!m) return NaN;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? parseFloat(m[4]) : 0);
  }
  function ausEpoch(e) { return Number(e) - MITTERNACHT; }
  function zeitText(t, stellen) {
    if (t == null || isNaN(t)) return '—';
    const st = stellen == null ? 3 : stellen;
    const ganz = Math.floor(t + 1e-9);
    const h = Math.floor(ganz / 3600), m = Math.floor((ganz % 3600) / 60), s = ganz % 60;
    const zwei = (x) => String(x).padStart(2, '0');
    let text = zwei(h) + ':' + zwei(m) + ':' + zwei(s);
    // +0.01: Gleitkommarest ausgleichen (0.834 wird sonst zu 833.99999)
    if (st > 0) text += '.' + String(Math.min(Math.pow(10, st) - 1, Math.floor((t - ganz) * Math.pow(10, st) + 0.01))).padStart(st, '0');
    return text;
  }
  const ZEITSTEMPEL = /^(?:\[Zeit\] )?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+)\s*$/;

  function zeilen(pfad) {
    const text = R[pfad];
    if (text == null) throw new Error('Rohdatei fehlt: ' + pfad);
    const z = text.split('\n');
    if (z.length && z[z.length - 1] === '') z.pop();
    return z;
  }

  /* ---------------- Mitschnitt rs_enp0s8.pcap (dekodierte UPDATEs) ---------------- */
  function leseMitschnitt() {
    const kopf = [], eintraege = [];
    zeilen('FRRouting/_RouteServer/bgp-updates-rs.txt').forEach((z, i) => {
      if (z.startsWith('#') || z.trim() === '') return;
      if (z.startsWith('Zeit(UTC)')) { kopf.push(z); return; }
      const f = z.trim().split(/\s+/);
      const e = { t: hms(f[0]), zeit: f[0], text: z, nr: i + 1, von: f[1], an: f[2], ev: f[3], praefix: '', pfad: '', nh: '' };
      if (e.ev === 'A') { e.praefix = f[4]; e.nh = f[f.length - 1]; e.pfad = f.slice(5, -1).join(' '); }
      else if (e.ev === 'W') { e.praefix = f[4]; }
      eintraege.push(e);
    });
    return { kopf, eintraege };
  }

  /* ---------------- BMP-Ausleitung (dekodiert) ---------------- */
  function leseBmp() {
    const kopf = [], eintraege = [];
    zeilen('FRRouting/_RouteServer/bmp-nachrichten.txt').forEach((z, i) => {
      if (z.startsWith('#') || z.trim() === '') return;
      if (z.startsWith('Art ')) { kopf.push(z); return; }
      const f = z.trim().split(/\s+/);
      const e = { t: hms(f[1]), zeit: f[1], text: z, nr: i + 1, art: f[0] };
      // Route Monitoring: Sicht (Adj post/pre, Loc-RIB), Peer, Ereignis, Praefix, Pfad, Next-Hop
      if (e.art === 'RM') {
        const m = /^RM\s+\S+\s+(Adj post|Adj pre|Loc-RIB)\s+(\S+)(?:\s+([AW])\s+(\S+)(?:\s+(.*?)\s+(\d+\.\d+\.\d+\.\d+))?)?\s+(\d+)\s*$/.exec(z);
        if (m) {
          e.sicht = m[1]; e.peer = m[2]; e.ev = m[3] || ''; e.praefix = m[4] || '';
          e.pfad = (m[5] || '').trim(); e.nh = m[6] || '';
        }
      }
      eintraege.push(e);
    });
    return { kopf, eintraege };
  }

  /* ---------------- MRT-Dump updates.mrt (bgpdump -m) ---------------- */
  // Jede Zeile wird dem empfangenen UPDATE im Mitschnitt zugeordnet
  // (gleicher Nachbar, gleiches Praefix, gleiche Art, gleicher Pfad).
  function leseMrt(mitschnitt) {
    const vergeben = new Set();
    return zeilen('FRRouting/_RouteServer/mrt-updates-bgpdump.txt').map((z, i) => {
      const f = z.split('|');
      const sek = ausEpoch(f[1]);
      const ev = f[2], peer = f[3], praefix = f[5], pfad = f[6] || '';
      const treffer = mitschnitt.find((p, k) => !vergeben.has(k) && p.an === '192.0.2.1' && p.von === peer
        && p.ev === ev && p.praefix === praefix && (ev === 'W' || p.pfad === pfad)
        && Math.floor(p.t) >= sek - 1 && Math.floor(p.t) <= sek + 1);
      let t = sek;
      if (treffer) { vergeben.add(mitschnitt.indexOf(treffer)); t = treffer.t; }
      return { t, text: z, nr: i + 1, eigeneZeit: zeitText(sek, 0), zugeordnet: !!treffer };
    });
  }

  /* ---------------- rib.mrt (periodischer Tabellendump) ---------------- */
  function leseRibMrt() {
    const z = zeilen('FRRouting/_RouteServer/mrt-rib-bgpdump.txt');
    const sek = ausEpoch(z[0].split('|')[1]);
    return { t: sek, zeilen: z };
  }

  /* ---------------- Textprotokoll journalctl -u frr ---------------- */
  const UPDATE_ZEILE = /rcvd UPDATE|rcvd \d+\.\d+\.\d+\.\d+\/\d+|send UPDATE|withdrawn|unreachable|walkcb|subgroup_process|workqueue|End-of-RIB/;

  function leseJournal(mitschnitt) {
    const roh = zeilen('FRRouting/_RouteServer/dienst-protokoll.log').map((z, i) => ({
      text: z, nr: i + 1, sek: hms(z.slice(11, 19)), update: UPDATE_ZEILE.test(z),
    }));
    // Mitschnitt je ganzer Sekunde
    const jeSek = new Map();
    mitschnitt.forEach((p, k) => {
      const s = Math.floor(p.t);
      if (!jeSek.has(s)) jeSek.set(s, []);
      jeSek.get(s).push(Object.assign({ k }, p));
    });
    let aktSek = null, verbraucht, letzterEmpfang, offen;
    roh.forEach((e) => {
      e.t = e.sek;
      const pakete = jeSek.get(e.sek);
      if (!pakete || !e.update) return;
      if (aktSek !== e.sek) { aktSek = e.sek; verbraucht = new Set(); letzterEmpfang = e.sek; offen = {}; }
      const empf = /(\d+\.\d+\.\d+\.\d+)\(\w+\) rcvd (UPDATE w\/ attr|UPDATE about|\d)/.exec(e.text);
      const sendeAn = /u1:s1 (\d+\.\d+\.\d+\.\d+) send UPDATE/.exec(e.text);
      const naechstes = (bed) => pakete.find((p) => !verbraucht.has(p.k) && bed(p));
      if (empf) {
        const peer = empf[1];
        let p = null;
        if (empf[2] === 'UPDATE about') p = naechstes((q) => q.von === peer && q.an === '192.0.2.1' && q.ev === 'W');
        else if (empf[2] === 'UPDATE w/ attr') { p = naechstes((q) => q.von === peer && q.an === '192.0.2.1' && q.ev === 'A'); offen[peer] = p; }
        else if (offen[peer]) { p = offen[peer]; delete offen[peer]; }
        else p = naechstes((q) => q.von === peer && q.an === '192.0.2.1' && q.ev === 'A');
        if (p) { verbraucht.add(p.k); e.t = p.t; letzterEmpfang = p.t; e.zugeordnet = true; }
      } else if (sendeAn) {
        const p = naechstes((q) => q.von === '192.0.2.1' && q.an === sendeAn[1] && q.t > letzterEmpfang);
        if (p) { verbraucht.add(p.k); e.t = p.t; e.zugeordnet = true; }
      } else if (/walkcb|subgroup_process|u1:s1 send UPDATE|unreachable/.test(e.text)) {
        const erst = pakete.filter((q) => q.von === '192.0.2.1' && q.t > letzterEmpfang)
          .reduce((a, q) => (a == null || q.t < a ? q.t : a), null);
        if (erst != null) { e.t = erst; e.zugeordnet = true; }
      } else if (letzterEmpfang > e.sek) {
        e.t = letzterEmpfang; e.zugeordnet = true;
      }
    });
    // Sortierung stabil nach Zeit, bei Gleichstand in Dateireihenfolge
    return roh;
  }

  /* ---------------- einfache Protokolle mit Zeitangabe je Zeile ---------------- */
  function leseZugriff(vm) {
    const alle = [];
    ['1_SubPraefix_Vortaeuschen', '2_GleichesPraefix_FalscherUrsprung'].forEach((o) => {
      zeilen(o + '/zugriffsprotokoll-' + vm + '.log').forEach((z) => {
        const m = /\[\d+\/\w+\/\d+:(\d{2}:\d{2}:\d{2}) /.exec(z);
        alle.push({ t: m ? hms(m[1]) : NaN, text: z });
      });
    });
    return alle.map((e, i) => Object.assign(e, { nr: i + 1 }));
  }
  function leseSudo() {
    const alle = [];
    ['1_SubPraefix_Vortaeuschen', '2_GleichesPraefix_FalscherUrsprung'].forEach((o) => {
      zeilen(o + '/sudo-audit-hijacker.log').forEach((z) => alle.push({ t: hms(z.slice(11, 19)), text: z }));
    });
    return alle.map((e, i) => Object.assign(e, { nr: i + 1 }));
  }
  // Zeilen mit der Zeit am Anfang (HTTP-Sicht, Paketlisten der Mitschnitte)
  function leseListe(pfad) {
    const kopf = [], eintraege = [];
    zeilen(pfad).forEach((z, i) => {
      if (z.startsWith('#') || z.trim() === '') return;
      if (z.startsWith('Zeit(UTC)')) { kopf.push(z); return; }
      eintraege.push({ t: hms(z.slice(0, 15)), zeit: z.slice(0, 15), text: z, nr: i + 1 });
    });
    return { kopf, eintraege };
  }

  /* ---------------- Abfragen zu T0, T2, T4 (Schnappschuesse) ---------------- */
  function leseAbschnitte(pfad) {
    const abschnitte = [];
    let akt = null;
    zeilen(pfad).forEach((z) => {
      const kopf = /^--- (T[024]) .*---$/.exec(z);
      if (kopf) { akt = { phase: kopf[1], titel: z, zeilen: [], tVon: Infinity, tBis: -Infinity }; abschnitte.push(akt); return; }
      if (!akt) return;
      akt.zeilen.push(z);
      const m = ZEITSTEMPEL.exec(z);
      if (m) { const t = hms(m[1].slice(11)); akt.tVon = Math.min(akt.tVon, t); akt.tBis = Math.max(akt.tBis, t); }
    });
    abschnitte.forEach((a) => { while (a.zeilen.length && a.zeilen[a.zeilen.length - 1].trim() === '') a.zeilen.pop(); });
    return abschnitte;
  }

  /* ---------------- Szenarien ---------------- */
  const SZENARIEN = {
    s1: {
      id: 's1', nr: 1, ordner: '1_SubPraefix_Vortaeuschen',
      name: 'Sub-Präfix-Hijack', unter: 'Vortäuschen des Ziels',
      praefix: '198.51.100.0/24',
      kurz: 'Eve kündigt 198.51.100.0/24 an, ein spezifischeres Präfix innerhalb von Bobs 198.51.96.0/20.',
    },
    s2: {
      id: 's2', nr: 2, ordner: '2_GleichesPraefix_FalscherUrsprung',
      name: 'Gleiches Präfix, falscher Ursprung', unter: 'Vortäuschen des Ziels',
      praefix: '198.51.96.0/20',
      kurz: 'Eve kündigt Bobs 198.51.96.0/20 selbst an, mit dem Pfad 64511 statt Bobs verlängertem 64496 64496 64496.',
    },
  };
  const SZENARIO_REIHE = ['s1', 's2'];

  const PHASEN = {
    T0: { name: 'Ausgangszustand', art: 'Zustand' },
    T1: { name: 'Ankündigung', art: 'Ereignis' },
    T2: { name: 'Angriff aktiv', art: 'Zustand' },
    T3: { name: 'Rücknahme', art: 'Ereignis' },
    T4: { name: 'wiederhergestellter Ausgangszustand', art: 'Zustand' },
  };
  const PHASEN_REIHE = ['T0', 'T1', 'T2', 'T3', 'T4'];

  // Erlaeuterungen je Schritt, inhaltlich wie in Kapitel 8 und 9 der Arbeit.
  // T1/T3: erster Eintrag = Befehl auf hijacker, danach je Ereignisgruppe auf
  // der Leitung einer.
  const TEXTE = {
    s1: {
      T0: ['Ausgangszustand', 'hijacker kündigt kein eigenes Präfix an, 198.51.100.0/24 ist in der BGP-Tabelle von rs unbekannt. Alice erreicht Bobs Server über asb.'],
      T1: [
        ['Befehl auf hijacker', 'Eve kündigt per vtysh 198.51.100.0/24 an.'],
        ['Ankündigung erreicht rs', 'Eves UPDATE mit dem Pfad 64511 trifft auf rs ein. MRT-Dump, Textprotokoll, Mitschnitt und BMP (Adj-RIB-In) halten es fest.'],
        ['Best Path und Weitergabe', 'Die Loc-RIB übernimmt Eves Pfad 50 ms nach der Ankunft. rs gibt ihn unverändert an alle drei Nachbarn weiter, auch an hijacker selbst. Die Weitergabe steht im Textprotokoll und im Mitschnitt, nicht im MRT-Dump.'],
        ['Rückmeldungen von asb und asa', 'asb und asa übernehmen die /24 und senden sie mit vorangestellter eigener AS-Nummer an rs zurück. Bei asb wird die Nummer wegen der Pfadverlängerung dreifach vorangestellt.'],
      ],
      T2: ['Angriff aktiv (Messpunkt)', 'Acht Sekunden nach der Ankündigung werden die Tabellen abgefragt. rs führt Eves Pfad als Best Path, asa und asb leiten 198.51.100.10 über 192.0.2.66. Alice erhält Eves Seite. Der periodische Tabellendump (18:45:00, 18:46:00) erfasst den Angriff nicht.'],
      T3: [
        ['Befehl auf hijacker', 'Eve nimmt die Ankündigung per „no network“ zurück.'],
        ['Rücknahme erreicht rs', 'Die Rücknahme (W) von hijacker trifft auf rs ein.'],
        ['Rückmeldung von asa wird Best Path', 'rs kennt noch die Rückmeldungen von asa und asb und wählt den kürzeren Pfad 64499 64511 als neuen Best Path. Er geht an alle Nachbarn.'],
        ['asb meldet neu, asa zieht zurück', 'asb meldet den nun verlängerten Pfad erneut zurück, asa zieht seine Rückmeldung zurück.'],
        ['Rückmeldung von asb wird Best Path', 'Übrig ist nur noch der Pfad 64496 64496 64496 64499 64511 von asb. rs gibt ihn an alle Nachbarn weiter.'],
        ['asb zieht zurück', 'asb zieht auch seine Rückmeldung zurück.'],
        ['Präfix verschwindet', 'Kein Pfad mehr vorhanden: rs zieht 198.51.100.0/24 bei allen Nachbarn zurück, 255 ms nach Eves Rücknahme. Aus einer Handlung des Angreifers sind so viele Einträge geworden.'],
      ],
      T4: ['Ausgangszustand wiederhergestellt', 'Acht Sekunden nach der Rücknahme ist die /24 aus allen Tabellen verschwunden. Nachweisbar bleibt der Angriff nur in den fortlaufenden Aufzeichnungen: MRT-Dump, Textprotokoll, Mitschnitt und BMP.'],
    },
    s2: {
      T0: ['Ausgangszustand', 'Bobs Pfad 64496 64496 64496 ist Best Path für 198.51.96.0/20. hijacker kündigt nichts Eigenes an.'],
      T1: [
        ['Befehl auf hijacker', 'Eve kündigt per vtysh dasselbe Präfix wie Bob an, 198.51.96.0/20.'],
        ['Ankündigung erreicht rs', 'Eves UPDATE mit dem Pfad 64511 trifft auf rs ein. Für dasselbe Präfix liegen nun zwei Ursprünge vor.'],
        ['Best Path wechselt', 'Eves Pfad ist einen Eintrag lang, Bobs drei. Die Loc-RIB ersetzt Bobs Pfad nach 50 ms, ohne dass Bob etwas zurückzieht. rs gibt Eves Pfad an alle weiter.'],
        ['Rückmeldung nur von asa', 'Nur asa meldet Eves Pfad zurück. asb behält die eigene, lokal erzeugte Route (Weight 32768) und sendet keine Rückmeldung.'],
      ],
      T2: ['Angriff aktiv (Messpunkt)', 'rs führt Eves Pfad als Best Path, Grund „AS Path“, Bobs Pfad steht an dritter Stelle. asa leitet über 192.0.2.66, asb behält die eigene Route. Der Tabellendump von 18:47:00 fällt in das Angriffsfenster.'],
      T3: [
        ['Befehl auf hijacker', 'Eve nimmt die Ankündigung per „no network“ zurück.'],
        ['Rücknahme erreicht rs', 'Die Rücknahme (W) von hijacker trifft auf rs ein.'],
        ['Rückmeldung von asa wird Best Path', 'rs kennt noch die Rückmeldung von asa (64499 64511), die kürzer ist als Bobs Pfad, und gibt sie als neuen Best Path weiter.'],
        ['asa zieht zurück', 'asa zieht seine Rückmeldung zurück.'],
        ['Bobs Pfad wieder Best Path', 'Übrig ist nur Bobs Pfad. rs gibt ihn 153 ms nach Eves Rücknahme wieder an alle weiter. Der Zwischenzustand liegt in derselben Sekunde und ist nur in BMP und Mitschnitt zeitlich geordnet.'],
        ['Folgeankündigungen', 'asa und hijacker melden Bobs Pfad mit vorangestellter eigener AS-Nummer zurück.'],
      ],
      T4: ['Ausgangszustand wiederhergestellt', 'Bobs Pfad ist wieder Best Path. Der Tabellendump von 18:47:00 zeigt Eves Pfad trotzdem weiter, bis zum nächsten Dump um 18:48:00.'],
    },
  };

  /* ---------------- Aufbau ---------------- */
  const mitschnitt = leseMitschnitt();
  const bmp = leseBmp();
  const mrt = leseMrt(mitschnitt.eintraege);
  const ribMrt = leseRibMrt();
  const journal = leseJournal(mitschnitt.eintraege);
  const http = leseListe('abgeleitet/asa_enp0s10-http.txt');
  const pakete = {};
  ['rs_enp0s8', 'rs_lo', 'asa_enp0s8', 'asa_enp0s10', 'hijacker_enp0s8', 'hijacker_enp0s10'].forEach((m) => {
    pakete[m] = leseListe('abgeleitet/' + m + '-pakete.txt');
  });
  const konfig = (vm) => zeilen('Konfiguration/' + vm + '.txt')
    .filter((z) => z !== '' && !/^(Building configuration|Current configuration|end)/.test(z));
  const zugriffLegit = leseZugriff('weblegit');
  const zugriffEvil = leseZugriff('webevil');
  const sudo = leseSudo();

  const abschnitte = {};   // abschnitte[szenario][datei] = [...]
  const SCHNAPPSCHUSS_DATEIEN = ['rib-aus-dem-ram.txt', 'adj-rib-in-rs.txt', 'adj-rib-in-asa.txt', 'adj-rib-in-asb.txt',
    'bgp-tabelle-asa.txt', 'bgp-tabelle-asb.txt', 'routing-tabelle-asa.txt', 'routing-tabelle-asb.txt', 'messprotokoll-clienta.txt'];
  SZENARIO_REIHE.forEach((id) => {
    abschnitte[id] = {};
    SCHNAPPSCHUSS_DATEIEN.forEach((d) => { abschnitte[id][d] = leseAbschnitte(SZENARIEN[id].ordner + '/' + d); });
  });

  /* ---------------- Artefakte ----------------
     gruppe: 'rs' = Rekonstruktion (Artefakte des Route-Servers),
             'bestaetigung' = weitere Quellen (Tabelle 7 der Arbeit).
     Protokolle haben eine oder mehrere Ansichten; die erste ist die Vorgabe. */
  function schnappschuss(datei) { return (szId) => abschnitte[szId][datei]; }
  function ansicht(id, name, liste, befehl, quelle) {
    return { id, name, eintraege: liste.eintraege || liste, kopf: liste.kopf || [], befehl, quelle };
  }
  const R_ = 'FRRouting/_RouteServer/';
  const ARTEFAKTE = [
    { id: 'rs-bgp', gruppe: 'rs', system: 'rs', titel: 'RIBs im RAM · BGP-Tabelle', typ: 'schnappschuss',
      befehl: 'vtysh -c "show bgp ipv4 unicast <Präfix>"', aufloesung: 'Abfragezeitpunkt',
      quelle: (sz) => sz.ordner + '/rib-aus-dem-ram.txt', abschnitte: schnappschuss('rib-aus-dem-ram.txt'),
      ergaenzung: (szId, abschnitt) => locRibUebersicht(szId, abschnitt) },
    { id: 'rs-adj', gruppe: 'rs', system: 'rs', titel: 'RIBs im RAM · Adj-RIB-In je Nachbar', typ: 'schnappschuss',
      befehl: 'vtysh -c "show bgp ipv4 unicast neighbors <Adresse> received-routes"', aufloesung: 'Abfragezeitpunkt',
      quelle: (sz) => sz.ordner + '/adj-rib-in-rs.txt', abschnitte: schnappschuss('adj-rib-in-rs.txt') },
    { id: 'rs-mrt', gruppe: 'rs', system: 'rs', titel: 'MRT-Dump · updates.mrt', typ: 'log', aufloesung: 'Sekunde', mrtZeit: true,
      ansichten: [ansicht('mrt', 'bgpdump -m', mrt, 'bgpdump -m /var/log/frr/updates.mrt', R_ + 'mrt-updates-bgpdump.txt')] },
    { id: 'rs-rib-mrt', gruppe: 'rs', system: 'rs', titel: 'MRT-Tabellendump · rib.mrt', typ: 'tabellendump',
      befehl: 'bgpdump -m /var/log/frr/rib.mrt', aufloesung: 'alle 60 s, überschrieben',
      quelle: () => R_ + 'mrt-rib-bgpdump.txt', dump: ribMrt },
    { id: 'rs-journal', gruppe: 'rs', system: 'rs', titel: 'Textprotokoll · journalctl -u frr', typ: 'log', aufloesung: 'Sekunde',
      ansichten: [
        ansicht('update', 'UPDATE-Verarbeitung', journal.filter((e) => e.update), 'journalctl -u frr -o short-iso', R_ + 'dienst-protokoll.log'),
        ansicht('alle', 'alle Zeilen', journal, 'journalctl -u frr -o short-iso', R_ + 'dienst-protokoll.log'),
      ] },
    { id: 'rs-pcap', gruppe: 'rs', system: 'rs', titel: 'Paketmitschnitt · rs_enp0s8.pcap', typ: 'log', aufloesung: 'Mikrosekunde',
      ansichten: [
        ansicht('update', 'UPDATE, dekodiert', mitschnitt, 'tshark -r rs_enp0s8.pcap -Y bgp.type==2 -O frame,ip,bgp', R_ + 'bgp-updates-rs.txt'),
        ansicht('alle', 'alle Pakete', pakete.rs_enp0s8, 'tshark -n -r rs_enp0s8.pcap', R_ + 'rs_enp0s8.pcap'),
      ] },
    { id: 'rs-bmp', gruppe: 'rs', system: 'rs', titel: 'BMP-Ausleitung · rs_lo.pcap', typ: 'log', aufloesung: 'Millisekunde (Ankunft)',
      ansichten: [
        ansicht('bmp', 'BMP, dekodiert', bmp, 'tshark -r rs_lo.pcap -d tcp.port==11019,bmp -Y bmp', R_ + 'bmp-nachrichten.txt'),
        ansicht('alle', 'alle Pakete', pakete.rs_lo, 'tshark -n -r rs_lo.pcap', R_ + 'rs_lo.pcap'),
      ] },
    { id: 'rs-konfig', gruppe: 'rs', system: 'rs', titel: 'Konfiguration', typ: 'statisch',
      befehl: 'vtysh -c "show running-config"', aufloesung: 'zu Beginn des Laufs',
      quelle: () => 'Konfiguration/rs.txt', zeilen: konfig('rs') },

    { id: 'asb-bgp', gruppe: 'bestaetigung', system: 'asb', titel: 'BGP-Tabelle', typ: 'schnappschuss',
      befehl: 'vtysh -c "show bgp ipv4 unicast <Präfix>"', aufloesung: 'Abfragezeitpunkt',
      quelle: (sz) => sz.ordner + '/bgp-tabelle-asb.txt', abschnitte: schnappschuss('bgp-tabelle-asb.txt') },
    { id: 'asb-adj', gruppe: 'bestaetigung', system: 'asb', titel: 'Adj-RIB-In (Sitzung zu rs)', typ: 'schnappschuss',
      befehl: 'vtysh -c "show bgp ipv4 unicast neighbors 192.0.2.1 received-routes"', aufloesung: 'Abfragezeitpunkt',
      quelle: (sz) => sz.ordner + '/adj-rib-in-asb.txt', abschnitte: schnappschuss('adj-rib-in-asb.txt') },
    { id: 'asb-fib', gruppe: 'bestaetigung', system: 'asb', titel: 'Routing-Tabelle', typ: 'schnappschuss',
      befehl: 'vtysh -c "show ip route 198.51.100.10"', aufloesung: 'Abfragezeitpunkt',
      quelle: (sz) => sz.ordner + '/routing-tabelle-asb.txt', abschnitte: schnappschuss('routing-tabelle-asb.txt') },
    { id: 'asb-konfig', gruppe: 'bestaetigung', system: 'asb', titel: 'Konfiguration', typ: 'statisch',
      befehl: 'vtysh -c "show running-config"', aufloesung: 'zu Beginn des Laufs',
      quelle: () => 'Konfiguration/asb.txt', zeilen: konfig('asb') },
    { id: 'weblegit-log', gruppe: 'bestaetigung', system: 'weblegit', titel: 'access.log', typ: 'log', aufloesung: 'Sekunde',
      ansichten: [ansicht('log', 'access.log', zugriffLegit, '/var/log/nginx/access.log', '1_…/ und 2_…/zugriffsprotokoll-weblegit.log')] },
    { id: 'asa-bgp', gruppe: 'bestaetigung', system: 'asa', titel: 'BGP-Tabelle', typ: 'schnappschuss',
      befehl: 'vtysh -c "show bgp ipv4 unicast <Präfix>"', aufloesung: 'Abfragezeitpunkt',
      quelle: (sz) => sz.ordner + '/bgp-tabelle-asa.txt', abschnitte: schnappschuss('bgp-tabelle-asa.txt') },
    { id: 'asa-adj', gruppe: 'bestaetigung', system: 'asa', titel: 'Adj-RIB-In (Sitzung zu rs)', typ: 'schnappschuss',
      befehl: 'vtysh -c "show bgp ipv4 unicast neighbors 192.0.2.1 received-routes"', aufloesung: 'Abfragezeitpunkt',
      quelle: (sz) => sz.ordner + '/adj-rib-in-asa.txt', abschnitte: schnappschuss('adj-rib-in-asa.txt') },
    { id: 'asa-fib', gruppe: 'bestaetigung', system: 'asa', titel: 'Routing-Tabelle', typ: 'schnappschuss',
      befehl: 'vtysh -c "show ip route 198.51.100.10"', aufloesung: 'Abfragezeitpunkt',
      quelle: (sz) => sz.ordner + '/routing-tabelle-asa.txt', abschnitte: schnappschuss('routing-tabelle-asa.txt') },
    { id: 'asa-pcap8', gruppe: 'bestaetigung', system: 'asa', titel: 'Paketmitschnitt enp0s8', typ: 'log', aufloesung: 'Mikrosekunde',
      ansichten: [ansicht('alle', 'alle Pakete', pakete.asa_enp0s8, 'tshark -n -r asa_enp0s8.pcap', R_ + 'asa_enp0s8.pcap')] },
    { id: 'asa-pcap', gruppe: 'bestaetigung', system: 'asa', titel: 'Paketmitschnitt enp0s10', typ: 'log', aufloesung: 'Mikrosekunde',
      ansichten: [
        ansicht('http', 'HTTP', http, 'tshark -r asa_enp0s10.pcap -Y http', R_ + 'asa_enp0s10.pcap'),
        ansicht('alle', 'alle Pakete', pakete.asa_enp0s10, 'tshark -n -r asa_enp0s10.pcap', R_ + 'asa_enp0s10.pcap'),
      ] },
    { id: 'asa-konfig', gruppe: 'bestaetigung', system: 'asa', titel: 'Konfiguration', typ: 'statisch',
      befehl: 'vtysh -c "show running-config"', aufloesung: 'zu Beginn des Laufs',
      quelle: () => 'Konfiguration/asa.txt', zeilen: konfig('asa') },
    { id: 'clienta-mess', gruppe: 'bestaetigung', system: 'clienta', titel: 'Messprotokoll (ping, curl, traceroute)', typ: 'schnappschuss',
      befehl: 'ping -c 3 · curl -m 5 · traceroute -n', aufloesung: 'Messzeitpunkt',
      quelle: (sz) => sz.ordner + '/messprotokoll-clienta.txt', abschnitte: schnappschuss('messprotokoll-clienta.txt') },
    { id: 'hijacker-sudo', gruppe: 'bestaetigung', system: 'hijacker', titel: 'sudo-Auditprotokoll', typ: 'log', aufloesung: 'Sekunde',
      ansichten: [ansicht('log', 'journalctl -t sudo', sudo, 'journalctl -t sudo', '1_…/ und 2_…/sudo-audit-hijacker.log')] },
    { id: 'hijacker-pcap8', gruppe: 'bestaetigung', system: 'hijacker', titel: 'Paketmitschnitt enp0s8', typ: 'log', aufloesung: 'Mikrosekunde',
      ansichten: [ansicht('alle', 'alle Pakete', pakete.hijacker_enp0s8, 'tshark -n -r hijacker_enp0s8.pcap', R_ + 'hijacker_enp0s8.pcap')] },
    { id: 'hijacker-pcap10', gruppe: 'bestaetigung', system: 'hijacker', titel: 'Paketmitschnitt enp0s10', typ: 'log', aufloesung: 'Mikrosekunde',
      ansichten: [ansicht('alle', 'alle Pakete', pakete.hijacker_enp0s10, 'tshark -n -r hijacker_enp0s10.pcap', R_ + 'hijacker_enp0s10.pcap')] },
    { id: 'hijacker-konfig', gruppe: 'bestaetigung', system: 'hijacker', titel: 'Konfiguration', typ: 'statisch',
      befehl: 'vtysh -c "show running-config"', aufloesung: 'zu Beginn des Laufs',
      quelle: () => 'Konfiguration/hijacker.txt', zeilen: konfig('hijacker') },
    { id: 'webevil-log', gruppe: 'bestaetigung', system: 'webevil', titel: 'access.log', typ: 'log', aufloesung: 'Sekunde',
      ansichten: [ansicht('log', 'access.log', zugriffEvil, '/var/log/nginx/access.log', '1_…/ und 2_…/zugriffsprotokoll-webevil.log')] },
  ];
  const ARTEFAKT = {};
  ARTEFAKTE.forEach((a) => { ARTEFAKT[a.id] = a; });

  /* ---------------- Schritte je Szenario ---------------- */
  function gruppiere(zeiten) {
    // Ereignisse mit weniger als 10 ms Abstand bilden eine Gruppe.
    const s = zeiten.slice().sort((a, b) => a - b);
    const gruppen = [];
    s.forEach((t) => {
      const g = gruppen[gruppen.length - 1];
      if (g && t - g.bis <= 0.010) g.bis = t; else gruppen.push({ von: t, bis: t });
    });
    return gruppen;
  }

  function phasenende(szId, phase) {
    let bis = -Infinity;
    SCHNAPPSCHUSS_DATEIEN.forEach((d) => {
      abschnitte[szId][d].forEach((a) => { if (a.phase === phase) bis = Math.max(bis, a.tBis); });
    });
    return bis;
  }
  function phasenbeginn(szId, phase) {
    let von = Infinity;
    SCHNAPPSCHUSS_DATEIEN.forEach((d) => {
      abschnitte[szId][d].forEach((a) => { if (a.phase === phase) von = Math.min(von, a.tVon); });
    });
    return von;
  }

  function baueSchritte(szId) {
    const sz = SZENARIEN[szId];
    const texte = TEXTE[szId];
    const befehle = zeilen(sz.ordner + '/sudo-audit-hijacker.log');
    const schritte = [];
    const zustand = (phase) => {
      const [titel, text] = texte[phase];
      schritte.push({ phase, art: 'zustand', titel, text, cursor: phasenende(szId, phase), messungVon: phasenbeginn(szId, phase) });
    };
    const ereignisse = (phase, befehl) => {
      const sek = hms(befehl.slice(11, 19));
      const imFenster = (t) => t >= sek && t < sek + 1;
      const pakete = mitschnitt.eintraege.filter((p) => imFenster(p.t));
      const bmpRm = bmp.eintraege.filter((b) => b.art === 'RM' && imFenster(b.t));
      const gruppen = gruppiere(pakete.map((p) => p.t).concat(bmpRm.map((b) => b.t)));
      const tx = texte[phase];
      if (tx.length !== gruppen.length + 1) {
        console.warn('Szenario ' + szId + ' ' + phase + ': ' + gruppen.length + ' Ereignisgruppen, aber ' + (tx.length - 1) + ' Erläuterungen.');
      }
      schritte.push({
        phase, art: 'befehl', titel: tx[0][0], text: tx[0][1],
        cursor: gruppen.length ? gruppen[0].von - 0.001 : sek,
        zeitAnzeige: zeitText(sek, 0), befehl,
      });
      gruppen.forEach((g, i) => {
        const t = tx[i + 1] || ['Ereignisse auf der Leitung', ''];
        schritte.push({
          phase, art: 'ereignis', titel: t[0], text: t[1], cursor: g.bis,
          pakete: pakete.filter((p) => p.t >= g.von && p.t <= g.bis),
          bmp: bmpRm.filter((b) => b.t >= g.von && b.t <= g.bis),
        });
      });
    };
    zustand('T0');
    ereignisse('T1', befehle[0]);
    zustand('T2');
    ereignisse('T3', befehle[1]);
    zustand('T4');
    schritte.forEach((s, i) => { s.index = i; s.vorher = i ? schritte[i - 1].cursor : phasenbeginn(szId, 'T0') - 1; });
    return schritte;
  }
  SZENARIO_REIHE.forEach((id) => {
    const sz = SZENARIEN[id];
    sz.schritte = baueSchritte(id);
    sz.fensterBeginn = sz.schritte[0].vorher;
    sz.fensterEnde = sz.schritte[sz.schritte.length - 1].cursor;
  });

  /* ---------------- Zustaende fuer die Netzdarstellung ---------------- */
  // Best Path von rs fuer ein Praefix aus den Loc-RIB-Meldungen der BMP-Ausleitung.
  function bestPathRs(praefix, t) {
    let letzter = null;
    bmp.eintraege.forEach((b) => {
      if (b.art === 'RM' && b.sicht === 'Loc-RIB' && b.praefix === praefix && b.t <= t) letzter = b;
    });
    if (!letzter || letzter.ev === 'W') return { vorhanden: false, t: letzter ? letzter.t : null };
    return { vorhanden: true, pfad: letzter.pfad, nh: letzter.nh, t: letzter.t };
  }
  // Gesamtuebersicht der Loc-RIB von rs zu einer Abfrage in der Form von "show bgp ipv4 unicast".
  // Die Abfrage selbst (rib-aus-dem-ram.txt) fragt nur das Zielpraefix ab. Alle Pfade stammen
  // woertlich aus den Adj-RIB-In-Abfragen derselben Phase (adj-rib-in-rs.txt), der Best Path
  // aus der BMP-Ausleitung (Loc-RIB) zum Ende der Abfrage. Die Zeilen sind also rekonstruiert.
  function locRibUebersicht(szId, abschnitt) {
    const adj = abschnitte[szId]['adj-rib-in-rs.txt'].find((a) => a.phase === abschnitt.phase);
    if (!adj) return null;
    const pfade = new Map();   // praefix -> [{ nh, rest }]
    adj.zeilen.forEach((z) => {
      const m = /^ \*> (\d+\.\d+\.\d+\.\d+\/\d+)\s+(\d+\.\d+\.\d+\.\d+)\s/.exec(z);
      if (!m) return;
      if (!pfade.has(m[1])) pfade.set(m[1], []);
      pfade.get(m[1]).push({ nh: m[2], rest: z.slice(z.indexOf(m[2], 4 + m[1].length)) });
    });
    const zahl = (pfx) => pfx.split(/[./]/).reduce((n, x, i) => (i < 4 ? n * 256 + +x : n * 64 + +x), 0);
    const praefixe = Array.from(pfade.keys()).sort((x, y) => zahl(x) - zahl(y));
    const zeilenAus = ['     Network          Next Hop            Metric LocPrf Weight Path'];
    let anzahl = 0;
    praefixe.forEach((pfx) => {
      const bp = bestPathRs(pfx, abschnitt.tBis);
      const liste = pfade.get(pfx).slice().sort((x, y) => (bp.vorhanden ? (y.nh === bp.nh) - (x.nh === bp.nh) : 0));
      liste.forEach((p, i) => {
        const best = bp.vorhanden && p.nh === bp.nh;
        zeilenAus.push(' *' + (best ? '> ' : '  ') + (i === 0 ? pfx : '').padEnd(17) + p.rest);
        anzahl++;
      });
    });
    zeilenAus.push('', 'Displayed ' + praefixe.length + ' routes and ' + anzahl + ' total paths');
    return {
      zeilen: zeilenAus,
      quelle: 'Pfade: Adj-RIB-In ' + adj.phase + ' (' + zeitText(adj.tVon, 0) + '–' + zeitText(adj.tBis, 0)
        + ' UTC) · Best Path: BMP Loc-RIB bis ' + zeitText(abschnitt.tBis, 0) + ' UTC',
    };
  }
  // Letzte Messung der Routing-Tabelle (show ip route 198.51.100.10) bis t.
  function routingEintrag(szId, vm, t) {
    const liste = abschnitte[szId]['routing-tabelle-' + vm + '.txt'].filter((a) => a.tBis <= t);
    const a = liste[liste.length - 1];
    if (!a) return null;
    const eintrag = a.zeilen.map((z) => /^Routing entry for (\S+)/.exec(z)).find(Boolean);
    const weg = a.zeilen.map((z) => /^\s+\* (.+?), (?:via )?(\S+?)(?:, weight.*)?$/.exec(z)).find(Boolean);
    return { phase: a.phase, praefix: eintrag ? eintrag[1] : '?', nh: weg ? weg[1] : '?', schnittstelle: weg ? weg[2] : '' };
  }
  // Letzte Messung von clienta bis t: HTTP-Ergebnis und zweiter Hop.
  function messungClienta(szId, t) {
    const liste = abschnitte[szId]['messprotokoll-clienta.txt'].filter((a) => a.tBis <= t);
    const a = liste[liste.length - 1];
    if (!a) return null;
    const httpZeile = a.zeilen.find((z) => /^HTTP \d+/.test(z)) || '';
    const hop2 = (a.zeilen.map((z) => /^\s*2\s+(\S+)/.exec(z)).find(Boolean) || [])[1] || '';
    const seite = a.zeilen.find((z) => /^<h1>/.test(z)) || '';
    const ping = a.zeilen.find((z) => /packets transmitted/.test(z)) || '';
    return { phase: a.phase, http: httpZeile, hop2, seite: seite.replace(/<\/?h1>/g, ''), ping, tBis: a.tBis };
  }

  App.modell = {
    MITTERNACHT, IP_SYSTEM, SZENARIEN, SZENARIO_REIHE, PHASEN, PHASEN_REIHE,
    ARTEFAKTE, ARTEFAKT, zeitText, bestPathRs, routingEintrag, messungClienta,
    rohdatei: (pfad) => R[pfad],
  };
})(window.App);
