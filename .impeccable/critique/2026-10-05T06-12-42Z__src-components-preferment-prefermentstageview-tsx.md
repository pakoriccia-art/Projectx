---
target: flusso prefermento (biga/poolish), quarta iterazione
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/user/Projectx/src/components/preferment/PrefermentStageView.tsx"
target_fingerprint: "sha256:26e06280106dfb0f4f6244f4d87014b51040920f930da9ebc28078290b69dfb9"
target_path: /home/user/Projectx/src/components/preferment/PrefermentStageView.tsx
timestamp: 2026-10-05T06-12-42Z
slug: src-components-preferment-prefermentstageview-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

# Critique — flusso prefermento, quarta iterazione: 28/40 (prima 25 → 27 → 27)

| # | Euristica | Voto | Problema chiave |
|---|---|---|---|
| 1 | Visibilità dello stato | 3 | A PRONTA il CTA dell'impasto finale è sotto la piega; "Sono pronti" anche all'83% |
| 2 | Mondo reale | 3 | "Prima di 1 h" ambiguo; segni di "oltre" scritti come fatti |
| 3 | Controllo | 3 | Ripristina, ±1 h, conferme |
| 4 | Coerenza | 3 | Due primari e frigo duplicato nel caso in ritardo; due "Vai all'impasto in corso" |
| 5 | Prevenzione errori | 2 | "Lo impasto adesso" primario quando la biga ne patisce; avvio all'83% senza conferma; slider idratazione oltre lo schema |
| 6 | Riconoscere | 3 | Big "mar 00:00" senza etichetta |
| 7 | Flessibilità | 2 | Impasto finale bloccato con un'altra sessione attiva |
| 8 | Minimalismo | 3 | Pagina lunga; segni di "pronta" anche a OLTRE |
| 9 | Recupero | 3 | "va oltre alle 07:02 (in frigo regge fino alle 07:02)" quando è già passato |
| 10 | Aiuto | 3 | Segni solo del prefermento in focus |

Risolti: attribuzione, vicolo cieco del secondo, gerarchia sul più urgente, ritardo scalato, focus su sostituzione/correzione, "Tipo" duplicati, reset silenzioso al cambio tipo, avvio del secondo spostabile, Btn 44 px, acqua pesata.

## Priorità
- [P1] Poolish in ritardo con la biga già oltre: testo incoerente (orari passati, frigo "+0"), "Lo impasto adesso" primario, due primari, frigo duplicato.
- [P1] A PRONTA/OLTRE il CTA dell'impasto finale è sotto la piega.
- [P1] Notifica 131 solo sul primo che va oltre: se è già oltre, l'altro non viene mai avvisato.
- [P2] "Sono pronti/È pronta" anche in crescita; nessuna conferma tra 75% e 100%.
- [P2] Slider idratazione prefermento oltre i limiti dello schema → errore Zod in inglese all'avvio.
- [P2] Notifica 132 sempre "insieme alla biga"; notifica 133 "prima di le", "fino martedì".
- [P2] Contrasto "troppo oltre" 4,12:1 a 13 px; segni solo del prefermento in focus; "Controllala" fisso.
- [P3] Focus perso dopo "No" in procedi senza e dopo Ripristina; "Acqua 0 g" al passo 8; footer alto con la domanda di sostituzione; banner che non avvisa "non pronti insieme"; font fuori scala (41 + 29 non rilevati).

## Persone
- Esperto: finestra notturna non segnalata; "Prima di 1 h" ambiguo.
- Professionista: impasto finale bloccato da un'altra sessione; banner con un solo evento.
- Di fretta: "Sono pronti" quando non lo sono; due primari arancioni.

## Domande
1. Quando aspettare il poolish manda la biga troppo oltre, l'app deve dire "conviene procedere senza" lasciando il veto all'utente?
2. A PRONTA il numero grande deve essere il conto alla rovescia "impasta entro" invece della parola di stato?
