---
target: dashboard live
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:/home/user/Projectx/src/components/dashboard/DashboardV4.tsx"
target_fingerprint: "sha256:d20889aa33db8fd5a0885d11c231da7434672180e7d3aa8279198eec0e916628"
target_path: /home/user/Projectx/src/components/dashboard/DashboardV4.tsx
timestamp: 2026-10-04T11-34-55Z
slug: src-components-dashboard-dashboardv4-tsx
---
Method: dual-agent (A: design review con percorso completo a 390×844 · B: detector CLI + overlay live detect.js + misure in pagina). Tempo simulato con clock.fastForward; modali OOP e Collasso valutati sul codice.

## Design Health Score — 25/40 (Accettabile) · prima 26/40 · all'inizio 19/40
| # | Euristica | Voto | Δ | Problema |
|---|---|---|---|---|
| 1 | Visibilità stato | 2 | −1 | Orari di cottura in conflitto: eroe dalla maturazione (~00:34), header/timeline/banda dal piano della timeline (03:50); dopo "Ho infornato" l'eroe dice ancora "Inforna · ORA" |
| 2 | Mondo reale | 3 | = | Ore decimali nel grafico e nello Storico; "W DECAY" in inglese |
| 3 | Controllo | 3 | = | Cestino dello Storico senza conferma né undo; voto non modificabile |
| 4 | Coerenza | 2 | = | balled_room = "Appretto – TA" nel grafico e "STAGLIO" in timeline; "intatta" accanto a "Usura 7%" |
| 5 | Prevenzione errori | 3 | = | Focus iniziale del CollapseModal sul distruttivo "Termina" |
| 6 | Riconoscimento | 3 | = | Piano vs previsione da riconciliare a memoria |
| 7 | Efficienza | 2 | = | Solo "Fatto ora": niente "fatto alle 19:30"; rinvio fisso |
| 8 | Minimalismo | 3 | = | A QUASI + banda la brace è ovunque (Ember Speaks Rule) |
| 9 | Recupero errori | 2 | = | Errori di voto/cancellazione ingoiati; CollapseModal senza "Ho infornato" |
| 10 | Aiuto | 2 | = | Nessuna spiegazione di previsione vs piano né di "regge fino a" |

## Specificità
Specifico: BANCO riconoscibile, Monitor leggibile a 1 m (orario 60px, banda "È ora dello staglio" con testo da banco). Lo Storico è rimasto Classic e generico.

## Detector
CLI: 24 finding (= run precedente), 2 warning. pulsing-dot `.pm4-live` intenzionale. dark-glow: il rosso animato è solo critico, ma glow cromatici a offset zero esistono in tutti gli stati (SemaforoCard.tsx:136, DashboardV4.tsx:791, FermentationTimeline.tsx:149) — il verdetto "solo critico" va corretto. Overlay: Monitor 7, Analisi 10. Misure: 0 target <44px, 0 fallimenti di contrasto, testo <11px solo assi SVG e "%", console pulita. Footer in stato Infornato 181px (37% dello schermo con l'header).

## Problemi prioritari
- P0 — Due risposte a "quando inforno?": readyAt (maturazione) vs fine timeline pianificata (header "piano", COTTURA in timeline, anteprima della banda). Fix UI: un solo orario, piano come deviazione esplicita e spiegata; anteprima banda "piano → 03:50 · previsione resta ~00:34"; COTTURA in timeline con l'orario previsto.
- P1 — Il finale non cambia stato: con bakedAt eroe, badge, LED, aria-live e timeline restano su PRONTO/ORA. Fix: eroe "Infornata alle 00:51 · previsione ~00:34", COTTURA fatta, riepilogo nel pannello (non nel footer), Storico che apre la card appena salvata.
- P1 — Timeline: orari pianificati obsoleti (APPRETTO 19:30 vs banda 23:49), STAGLIO e APPRETTO coincidenti, "in ritardo" dopo 1 min.
- P1 — "Fatto ora" senza orario reale; CollapseModal con focus su Termina e senza "Ho infornato".
- P2 — Storico Classic: cestino ~24px senza label/conferma, voto non modificabile, errori ingoiati, "13.4h", "W DECAY".
- P2 — A11y: role=status con pulsanti dentro; banda staglio non annunciata; pannello "Conferma cambio fase" con role=dialog senza focus/aria-modal.
- P3 — Glow cromatici fuori stato critico; verde/blu decorativi in QualityProfileCard; gradiente blu e #fff nel modale OOP; caption 10px; griglia di fondo.

## Persone
- Pizzaiolo a 1 m: due blocchi brace con risposte diverse ("Fatto ora" e "~00:34"); dopo l'infornata vede ancora "ORA" in verde.
- Prima sessione: "~01:34 · piano 00:00" al minuto zero senza spiegazione; due messaggi di tenuta diversi; cestino senza conferma.
- Professionista: non registra l'orario reale delle fasi; nessuno scarto previsione/realtà nello Storico per calibrarsi.

## Minori
Toast undo copre contenuto in Analisi; "~" a 60px pesa quanto una cifra; "limite di stesura tra ~107h"; stato vuoto Storico cita IndexedDB; etichetta fase corrente più bassa di 8px.
