---
target: flusso prefermento (biga/poolish), seconda iterazione
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/user/Projectx/src/components/preferment/PrefermentStageView.tsx"
target_fingerprint: "sha256:b346cf6a0eea5f89f7505345608fcd41df915f4f68b78870a739d519189854a0"
target_path: /home/user/Projectx/src/components/preferment/PrefermentStageView.tsx
timestamp: 2026-10-04T18-48-31Z
slug: src-components-preferment-prefermentstageview-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

# Critique — flusso prefermento, seconda iterazione: 27/40 (prima 25/40)

| # | Euristica | Voto | Problema chiave |
|---|---|---|---|
| 1 | Visibilità dello stato | 3 | In ritardo il numero grande è un orario passato; banner e riga dashboard restano neutri |
| 2 | Mondo reale | 3 | "maturazione ~250%" non dice cosa fare |
| 3 | Controllo | 3 | Ripristina/Annulla ovunque; manca "Tieni quella" nella sostituzione |
| 4 | Coerenza | 2 | Soglie 20% vs 10% al passo 3; acqua finale 13 g vs 2 g di ghiaccio tra passo 8 e fase |
| 5 | Prevenzione errori | 2 | Con due prefermenti segue quello sbagliato; avvio al 250% senza conferma; doppio clic "Sostituisci" → due fasi |
| 6 | Riconoscere | 3 | Dosi a un tocco |
| 7 | Flessibilità | 2 | Quota solo 30/50/70; "già pronto" senza grammi reali |
| 8 | Minimalismo | 3 | Formula DDT grezza al passo 8 |
| 9 | Recupero | 3 | Fix esemplare al passo 8; "terminalo dalla dashboard" senza azione |
| 10 | Aiuto | 3 | Manca come rimediare a una biga oltre |

Risolti dalla prima critique: ricetta impossibile (D1), fase persa con impasto attivo (D2), dosi nella fase, conferma anticipata, autolisi (D5), orari planner/fase (D10). Parziali: D3/D4 (doppio clic), D6, D9. Ancora: D7 (Btn 40–42 px), D8 (10,9 px), D11 (font fuori scala).

## Priorità
- [P1] Due prefermenti: titolo, segni e soglia del poolish con la durata della biga; entrambi da impastare subito → poolish oltre quando l'app dice 100%. Main = il più lungo; il secondo con orario di avvio scaglionato e promemoria.
- [P1] Ritardo che non scala: stesso giallo a 101/138/250%, nessuna conferma oltre soglia, banner/riga neutri, "impasta appena puoi" anche se un impasto è attivo. Toni crescenti, azione "Mettila in frigo", conferma oltre ~150%, banner "⚠ oltre da X h".
- [P1] Doppio clic su "Sostituisci" crea due fasi: disabilitare durante il salvataggio.
- [P2] Due calcoli diversi per l'acqua dell'impasto finale: uno solo; al passo 8 "lo ricalcolo quando la biga è pronta".
- [P2] Fasi salvate dalla build precedente (senza plannedH): dopo uno spostamento la maturazione si dimezza e la T equivalente esce 0 °C.
- [P2] Correzione idratazione oltre il range dello stile (propone 77% con max 67,5%).
- [P2] "Fatto ✓" secondario mentre "È pronta" a 0% è primario; "È pronta" attivo con un impasto in corso; focus perso dopo le conferme.
- [P3] Soglie 20/10%, fix assente al passo 3, giorno mancante nella domanda di sostituzione, due radiogroup "Tipo", timer senza etichetta, aria-label del banner senza orario, "0 g di ghiaccio" possibile, Btn 40–42 px, font fuori scala.

## Persone
- Esperto: quota 40% solo da Avanzato; grammi reali del già pronto non inseribili; due prefermenti seguiti male.
- Professionista: "Tengo/Sposto il servizio" senza esito previsto; ritardo invisibile dalla dashboard.
- Alle prime armi: "È pronta" arancio a 0%; "~250%" non dice se buttarla.

## Domande
1. Se l'app sa che la biga va oltre alle 14:40, perché non suggerisce prima di spostarla in frigo?
2. Con due prefermenti, meglio seguirli entrambi davvero o limitarsi al principale?
