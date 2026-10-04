---
target: pianifica fermentazione
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/home/user/Projectx/src/components/tools/FermentationPlannerView.tsx"
target_fingerprint: "sha256:cff0dfa607b9369f63edfb3b0165b34f960a7ad56c6947b28ab2813c7f42cc29"
target_path: /home/user/Projectx/src/components/tools/FermentationPlannerView.tsx
timestamp: 2026-10-04T15-55-48Z
slug: src-components-tools-fermentationplannerview-tsx
---
Method: dual-agent (A: design review planner → wizard → dashboard, 390×844 + 1280, orologio simulato · B: detector CLI + overlay detect.js + misure + passaggio verificato in IndexedDB).

## Design Health Score — 23/40 (Accettabile) · prima 15/40
| # | Euristica | Voto | Δ | Problema |
|---|---|---|---|---|
| 1 | Visibilità stato | 3 | +2 | L'anteprima della banda promette "l'orario non cambia" ma con frigo in programma la cottura slitta (DashboardV4.tsx ~646) |
| 2 | Mondo reale | 2 | = | Servizio: COTTURA = fine servizio (21:00 per servizio alle 19:00); FREDDO al 78% con target 85% |
| 3 | Controllo | 3 | +2 | Fasi da/verso frigo registrabili solo "adesso" |
| 4 | Coerenza | 2 | +1 | Tre layout di risultato; ore decimali nel wizard; "Usa questo piano" vs "Usa questo schema" |
| 5 | Prevenzione errori | 2 | +1 | Senza data piano assurdo con CTA attiva; Servizio "✓ OK" accanto a sforo; Qualità poolish 12h "adesso" |
| 6 | Riconoscimento | 2 | = | Wizard step 8 senza orari; obiettivo 20:00 sparisce quando il piano scivola |
| 7 | Efficienza | 3 | +1 | Manca "riallinea all'obiettivo" |
| 8 | Minimalismo | 2 | = | Card Servizio da debug (C1-C3, stringhe inglesi); brace in eccesso nella prima schermata |
| 9 | Recupero errori | 2 | +1 | "supera il 90% target" cablato; "12h 60min"; avviso "~18° · 0° sotto i 18°" |
| 10 | Aiuto | 2 | = | Nessuna spiegazione dei protocolli col frigo per chi lo usa la prima volta |

## Detector
CLI 71 advisory (prima 87; planner 62 → 46), nessun non-advisory. Overlay Orario 20, Servizio 22, Qualità 35. Piano consigliato a y≈450, CTA a ~560–605 (prima 2.600–3.200); Servizio CTA a 3511, Qualità 3135. 0 contrasti KO su testo attivo; 1 h1; slider con nome 10/10 e 13/13, ma 3 slider Qualità senza nome. Bug: `pickRecommended` sceglie per rumore in virgola mobile (TC Appretto ↔ TC Puntata a input identici). Passaggio TC Appretto conforme (riscaldo, dal Planner, target 85% dal piano, cottura 20:00, timeline con frigo, OOP confermato).

## Problemi prioritari
- P1-a — Servizio: cottura e soglia a fine servizio; all'inizio del servizio la dashboard dice "non ancora da infornare".
- P1-b — Il piano scivola in silenzio: anteprima errata con frigo in programma, obiettivo dell'utente non mostrato, racconto finale senza confronto.
- P1-c — Servizio e Qualità: risposta sepolta, card da debug, Qualità senza orari né lead time del prefermento.
- P1-d — `pickRecommended` instabile (tolleranza mancante).
- P2 — Wizard step 8 senza orari; default senza data propone un piano di 66h con CTA attiva.
- P3 — Brace in eccesso, hex cablati, 3 slider Qualità senza nome, testo <11px in Qualità.
