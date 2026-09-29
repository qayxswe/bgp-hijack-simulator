/* ===========================================================================
   Artefakt-Ansicht (rechte Seitenleiste): Auswahl der in der Arbeit genannten
   Artefakte und deren Stand zum aktuellen Schritt.

   - Protokolle (log): alle Zeilen bis zum aktuellen Zeitpunkt; Zeilen, die in
     diesem Schritt hinzukommen, sind hervorgehoben, Zeilen vor Beginn des
     Szenarios abgeblendet (der Lauf ist durchgehend, die Dateien auch).
   - Abfragen (schnappschuss): die letzte Abfrage zu T0/T2/T4 bis zum
     aktuellen Zeitpunkt; fruehere Abfragen lassen sich umschalten.
   - rib.mrt (tabellendump): Stand des letzten Dumps zur vollen Minute.
   - "Nur Neues" zeigt statt der Auswahl alle Artefakte mit neuen Zeilen im
     aktuellen Schritt; in der Auswahl sind diese mit einem Punkt markiert.
   =========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const M = App.modell;

  const GROESSER_SVG = '<svg viewBox="0 0 16 16"><path d="M3 5.5l5 4 5-4M3 9.5l5 4 5-4"/></svg>';

  const SPEICHER = 'bgp-sim-auswahl';
  const SPEICHER_NEU = 'bgp-sim-nur-neue';
  // rs-adj zeigt je Nachbar auch Praefixe ausserhalb des Angriffs (z. B. Bobs eigenes
  // 198.51.96.0/20 mit den Rueckmeldungen von asa und hijacker) -- das war vorher nur
  // ueber den inzwischen entfernten Abfrage-Knopf "Beginn" bei rs-bgp sichtbar.
  // rs-locrib zeigt zusaetzlich den Best Path jedes Praefixes durchgehend (auch T0, wo
  // rs-bgp fuer das noch nicht existierende Angriffspraefix leer bleibt).
  const VORGABE = ['rs-mrt', 'rs-journal', 'rs-pcap', 'rs-bmp', 'rs-bgp', 'rs-adj', 'rs-locrib'];
  const SYSTEM_ROLLE = { rs: 'rs', asa: 'isp', clienta: 'isp', asb: 'bob', weblegit: 'bob', hijacker: 'eve', webevil: 'eve' };

  let wahlEl, listeEl, zaehlerEl, nurNeueEl;
  let vollbildEl, vollbildTitelEl, vollbildInhaltEl;
  let auswahl = new Set(VORGABE);
  let besteId = null, besteGrund = '';
  let neuIds = new Set();           // Artefakte mit neuen Zeilen im aktuellen Schritt
  let nurNeue = false;              // Anzeige auf Artefakte mit neuen Zeilen beschraenkt, statt Auswahl
  let vollbildId = null;            // Artefakt, das gerade ganzflaechig gezeigt wird
  let vollbildMitNetz = false;      // Netzplan im ganzflaechigen Fenster daneben/darueber
  let netzHeimat = null;            // urspruenglicher Platz von .netz-wrap in der Buehne
  let fokusId = null;               // Nebeneinander: nur dieses Artefakt, volle Hoehe neben dem Netzplan
  const gewaehlteAnsicht = {};      // artefaktId -> Ansicht (bleibt ueber die Schritte erhalten)
  const gewaehlterAbschnitt = {};   // artefaktId -> Phase (manuelle Auswahl bis zum naechsten Schritt)
  const ausgeklappt = new Set();    // artefaktId -> Inhalt gross statt in fester Fensterhoehe
  let letzterSchluessel = null;
  let aktSz = null, aktSchritt = null;

  function laden() {
    try {
      const s = JSON.parse(localStorage.getItem(SPEICHER) || 'null');
      if (Array.isArray(s)) auswahl = new Set(s.filter((id) => M.ARTEFAKT[id]));
      nurNeue = localStorage.getItem(SPEICHER_NEU) === '1';
    } catch (e) { /* Vorgabe behalten */ }
  }
  function speichern() {
    try {
      localStorage.setItem(SPEICHER, JSON.stringify(Array.from(auswahl)));
      localStorage.setItem(SPEICHER_NEU, nurNeue ? '1' : '0');
    } catch (e) { /* egal */ }
  }

  function init(elWahl, elListe, elZaehler, elNurNeue) {
    wahlEl = elWahl; listeEl = elListe; zaehlerEl = elZaehler; nurNeueEl = elNurNeue;
    vollbildEl = document.getElementById('vollbild');
    vollbildTitelEl = document.getElementById('vollbildTitel');
    vollbildInhaltEl = document.getElementById('vollbildInhalt');
    laden();
    if (nurNeueEl) nurNeueEl.addEventListener('click', () => { nurNeue = !nurNeue; nachAuswahl(); listeEl.scrollTop = 0; });
    document.getElementById('vollbildZu').addEventListener('click', vollbildSchliessen);
    document.getElementById('vollbildNetzKnopf').addEventListener('click', () => vollbildNetz(!vollbildMitNetz));
    try { vollbildMitNetz = localStorage.getItem('bgp-sim-vollbild-netz') === '1'; } catch (e) { /* egal */ }
    vollbildTrennerInit();
    if (window.ResizeObserver) new ResizeObserver(vollbildAusrichten).observe(document.getElementById('vollbildKarte'));
    document.addEventListener('keydown', (e) => {
      if (!vollbildId || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); vollbildNetz(!vollbildMitNetz); }
    });
    vollbildEl.addEventListener('click', (e) => { if (e.target === vollbildEl) vollbildSchliessen(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (vollbildId) vollbildSchliessen(); else if (fokusId) fokus(null);   // zuerst das oberste schliessen
    });
    machGroesseAenderbar(document.getElementById('vollbildKarte'), document.getElementById('vollbildGroesse'));
    // Vorbelegung ueber die Adresse, etwa index.html?a=rs-rib-mrt,asb-bgp#s2-6
    const a = new URLSearchParams(location.search).get('a');
    if (a) auswahl = new Set(a.split(',').filter((id) => M.ARTEFAKT[id]));
    wahlAufbauen();
  }

  /* ---------------- Nebeneinander ----------------
     Ein einzelnes Artefakt ueber die volle Hoehe der Seitenleiste neben dem Netzplan. Beim
     Einschalten erhaelt die Seitenleiste die halbe Breite, sofern sie nicht schon von Hand
     (Trenner) eingestellt ist. */
  function fokus(id) {
    fokusId = id && M.ARTEFAKT[id] ? id : null;
    document.body.classList.toggle('fokus', !!fokusId);
    if (fokusId && App.layout && !App.layout.istFrei()) {
      App.layout.leisteBreite(document.querySelector('main').clientWidth / 2);
    }
    if (aktSz) zeichnen(aktSz, aktSchritt, true);
  }

  /* ---------------- Ganzflaechige Ansicht ----------------
     Oeffnet sich beim Klick in den Inhalt eines Artefakts; bleibt beim Schrittwechsel offen
     und aktualisiert sich mit (siehe Ende von zeichnen()), solange das Artefakt weiter
     ausgewaehlt ist -- sonst schliesst sie sich von selbst. */
  // neuerSchritt: nach einem Schrittwechsel zur ersten neuen Zeile springen (wie in der Karte),
  // sonst die Scrollposition behalten (z. B. beim Umschalten einer Ansicht).
  function vollbildOeffnen(id, titel, html, neuerSchritt) {
    const warOffen = !!vollbildId;
    const alt = vollbildInhaltEl.scrollTop;
    vollbildId = id;
    vollbildTitelEl.textContent = titel;
    vollbildInhaltEl.innerHTML = html;
    if (warOffen && !neuerSchritt) vollbildInhaltEl.scrollTop = alt;
    else {
      const erstes = vollbildInhaltEl.querySelector('.z-neu');
      vollbildInhaltEl.scrollTop = erstes ? Math.max(0, erstes.offsetTop - vollbildInhaltEl.offsetTop - 40) : 0;
    }
    vollbildEl.classList.remove('versteckt');
    if (!warOffen) vollbildNetz(vollbildMitNetz, true);
  }
  function vollbildSchliessen() {
    vollbildId = null;
    netzZurueck();
    vollbildEl.classList.add('versteckt');
  }

  // Netzplan im ganzflaechigen Fenster: das echte .netz-wrap wird hineingehaengt (bleibt so
  // live: Animation, Schrittwechsel, Klick auf Systeme) und beim Ausschalten/Schliessen an
  // seinen Platz in der Buehne zurueckgestellt.
  function vollbildNetz(an, ohneMerken) {
    vollbildMitNetz = !!an;
    if (!ohneMerken) try { localStorage.setItem('bgp-sim-vollbild-netz', vollbildMitNetz ? '1' : '0'); } catch (e) { /* egal */ }
    const knopf = document.getElementById('vollbildNetzKnopf');
    knopf.classList.toggle('an', vollbildMitNetz);
    knopf.setAttribute('aria-pressed', String(vollbildMitNetz));
    vollbildEl.classList.toggle('mit-netz', vollbildMitNetz);
    if (vollbildMitNetz && vollbildId) {
      const wrap = document.querySelector('.netz-wrap');
      if (!netzHeimat) netzHeimat = { eltern: wrap.parentNode, danach: wrap.nextSibling };
      document.getElementById('vollbildNetz').appendChild(wrap);
      vollbildAusrichten();
    } else {
      netzZurueck();
    }
  }
  function netzZurueck() {
    if (!netzHeimat) return;
    netzHeimat.eltern.insertBefore(document.querySelector('.netz-wrap'), netzHeimat.danach);
    netzHeimat = null;
  }
  // Breites Fenster: Netzplan links daneben; hohes Fenster: Netzplan darueber.
  function vollbildAusrichten() {
    const karte = document.getElementById('vollbildKarte');
    const r = karte.getBoundingClientRect();
    if (!r.width) return;
    document.getElementById('vollbildKoerper').classList.toggle('stapel', r.width / r.height < 1.25);
  }
  function vollbildTrennerInit() {
    const t = document.getElementById('vollbildTrenner');
    const koerper = document.getElementById('vollbildKoerper');
    t.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { t.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
      t.classList.add('zieht');
      const r = koerper.getBoundingClientRect();
      const stapel = koerper.classList.contains('stapel');
      const bewegen = (ev) => {
        const anteil = stapel ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
        koerper.style.setProperty('--vb-netz', Math.round(Math.min(0.8, Math.max(0.2, anteil)) * 1000) / 10 + '%');
      };
      const ende = () => {
        t.classList.remove('zieht');
        t.removeEventListener('pointermove', bewegen);
        t.removeEventListener('pointerup', ende);
        t.removeEventListener('pointercancel', ende);
      };
      t.addEventListener('pointermove', bewegen);
      t.addEventListener('pointerup', ende);
      t.addEventListener('pointercancel', ende);
    });
  }
  // Groesse per Griff unten rechts per Pointer-Events ziehen (statt natives CSS resize, das
  // sich in dieser Testumgebung nicht per Skript ausloesen liesse und weniger Kontrolle gibt).
  function machGroesseAenderbar(karte, griff) {
    let sx = 0, sy = 0, sw = 0, sh = 0, ziehen = false;
    griff.addEventListener('pointerdown', (ev) => {
      ziehen = true;
      const r = karte.getBoundingClientRect();
      sx = ev.clientX; sy = ev.clientY; sw = r.width; sh = r.height;
      karte.style.maxWidth = 'none';
      karte.style.width = sw + 'px'; karte.style.height = sh + 'px';
      try { griff.setPointerCapture(ev.pointerId); } catch (e) { /* egal, z. B. synthetische Events */ }
      ev.stopPropagation();
    });
    griff.addEventListener('pointermove', (ev) => {
      if (!ziehen) return;
      const eltern = karte.parentElement.getBoundingClientRect();
      const w = Math.max(480, Math.min(sw + (ev.clientX - sx), eltern.width - 8));
      const h = Math.max(320, Math.min(sh + (ev.clientY - sy), eltern.height - 8));
      karte.style.width = w + 'px'; karte.style.height = h + 'px';
    });
    griff.addEventListener('pointerup', (ev) => { ziehen = false; try { griff.releasePointerCapture(ev.pointerId); } catch (e) { /* egal */ } });
  }

  /* ---------------- Auswahl ---------------- */
  function wahlAufbauen() {
    const gruppen = [
      ['rs', 'Rekonstruktion · Artefakte des Route-Servers'],
      ['bestaetigung', 'Bestätigung · weitere Quellen'],
    ];
    wahlEl.innerHTML = '';
    gruppen.forEach(([g, titel]) => {
      const box = document.createElement('div');
      box.className = 'wahl-gruppe';
      box.innerHTML = `<div class="wahl-kopf"><span>${titel}</span>
        <button class="wahl-alle" data-g="${g}">alle</button><button class="wahl-keine" data-g="${g}">keine</button></div>`;
      const chips = document.createElement('div');
      chips.className = 'wahl-chips';
      M.ARTEFAKTE.filter((a) => a.gruppe === g).forEach((a) => {
        const b = document.createElement('button');
        b.className = 'chip rolle-' + SYSTEM_ROLLE[a.system];
        b.dataset.id = a.id;
        b.innerHTML = `<span class="chip-sys">${a.system}</span><span>${kurztitel(a)}</span>`;
        b.title = a.titel;
        b.addEventListener('click', () => { umschalten(a.id); });
        chips.appendChild(b);
      });
      box.appendChild(chips);
      wahlEl.appendChild(box);
    });
    wahlEl.querySelectorAll('.wahl-alle').forEach((b) => b.addEventListener('click', () => {
      M.ARTEFAKTE.filter((a) => a.gruppe === b.dataset.g).forEach((a) => auswahl.add(a.id)); nurNeue = false; nachAuswahl();
    }));
    wahlEl.querySelectorAll('.wahl-keine').forEach((b) => b.addEventListener('click', () => {
      M.ARTEFAKTE.filter((a) => a.gruppe === b.dataset.g).forEach((a) => auswahl.delete(a.id)); nurNeue = false; nachAuswahl();
    }));
    chipsAktualisieren();
  }
  function kurztitel(a) {
    return a.titel.replace('RIBs im RAM · ', 'RAM: ').replace(' · updates.mrt', '').replace(' · rib.mrt', '')
      .replace(' · journalctl -u frr', '').replace(' · rs_enp0s8.pcap', '').replace(' · rs_lo.pcap', '')
      .replace(' je Nachbar', '').replace(' (Sitzung zu rs)', '').replace(' (ping, curl, traceroute)', '')
      .replace('Paketmitschnitt enp0s', 'Mitschnitt enp0s');
  }
  function chipsAktualisieren() {
    wahlEl.querySelectorAll('.chip').forEach((b) => {
      b.classList.toggle('an', auswahl.has(b.dataset.id));
      b.classList.toggle('beste', b.dataset.id === besteId);
      b.classList.toggle('neu', neuIds.has(b.dataset.id));
      b.title = M.ARTEFAKT[b.dataset.id].titel + (neuIds.has(b.dataset.id) ? ' · neue Zeilen in diesem Schritt' : '');
    });
    if (nurNeueEl) {
      nurNeueEl.classList.toggle('an', nurNeue);
      nurNeueEl.setAttribute('aria-pressed', String(nurNeue));
      nurNeueEl.textContent = 'Nur Neues' + (aktSz ? ' (' + neuIds.size + ')' : '');
    }
  }

  // Je Schritt das aussagekraeftigste Artefakt: beim Befehl die einzige Quelle dafuer,
  // bei einem Ereignis der Mitschnitt bzw. -- wenn sich dabei der Best Path aendert -- die
  // BMP-Ausleitung, bei einem Zustand das Messpunkt-Artefakt der Route-Server-Rekonstruktion
  // (Kapitel 8, Gruppe "rs"), das genau die zu diesem Zeitpunkt abgefragte BGP-Tabelle zeigt.
  function bestesArtefakt(schritt) {
    if (schritt.art === 'befehl') return { id: 'hijacker-sudo', grund: 'einzige Quelle für den Befehl' };
    if (schritt.art === 'ereignis') {
      return schritt.bmp.some((b) => b.sicht === 'Loc-RIB')
        ? { id: 'rs-bmp', grund: 'zeigt die Best-Path-Entscheidung' }
        : { id: 'rs-pcap', grund: 'zeigt das Ereignis auf der Leitung' };
    }
    return { id: 'rs-bgp', grund: 'Messpunkt-Artefakt (Kapitel 8)' };
  }
  function umschalten(id) {
    if (auswahl.has(id)) auswahl.delete(id); else auswahl.add(id);
    nurNeue = false;   // manuelle Auswahl geht vor "Nur Neues"
    nachAuswahl();
  }
  function nachAuswahl() {
    speichern(); chipsAktualisieren();
    if (aktSz) zeichnen(aktSz, aktSchritt, true);
  }
  function waehleSystem(sys) {
    auswahl = new Set(M.ARTEFAKTE.filter((a) => a.system === sys).map((a) => a.id));
    nurNeue = false;                       // Klick im Netzplan will genau dieses System sehen
    fokusId = null; document.body.classList.remove('fokus');
    nachAuswahl();
    listeEl.scrollTop = 0;
  }

  /* ---------------- Anzeige ---------------- */
  function zeichnen(sz, schritt, erzwingen) {
    const schluessel = sz.id + ':' + schritt.index;
    const neuerSchritt = schluessel !== letzterSchluessel;
    if (!neuerSchritt && !erzwingen) return;       // bei laufender Animation nicht neu aufbauen
    if (neuerSchritt) Object.keys(gewaehlterAbschnitt).forEach((k) => delete gewaehlterAbschnitt[k]);
    letzterSchluessel = schluessel;
    aktSz = sz; aktSchritt = schritt;
    const beste = bestesArtefakt(schritt);
    besteId = beste.id; besteGrund = beste.grund;
    neuIds = new Set(M.ARTEFAKTE.filter((a) => neuAnzahl(a, sz, schritt) > 0).map((a) => a.id));
    chipsAktualisieren();

    const alteScroll = {};
    if (!neuerSchritt) listeEl.querySelectorAll('.art-karte').forEach((k) => {
      const inh = k.querySelector('.art-inhalt'); if (inh) alteScroll[k.dataset.id] = inh.scrollTop;
    });
    listeEl.innerHTML = '';
    const gewaehlt = fokusId ? [M.ARTEFAKT[fokusId]]
      : M.ARTEFAKTE.filter((a) => (nurNeue ? neuIds.has(a.id) : auswahl.has(a.id)));
    if (!gewaehlt.length) {
      listeEl.innerHTML = nurNeue
        ? '<div class="leer-hinweis">Kein Artefakt hat in diesem Schritt neue Zeilen.</div>'
        : '<div class="leer-hinweis">Keine Artefakte gewählt.</div>';
    }
    let neuGesamt = 0;
    gewaehlt.forEach((a) => {
      const karte = document.createElement('div');
      karte.className = 'art-karte rolle-' + SYSTEM_ROLLE[a.system] + (a.id === besteId ? ' beste' : '');
      karte.dataset.id = a.id;
      const erg = a.typ === 'log' ? logInhalt(a, sz, schritt)
        : a.typ === 'schnappschuss' ? schnappschussInhalt(a, sz, schritt)
          : a.typ === 'statisch' ? statischInhalt(a)
            : a.typ === 'rekonstruktion' ? rekonstruktionInhalt(a, schritt)
              : dumpInhalt(a, sz, schritt);
      const befehl = erg.befehl || a.befehl;
      const quelle = erg.quelle || a.quelle(sz);
      neuGesamt += erg.neu;
      karte.classList.toggle('hat-neues', erg.neu > 0);
      const gross = ausgeklappt.has(a.id);
      karte.innerHTML = `
        <div class="art-kopf">
          <span class="art-sys">${a.system}</span>
          <span class="art-titel">${a.titel}</span>
          ${a.id === besteId ? `<span class="art-best" title="Wichtigstes Artefakt für diesen Schritt: ${esc(besteGrund)}">zentral</span>` : ''}
          ${erg.neu > 0 ? `<span class="art-neu">+${erg.neu} neu</span>` : ''}
          <button class="art-gross${gross ? ' auf' : ''}" title="${gross ? 'Fenster verkleinern' : 'Fenster ausklappen'}">${GROESSER_SVG}</button>
          <button class="art-fokus" title="${fokusId ? 'Zurück zur Artefaktliste (Esc)' : 'Nebeneinander: allein neben dem Netzplan anzeigen'}">⧉</button>
          ${nurNeue || fokusId ? '' : '<button class="art-weg" title="ausblenden">×</button>'}
        </div>
        <div class="art-meta">
          <span class="art-befehl">${esc(befehl)}</span>
          <span class="art-tag" title="Zeitauflösung">${a.aufloesung}</span>
        </div>
        ${erg.leiste || ''}
        <div class="art-inhalt${gross ? ' voll' : ''}">${erg.html}</div>
        <div class="art-fuss"><span>${erg.fuss}</span><span class="art-quelle" title="Datei in den Primärdaten">Primaerdaten/${esc(quelle)}</span></div>`;
      karte.querySelector('.art-fokus').addEventListener('click', () => fokus(fokusId ? null : a.id));
      const weg = karte.querySelector('.art-weg');
      if (weg) weg.addEventListener('click', () => umschalten(a.id));
      karte.querySelector('.art-gross').addEventListener('click', () => {
        if (ausgeklappt.has(a.id)) ausgeklappt.delete(a.id); else ausgeklappt.add(a.id);
        zeichnen(aktSz, aktSchritt, true);
      });
      karte.querySelectorAll('[data-phase]').forEach((b) => b.addEventListener('click', () => {
        gewaehlterAbschnitt[a.id] = b.dataset.phase; zeichnen(aktSz, aktSchritt, true);
      }));
      const wahl = karte.querySelector('.ansicht-wahl');
      if (wahl) wahl.addEventListener('change', (e) => { gewaehlteAnsicht[a.id] = e.target.value; zeichnen(aktSz, aktSchritt, true); });
      listeEl.appendChild(karte);
      const inh = karte.querySelector('.art-inhalt');
      inh.title = 'Klicken: ganzflächig öffnen';
      inh.addEventListener('click', () => {
        if (window.getSelection && String(window.getSelection())) return;   // Textauswahl nicht als Klick werten
        vollbildOeffnen(a.id, a.system + ' · ' + a.titel, erg.html);
      });
      if (!neuerSchritt && alteScroll[a.id] != null) inh.scrollTop = alteScroll[a.id];
      else {
        // Protokolle: zur ersten neuen Zeile, sonst ans Ende (juengste Zeilen).
        // Abfragen und Dumps: an den Anfang, dort steht der Kopf der Ausgabe.
        const erstes = inh.querySelector('.z-neu');
        if (a.typ !== 'log') inh.scrollTop = 0;
        else if (erstes) inh.scrollTop = Math.max(0, erstes.offsetTop - inh.offsetTop - 24);
        else inh.scrollTop = inh.scrollHeight;
      }
      // Ganzflaechige Ansicht bleibt beim Schrittwechsel offen und zieht mit.
      if (vollbildId === a.id) vollbildOeffnen(a.id, a.system + ' · ' + a.titel, erg.html, neuerSchritt);
    });
    if (vollbildId && !gewaehlt.some((a) => a.id === vollbildId)) vollbildSchliessen();
    if (fokusId) zaehlerEl.textContent = '';
    else zaehlerEl.textContent = (nurNeue ? gewaehlt.length + ' mit Neuem' : gewaehlt.length + ' gewählt')
      + (neuGesamt ? ' · ' + neuGesamt + ' neue Einträge' : '');
  }

  /* ---------------- Zeitfenster eines Schritts ----------------
     Diese drei Hilfsfunktionen entscheiden je Artefakttyp, was "neu in diesem Schritt"
     bedeutet. Sowohl neuAnzahl() (fuer die Chip-Punkte und "Nur Neues", ohne HTML
     aufzubauen) als auch die *Inhalt-Funktionen darunter nutzen sie -- beide Seiten
     koennen dadurch nicht mehr auseinanderlaufen. */
  function logFenster(v, schritt) {
    const eintraege = v.eintraege.filter((e) => e.t <= schritt.cursor)
      .slice().sort((x, y) => (x.t - y.t) || (x.nr - y.nr));   // stabil: Zeit, dann Zeilennummer
    const neu = eintraege.reduce((n, e) => n + (e.t > schritt.vorher ? 1 : 0), 0);
    return { eintraege, neu };
  }
  function schnappschussFenster(alle, schritt) {
    const verfuegbar = alle.filter((x) => x.tBis <= schritt.cursor);
    if (!verfuegbar.length) return null;
    const juengste = verfuegbar[verfuegbar.length - 1];
    return { verfuegbar, juengste, neu: juengste.tBis > schritt.vorher };
  }
  const DUMP_ERSTER = 18 * 3600 + 45 * 60;   // erster Dump nach dem Neustart um 18:44:47
  function dumpFenster(a, schritt) {
    const letzter = Math.floor(schritt.cursor / 60) * 60;
    return { letzter, neu: letzter >= DUMP_ERSTER && letzter > schritt.vorher && letzter === a.dump.t };
  }

  // Anzahl neuer Eintraege eines Artefakts im Schritt, ohne den Inhalt aufzubauen
  // (fuer die Chip-Punkte in der Auswahl und "Nur Neues").
  function neuAnzahl(a, sz, schritt) {
    if (a.typ === 'log') {
      const v = a.ansichten.find((x) => x.id === gewaehlteAnsicht[a.id]) || a.ansichten[0];
      return logFenster(v, schritt).neu;
    }
    if (a.typ === 'schnappschuss') {
      const fenster = schnappschussFenster(a.abschnitte(sz.id), schritt);
      return fenster && fenster.neu ? 1 : 0;
    }
    if (a.typ === 'tabellendump') return dumpFenster(a, schritt).neu ? 1 : 0;
    if (a.typ === 'rekonstruktion') return rekonstruktionInhalt(a, schritt).neu;   // nur 3 Praefixe, billig
    return 0;
  }

  function logInhalt(a, sz, schritt) {
    const v = a.ansichten.find((x) => x.id === gewaehlteAnsicht[a.id]) || a.ansichten[0];
    const { eintraege, neu } = logFenster(v, schritt);
    let leiste = '';
    if (a.ansichten.length > 1) {
      leiste = `<div class="art-leiste"><select class="ansicht-wahl">${a.ansichten.map((x) =>
        `<option value="${x.id}"${x === v ? ' selected' : ''}>${x.name}</option>`).join('')}</select></div>`;
    }
    const html = (v.kopf.length ? `<div class="z z-kopf">${esc(v.kopf[0])}</div>` : '')
      + (eintraege.length ? eintraege.map((e) => {
        const istNeu = e.t > schritt.vorher;
        const klasse = istNeu ? 'z z-neu' : (e.t < sz.fensterBeginn ? 'z z-alt' : 'z');
        const gutter = a.mrtZeit ? `<span class="z-gutter" title="Zeitstempel der Zeile (Unixzeit ${e.text.split('|')[1]})">${e.eigeneZeit}</span>` : '';
        return `<div class="${klasse}">${gutter}${App.faerbe(e.text)}</div>`;
      }).join('') : '<div class="z-leer">noch keine Einträge</div>');
    const fuss = eintraege.length + ' Zeile' + (eintraege.length === 1 ? '' : 'n') + (neu ? ' · ' + neu + ' neu in diesem Schritt' : ' · keine neuen in diesem Schritt');
    return { html, neu, fuss, leiste, befehl: v.befehl, quelle: v.quelle };
  }

  function statischInhalt(a) {
    return { html: a.zeilen.map((z) => `<div class="z">${App.faerbe(z)}</div>`).join(''), neu: 0,
      fuss: a.zeilen.length + ' Zeilen' };
  }

  // Keine echte Geraeteausgabe: eine Zeile je bekanntem Praefix, hergeleitet aus rs' Best
  // Path (BMP Loc-RIB) -- bei asa/asb zusaetzlich mit der Regel, dass das eigene Praefix
  // lokal immer die selbst erzeugte Route ist. "Neu" heisst hier: der Pfad hat sich in
  // diesem Schritt tatsaechlich geaendert (nicht: die Zeile steht schon laenger da).
  function rekonstruktionInhalt(a, schritt) {
    let neu = 0;
    const zeilen = M.locRibPraefixe.map((pfx) => {
      const b = a.system === 'rs' ? Object.assign({ eigen: false }, M.bestPathRs(pfx, schritt.cursor)) : M.lokaleLocRib(a.system, pfx, schritt.cursor);
      const istNeu = !b.eigen && b.vorhanden && b.t != null && b.t > schritt.vorher;
      if (istNeu) neu++;
      const text = pfx.padEnd(17) + ' ' + (!b.vorhanden ? '—' : b.eigen ? b.pfad : 'Pfad ' + b.pfad + ' · NH ' + b.nh);
      return `<div class="z${istNeu ? ' z-neu' : ''}">${App.faerbe(text)}</div>`;
    });
    return { html: zeilen.join(''), neu, fuss: M.locRibPraefixe.length + ' Präfixe · Stand ' + M.zeitText(schritt.cursor, 3) + ' UTC' };
  }

  function schnappschussInhalt(a, sz, schritt) {
    const alle = a.abschnitte(sz.id);
    const fenster = schnappschussFenster(alle, schritt);
    const leiste = `<div class="art-leiste">Abfrage:
      ${alle.map((x) => {
        const ok = x.tBis <= schritt.cursor;
        const aktiv = ok && ((gewaehlterAbschnitt[a.id] || (fenster ? fenster.juengste.phase : '')) === x.phase);
        return `<button class="phase-knopf${aktiv ? ' aktiv' : ''}"${ok ? ` data-phase="${x.phase}"` : ' disabled'} title="${ok ? 'Abfrage ' + x.phase + ', ' + M.zeitText(x.tVon, 3) + '–' + M.zeitText(x.tBis, 3) + ' UTC' : 'Abfrage ' + x.phase + ', ' + M.zeitText(x.tVon, 3) + ' UTC'}">${x.phase}</button>`;
      }).join('')}</div>`;
    if (!fenster) {
      return { html: '<div class="z-leer">noch keine Abfrage</div>', neu: 0, fuss: 'keine Abfrage bis zu diesem Zeitpunkt', leiste };
    }
    const wahl = fenster.verfuegbar.find((x) => x.phase === gewaehlterAbschnitt[a.id]) || fenster.juengste;
    const istNeu = wahl.tBis > schritt.vorher;
    const html = wahl.zeilen.map((z) => `<div class="z${istNeu ? ' z-neu' : ''}">${App.faerbe(z) || '&nbsp;'}</div>`).join('');
    let fuss = 'Abfrage ' + wahl.phase + ', ' + M.zeitText(wahl.tVon, 3) + '–' + M.zeitText(wahl.tBis, 3) + ' UTC';
    if (wahl !== fenster.juengste) fuss += ' · nicht die jüngste Abfrage';
    return { html, neu: istNeu ? 1 : 0, fuss, leiste };
  }

  function dumpInhalt(a, sz, schritt) {
    const { letzter, neu } = dumpFenster(a, schritt);
    const naechster = letzter + 60;
    if (letzter < DUMP_ERSTER) {
      return { html: '<div class="z-leer">noch kein Dump</div>', neu: 0, fuss: 'nächster Dump ' + M.zeitText(DUMP_ERSTER, 0) };
    }
    const erhalten = a.dump.t;
    if (letzter === erhalten) {
      const html = a.dump.zeilen.map((z) => `<div class="z${neu ? ' z-neu' : ''}">${App.faerbe(z)}</div>`).join('');
      return { html, neu: neu ? 1 : 0, fuss: 'Stand ' + M.zeitText(letzter, 0) + ' UTC · nächster Dump ' + M.zeitText(naechster, 0) };
    }
    const html = `<div class="z-leer">Dump ${M.zeitText(letzter, 0)} UTC nicht erhalten (erhalten: ${M.zeitText(erhalten, 0)} UTC)</div>`;
    return { html, neu: 0, fuss: 'Stand ' + M.zeitText(letzter, 0) + ' UTC (nicht erhalten) · nächster Dump ' + M.zeitText(naechster, 0) };
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  /* ---------------- Syntaxfarben ---------------- */
  App.faerbe = function (str) {
    let s = esc(str);
    const halte = [];
    const merke = (html) => '\u0000' + (halte.push(html) - 1) + '\u0000';
    s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}\b/g, (m) => merke(`<span class="sx-praefix">${m}</span>`));
    s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, (m) => merke(`<span class="sx-ip">${m}</span>`));
    s = s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:\+\d{2}:\d{2})?|\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, (m) => merke(`<span class="sx-zeit">${m}</span>`));
    s = s.replace(/\b(?:64496|64499|64500|64511)\b/g, (m) => merke(`<span class="sx-as">${m}</span>`));
    s = s.replace(/\bBGP4MP\b|\bTABLE_DUMP2\b|\bLoc-RIB\b|\bAdj (?:post|pre)\b|\brcvd\b|\bsend UPDATE\b|\bwithdrawn\b|\bunreachable\b|\bbest\b(?: \([^)]*\))?|\bRouting entry for\b|\bHTTP \d{3}\b|\bGET\b/g,
      (m) => merke(`<span class="sx-schluessel">${m}</span>`));
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => halte[i]);
  };

  App.artefakte = { init, zeichnen, waehleSystem, fokus };
})(window.App);
