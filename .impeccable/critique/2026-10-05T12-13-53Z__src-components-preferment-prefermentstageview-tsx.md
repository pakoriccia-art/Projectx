---
target: flusso prefermento (biga/poolish), quinta iterazione
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/user/Projectx/src/components/preferment/PrefermentStageView.tsx"
target_fingerprint: "sha256:e69cd97acca2b85f1ab3d6fb1ad9b55c17c0c42260021013b7f304b4bb52eb03"
target_path: /home/user/Projectx/src/components/preferment/PrefermentStageView.tsx
timestamp: 2026-10-05T12-13-53Z
slug: src-components-preferment-prefermentstageview-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

# Critique — flusso prefermento, quinta iterazione: 28/40 (25 → 27 → 27 → 28 → 28)

| # | Euristica | Voto | Problema chiave |
|---|---|---|---|
| 1 | Visibilità dello stato | 3 | Dopo il primario consigliato compare "Non sono pronti insieme"; "Fatto" non registra l'ora reale |
| 2 | Mondo reale | 3 | "tra le mar 06:03 e le mar 10:03"; "spostarla" ambiguo |
| 3 | Controllo | 3 | Frigo senza orario di uscita |
| 4 | Coerenza | 3 | Advisory sans/blu; "Pre-fermento"/"prefermento"; "50.5%" col punto |
| 5 | Prevenzione errori | 3 | Il frigo consigliato genera il conflitto |
| 6 | Riconoscere | 3 | "Rivedi le dosi" sempre del principale |
| 7 | Flessibilità | 2 | Una sola correzione proposta; "usane meno" senza grammi; ora d'impasto non correggibile |
| 8 | Minimalismo | 2 | Ridondanze nello stato di ritardo; card frigo annidate; due card frigo |
| 9 | Recupero | 3 | Ramo "in ritardo" coerente e con un solo primario |
| 10 | Aiuto | 3 | Segni per ogni prefermento |

Risolti: CTA in vista, 131 per ogni prefermento, "pronti" in crescita, slider nello schema, testi 132/133, contrasto troppo oltre, segni per ogni prefermento, concordanze, focus No/Ripristina, "Acqua —".

## Priorità
- [P1] "Metti la biga in frigo e impasta il poolish" porta subito a "Non sono pronti insieme": fridgeHelps controlla che la biga non vada oltre, non che sia pronta in tempo.
- [P1] Quando un prefermento è OLTRE il primario è il frigo e non l'impasto finale; in TROPPO OLTRE nessun primario; con poolish troppo oltre e biga oltre il primario è sotto la piega.
- [P2] "Fatto ✓" non registra l'ora reale d'impasto; poolish in ritardo senza notifica ad app chiusa; "Impasto finale adesso" primario con biga all'81% senza finestra e senza conferma; focus su BODY dopo "Fatto" e dopo l'azione unica.
- [P3] Ridondanze del ritardo; segni di "pronta" anche oltre; card annidate; "tra le mar"; "spostarla"; domanda di sostituzione col solo nome del principale; footer alto; limiti numerici senza messaggio italiano; caratteri ereditati fuori scala nel wizard; "50.5%".

## Persone
- Esperto: una sola correzione, "usane meno" senza grammi.
- Professionista: frigo senza orario di uscita, piano notturno vago.
- Di fretta: tre pulsanti e due selettori nello stato di ritardo doppio.

## Domande
1. Il frigo è un piano che ha bisogno di un orario di uscita ("tirala fuori alle …")?
2. Quando la biga è oltre, l'app deve aiutare a salvarla o a usarla bene (grammi ridotti)?
