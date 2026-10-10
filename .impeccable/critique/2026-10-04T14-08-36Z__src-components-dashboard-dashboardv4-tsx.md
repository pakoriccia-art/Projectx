---
target: dashboard live
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/user/Projectx/src/components/dashboard/DashboardV4.tsx"
target_fingerprint: "sha256:bc3dc6fc3ac602f29ef86894bd95689af2fc98daf9749183221029362ff3652d"
target_path: /home/user/Projectx/src/components/dashboard/DashboardV4.tsx
timestamp: 2026-10-04T14-08-36Z
slug: src-components-dashboard-dashboardv4-tsx
---
Method: dual-agent (A: design review, percorso completo fino allo Storico a 390×844 · B: detector CLI + overlay live detect.js + misure in pagina). Tempo simulato; modali OOP e Collasso valutati sul codice.

## Design Health Score — 27/40 (Accettabile, al limite di Buono) · trend 19 → 26 → 25 → 27
| # | Euristica | Voto | Δ | Problema |
|---|---|---|---|---|
| 1 | Visibilità stato | 3 | +1 | Dopo l'infornata la pill dell'header resta "APPRETTO · TA"; annulla fase non ripristina lo stato |
| 2 | Mondo reale | 3 | = | "La previsione resta … il piano delle fasi va alle …" è lingua del motore |
| 3 | Controllo | 2 | −1 | Annulla della fase non ripristina; "Termina senza infornare" senza conferma |
| 4 | Coerenza | 2 | = | 🍕 del grafico sul target del wizard (terzo orario); glow contrari a DESIGN.md; due h1 nello Storico |
| 5 | Prevenzione errori | 3 | = | Registrare lo staglio puntuale lo allunga a 4h e sposta il piano di +3h30 |
| 6 | Riconoscimento | 3 | = | Previsione vs piano in 5 punti |
| 7 | Efficienza | 3 | +1 | Manca orario libero e correzione dopo 10s |
| 8 | Minimalismo | 3 | = | Scarto dal piano ripetuto 3 volte; glow residui |
| 9 | Recupero errori | 2 | = | Fase/infornata non correggibili dopo 10s |
| 10 | Aiuto | 3 | +1 | "Fidati del panetto" senza dire cosa guardare |

## Specificità
Monitor molto specifico (banda staglio, "Fatto alle", racconto "Infornata alle"); Storico generico, non mostra previsione vs realtà.

## Detector
CLI 20 (=), 2 warning intenzionali (pulsing-dot; dark-glow rosso solo nelle classi critiche, mai renderizzato). Runtime: restano glow a offset zero in `pm4-segfill` (index.html:319, LED, verdi ×10 a PRONTO) e `pm4-pip` (index.html:316) che il CLI non vede (var()). Overlay: Monitor 6, Analisi 9, Storico 2. 0 target <44px, 0 contrasto fallito (min 4.85). Orari header/eroe/timeline coincidono in tutti gli stati. Focus del pannello di conferma ok. Focus perso su body dopo "Ho infornato", "Fatto ora", "Elimina". CSS morto `.pm4-glow-ember/green`.

## Problemi prioritari
- P1-a — Registrare una fase sposta il piano e l'annulla non ripristina: probabilmente la sessione attiva non ha `thermalTimeline` in memoria, quindi `setPhase`/`snapshotPhase` ricostruiscono con `buildInitialTimeline` (stati per orario → staglio già "current", durata default 4h). Fix: transizione e snapshot dalla stessa timeline effettiva mostrata; test di regressione.
- P1-b — Terzo orario nel grafico (🍕 su targetBakeAt); scarto dal piano ripetuto in header/eroe/timeline fin dal minuto zero; anteprima in lingua del motore.
- P2 — Glow `pm4-pip` e `pm4-segfill` contrari a DESIGN.md.
- P2 — Storico senza confronto previsione/realtà (promesso dalla notifica), chip voto 32px, due h1.
- P2 — Pannello di conferma sopra la timeline: il marker toccato finisce sotto il footer. Focus perso dopo azioni che smontano il pulsante.
- P3 — "Termina senza infornare" senza conferma; header che si ridispone con lo scarto; 🔒 su COTTURA a PRONTO; pill di fase dopo l'infornata; "· TA" a capo.

## Persone
- Pizzaiolo: tre bottoni nella banda a 9px di distanza; scarto a 11px illeggibile; annulla che non ripristina.
- Prima sessione: "~1h 34m dopo il piano" al minuto zero; staglio puntuale → "~3h prima del piano"; nessuna guida su cosa guardare nel panetto.
- Professionista: nessuna lettura del servizio nel Monitor; retrodatazione solo all'orario pianificato; Storico non calibra la fiducia.
