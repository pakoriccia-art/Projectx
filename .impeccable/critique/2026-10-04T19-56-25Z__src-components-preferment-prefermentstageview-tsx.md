---
target: flusso prefermento (biga/poolish), terza iterazione
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/user/Projectx/src/components/preferment/PrefermentStageView.tsx"
target_fingerprint: "sha256:485579a611ffa40bbe69433ec55e5ff723bb6682768be17497f79dc7329a40d3"
target_path: /home/user/Projectx/src/components/preferment/PrefermentStageView.tsx
timestamp: 2026-10-04T19-56-25Z
slug: src-components-preferment-prefermentstageview-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

# Critique — flusso prefermento, terza iterazione: 27/40 (come la seconda, per motivi diversi)

| # | Euristica | Voto | Problema chiave |
|---|---|---|---|
| 1 | Visibilità dello stato | 2 | Banner/riga/notifiche: nome del principale con numeri del poolish ("Biga oltre da 4 h 17") |
| 2 | Mondo reale | 3 | "insieme a la biga", "PRONTA" fisso; poolish da impastare di notte senza alternativa |
| 3 | Controllo | 3 | Nessuna uscita se il secondo prefermento non è stato avviato |
| 4 | Coerenza | 2 | Wizard usa il primo prefermento, la fase il più lungo; luoghi vs °C tra semplice e Avanzato |
| 5 | Prevenzione errori | 3 | Doppio tocco, blocco ricetta, conferma molto oltre, guardia impasto attivo |
| 6 | Riconoscere | 3 | Dosi e acqua sempre a portata |
| 7 | Flessibilità | 2 | Avvio del secondo non ripianificabile né saltabile |
| 8 | Minimalismo | 3 | Due primari insieme (frigo + È pronta) quando è oltre |
| 9 | Recupero | 3 | Correzione sotto la piega; lascia 0 g di acqua finale |
| 10 | Aiuto | 3 | Segni e frigo quantificato |

Risolti: doppio tocco, fasi legacy, correzione nel range dello stile (ma 0 g d'acqua), domanda con giorno, soglie 10%, "0 g di ghiaccio", banner che segnala il ritardo (ma attribuito male).

## Priorità
- [P1] Stato sintetico attribuito al prefermento sbagliato (banner, riga, notifiche 130/131/133, conferme "molto oltre"/"in anticipo").
- [P1] Secondo prefermento non avviato all'ora: vicolo cieco, nessun ritardo segnalato, impasto finale bloccato.
- [P1] La gerarchia segue il più lungo, non il più urgente: hero "PRONTA" mentre il poolish è oltre; manca la finestra "impasta entro".
- [P2] Ritardo che non scala 138→250%; CTA "È pronta" quando è oltre; due primari.
- [P2] Identità del prefermento incoerente wizard/fase; acqua finale con la T del solo principale (media pesata 10 °C, mostrati 16 °C); focus perso su domanda di sostituzione e correzione; Btn 40–42 px.
- [P3] "PRONTA" fisso, "insieme a la", etichetta del timer, riga dashboard senza aria-label, radiogroup "Tipo" doppi, font fuori scala.

## Persone
- Esperto: sveglia notturna imposta per il poolish; cambio tipo in Avanzato resetta in silenzio.
- Professionista: riga dashboard sbagliata sul nome e sulle ore; servizio calcolato solo sul principale.
- Di fretta: "OLTRE" + "È pronta"; suggerimento frigo che si legge al contrario.

## Domande
1. Allineare le finestre di tolleranza invece del 100%? Proporre 2–3 piani per il secondo prefermento?
2. L'hero dovrebbe essere la scadenza unica ("impasta entro") calcolata sul peggiore?
