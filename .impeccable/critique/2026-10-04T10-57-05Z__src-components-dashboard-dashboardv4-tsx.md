---
target: dashboard live
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/home/user/Projectx/src/components/dashboard/DashboardV4.tsx"
target_fingerprint: "sha256:cc9bfefea63a9a351f71785218b1c517743ddd482f54cc6bbeed6f8fe1f0d9b5"
target_path: /home/user/Projectx/src/components/dashboard/DashboardV4.tsx
timestamp: 2026-10-04T10-57-05Z
slug: src-components-dashboard-dashboardv4-tsx
---
Method: dual-agent (A: design review · B: detector CLI + overlay live detect.js + misure in pagina 390×844). Tempo simulato con clock.fastForward.

## Design Health Score — 26/40 (Discreto) · prima 19/40
| # | Euristica | Voto | Δ | Problema |
|---|---|---|---|---|
| 1 | Visibilità stato | 3 | +1 | Fase resta "PUNTATA · TA" ore dopo lo staglio previsto |
| 2 | Mondo reale | 3 | = | Etichetta "PRONTO PER INFORNARE" sopra badge IN CORSO; "protocollo ta_only" esposto |
| 3 | Controllo | 3 | +2 | Esito chiude subito la sessione senza annulla |
| 4 | Coerenza | 2 | = | Tre orari di cottura (header piano / eroe / timeline dopo cambio fase); verde anche per "non pronto" |
| 5 | Prevenzione errori | 3 | +2 | Fasi scadute diventano non toccabili invece di essere proposte |
| 6 | Riconoscimento | 3 | +1 | Unico invito al tap su marker: pallino 6px |
| 7 | Efficienza | 2 | = | Nessun avviso "è ora dello staglio"; a PRONTO sparisce Aggiusta Rotta |
| 8 | Minimalismo | 3 | +1 | 234px prima dell'eroe; ribbon ripete il sotto-testo dell'eroe |
| 9 | Recupero errori | 2 | = | Staglio mancato non registrabile da timeline; "Continua a monitorare" ~21px |
| 10 | Aiuto | 2 | = | Coachmark fase bloccata tagliato dall'overflow della timeline |

## Specificità
Specifico, non generico: BANCO riconoscibile (pannelli fresati, LED, Fraunces + mono, orario assoluto protagonista). Tic residui: "01 · STATO" senza 02 in Monitor, glow diffusi, griglia di fondo.

## Detector
CLI: 30 finding (era 73), 2 non-advisory intenzionali (pulsing-dot .pm4-live = liveness reale, reduced-motion ok; dark-glow solo in stato critico). Overlay live: Monitor 26 / Analisi 43, dominati da undersized-ui-text 10px. Target <44px: 0. Contrasto: 0 fail in Monitor/Analisi, 3 fail a PRONTO (timeline 10px opacità 0.6: 2.44:1). Above the fold Monitor: tutti i pannelli visibili, nessuno scroll. Console pulita. Arial sul "▼" di Profilo impasto.

## Problemi prioritari
- P0 — Fasi pianificate passano in silenzio e diventano non toccabili (tappableFrom = start > now+5min, motore). Fix UI: banda CTA "È ora dello staglio · Fatto ora / Tra 15 min" con conferma+annulla; marker scaduti toccabili in brace; notifica locale.
- P1-a — Eroe non leggibile in 1s a 1m: etichetta "Pronto per infornare" sopra IN CORSO, readout 35px a y=234, "~lun 00:57". Fix: "INFORNI ALLE", readout 56–64px, giorno come suffisso, via riga canale in Monitor.
- P1-b — Tre orari di cottura: header usa targetBakeAt ("23:23 · superato" a PRONTO), eroe ORA, timeline 15:23 dopo cambio fase; due pip correnti. Fix: header = orario eroe, piano secondario.
- P2-a — Verde fuori dalla Ready Is Green Rule (celle Lievitazione, timeline completate/progresso/pallino tap); pH in giallo warning.
- P2-b — Finale piatto: voto chiesto all'infornata, chiusura immediata in Home. Fix: card riepilogo, voto facoltativo/dopo, annulla.
- P3 — A11y modali (role=dialog/aria-modal/focus trap), target "Continua a monitorare" 21px, "Resta a TA" 36px, ribbon 36px, testo 10px e contrasto timeline a PRONTO.

## Persone
- Pizzaiolo a 1m con mani infarinate: legge "PRONTO" sopra IN CORSO; pip 11px per lo staglio, poi non più toccabile.
- Prima sessione: "~lun 00:57" vs "target 23:23"; STAGLIO e APPRETTO stesso orario; TA/TC e "sbollatura" senza "?"; voto prima di assaggiare.
- Professionista: tenuta visibile solo a PRONTO; Aggiusta Rotta sparisce a PRONTO; "superato" giallo.

## Minori
Footer a capo su 2 righe a 390px; "?" sposta l'eroe di ~90px; glifi ◉/⊞ inutili; "−0.0%" e "Usura 0%" in Analisi; legenda grafico ~11px.
