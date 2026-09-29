/* ===========================================================================
   Verdrahtung: Szenario-Reiter, Netzplan, Artefakte, Wiedergabe.
   =========================================================================== */
window.App = window.App || {};

(function (App) {
  'use strict';
  const M = App.modell;

  function reiterAufbauen() {
    const wrap = document.getElementById('szenarioReiter');
    wrap.innerHTML = '';
    M.SZENARIO_REIHE.forEach((id) => {
      const sz = M.SZENARIEN[id];
      const b = document.createElement('button');
      b.dataset.id = id;
      b.title = sz.kurz;
      b.innerHTML = `<span class="tag">Szenario ${sz.nr} · ${sz.praefix}</span><span class="name">${sz.name}</span>`;
      b.addEventListener('click', () => { App.steuerung.wechsleSzenario(id); reiterMarkieren(); });
      wrap.appendChild(b);
    });
    reiterMarkieren();
  }
  function reiterMarkieren() {
    const id = App.steuerung.szenario();
    document.querySelectorAll('#szenarioReiter button').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
  }

  /* ---------------- Design: hell/dunkel ----------------
     Ohne gespeicherte Wahl folgt die Seite der Systemeinstellung (CSS allein).
     Ein Klick setzt data-theme fest und merkt sich das in localStorage. */
  const THEMA_SPEICHER = 'bgp-sim-thema';
  function themaAnwenden(wert) {
    if (wert) document.documentElement.setAttribute('data-theme', wert);
    else document.documentElement.removeAttribute('data-theme');
  }
  function themaInit() {
    let gespeichert = null;
    try { gespeichert = localStorage.getItem(THEMA_SPEICHER); } catch (e) { /* egal */ }
    themaAnwenden(gespeichert);
    document.getElementById('themaUmschalten').addEventListener('click', () => {
      const system = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      const aktuell = document.documentElement.getAttribute('data-theme') || system;
      const neu = aktuell === 'dark' ? 'light' : 'dark';
      themaAnwenden(neu);
      try { localStorage.setItem(THEMA_SPEICHER, neu); } catch (e) { /* egal */ }
    });
  }

  /* ---------------- Trenner Netzplan | Seitenleiste ----------------
     Ziehen setzt die Breite der Seitenleiste frei (gespeichert), Doppelklick setzt sie zurueck.
     Der Netzplan skaliert ueber seine viewBox von selbst mit. */
  const BREITE_SPEICHER = 'bgp-sim-leiste-breite';
  function leisteBreite(px, merken) {
    const b = document.body;
    if (px == null) {
      b.classList.remove('leiste-frei'); b.style.removeProperty('--leiste-breite');
      try { localStorage.removeItem(BREITE_SPEICHER); } catch (e) { /* egal */ }
      return;
    }
    px = Math.round(Math.min(Math.max(320, window.innerWidth - 360), Math.max(320, px)));
    b.classList.remove('leiste-breit');
    b.classList.add('leiste-frei');
    b.style.setProperty('--leiste-breite', px + 'px');
    if (merken) try { localStorage.setItem(BREITE_SPEICHER, String(px)); } catch (e) { /* egal */ }
  }
  function trennerInit() {
    const t = document.getElementById('trenner');
    try { const g = +localStorage.getItem(BREITE_SPEICHER); if (g) leisteBreite(g); } catch (e) { /* egal */ }
    t.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { t.setPointerCapture(e.pointerId); } catch (err) { /* egal, z. B. synthetische Events */ }
      document.body.classList.add('zieht');
      const rechts = document.querySelector('main').getBoundingClientRect().right;
      const bewegen = (ev) => leisteBreite(rechts - ev.clientX - 3);
      const ende = (ev) => {
        leisteBreite(rechts - ev.clientX - 3, true);
        document.body.classList.remove('zieht');
        t.removeEventListener('pointermove', bewegen);
        t.removeEventListener('pointerup', ende);
        t.removeEventListener('pointercancel', ende);
      };
      t.addEventListener('pointermove', bewegen);
      t.addEventListener('pointerup', ende);
      t.addEventListener('pointercancel', ende);
    });
    t.addEventListener('dblclick', () => leisteBreite(null));
  }
  App.layout = {
    leisteBreite,
    istFrei: () => document.body.classList.contains('leiste-frei'),
  };

  document.addEventListener('DOMContentLoaded', () => {
    trennerInit();
    themaInit();
    const info = document.getElementById('knotenInfo');
    App.netz.aufbauen(document.getElementById('netz'), info,
      (key) => { App.netz.markiereKnoten(key); App.netz.knotenInfo(key); },
      (sys) => App.artefakte.waehleSystem(sys));
    document.getElementById('netz').addEventListener('click', () => { App.netz.markiereKnoten(null); App.netz.infoAus(); });

    App.artefakte.init(document.getElementById('artWahl'), document.getElementById('artListe'), document.getElementById('artZaehler'),
      document.getElementById('nurNeue'));

    document.getElementById('breiter').addEventListener('click', () => {
      const breit = document.body.classList.contains('leiste-breit') || App.layout.istFrei();
      App.layout.leisteBreite(null);
      document.body.classList.toggle('leiste-breit', !breit);
    });
    document.getElementById('fokusZurueck').addEventListener('click', () => App.artefakte.fokus(null));
    document.getElementById('wahlUmschalten').addEventListener('click', (e) => {
      const w = document.getElementById('artWahl');
      w.classList.toggle('zu');
      e.currentTarget.textContent = w.classList.contains('zu') ? 'Auswahl ▸' : 'Auswahl ▾';
    });
    document.getElementById('ablaufUmschalten').addEventListener('click', (e) => {
      const a = document.getElementById('ablauf');
      a.classList.toggle('zu');
      e.currentTarget.textContent = a.classList.contains('zu') ? 'Ablauf ▸' : 'Ablauf ▾';
    });
    const hilfe = document.getElementById('hilfe');
    document.getElementById('hilfeAuf').addEventListener('click', () => hilfe.showModal());
    document.getElementById('hilfeZu').addEventListener('click', () => hilfe.close());

    const handschlagBtn = document.getElementById('handschlagBtn');
    handschlagBtn.addEventListener('click', () => {
      const an = !App.netz.istHandschlagAn();
      App.netz.setzeHandschlag(an);
      handschlagBtn.classList.toggle('an', an);
      handschlagBtn.setAttribute('aria-pressed', String(an));
      // bei "an" von vorn animieren (SYN zuerst), bei "aus" nur neu zeichnen
      if (an) App.steuerung.wiederholen(); else App.steuerung.neuZeichnen();
    });

    App.steuerung.init({
      spielen: document.getElementById('spielen'),
      vor: document.getElementById('vor'),
      zurueck: document.getElementById('zurueck'),
      phasen: document.getElementById('phasen'),
      ablauf: document.getElementById('ablauf'),
      phaseChip: document.getElementById('phaseChip'),
      zaehler: document.getElementById('schrittZaehler'),
      titel: document.getElementById('schrittTitel'),
      text: document.getElementById('schrittText'),
      details: document.getElementById('schrittDetails'),
      zeit: document.getElementById('zeitAnzeige'),
      handschlagBtn,
    });
    reiterAufbauen();
  });
})(window.App);
