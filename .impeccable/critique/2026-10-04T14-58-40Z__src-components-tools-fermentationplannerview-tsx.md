---
target: pianifica fermentazione
total_score: 15
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:/home/user/Projectx/src/components/tools/FermentationPlannerView.tsx"
target_fingerprint: "sha256:0c5a9a5f3643a87f8a5d2774cb8a7d617e4838f45e5d490d812b4b2ee7948064"
target_path: /home/user/Projectx/src/components/tools/FermentationPlannerView.tsx
timestamp: 2026-10-04T14-58-40Z
slug: src-components-tools-fermentationplannerview-tsx
---
Method: dual-agent (A: design review del ramo planner → wizard → dashboard, 390×844 + 1280×800, orologio simulato · B: detector CLI + overlay live detect.js + misure in pagina + handoff verificato in IndexedDB).

## Design Health Score — 15/40 (Scarso) · primo giro sul planner
| # | Euristica | Voto | Problema |
|---|---|---|---|
| 1 | Visibilità stato | 1 | Tre orari incompatibili per lo stesso impasto (piano dom 20:00, dashboard ~22:21 sab, PRONTO alle 00:35 in frigo) |
| 2 | Mondo reale | 2 | "TC Appreto", ore decimali, kRatio/ADU/C_attrito esposti, tre nomi per il riscaldo |
| 3 | Controllo | 1 | "← Planner" azzera lo stato; il modale fuori protocollo scarta il frigo pianificato con un tocco |
| 4 | Coerenza | 1 | Soglia 80/85/90 a seconda della schermata; riscaldo 2.4h vs 5.9h; verdi Classic |
| 5 | Prevenzione errori | 1 | Servizio fallisce solo all'avvio; badge OK su sotto/sovramaturato; 4 CTA attive con data passata |
| 6 | Riconoscimento | 2 | La dashboard non mostra orario e soglia del piano; wizard "modificato manualmente" sui valori del planner |
| 7 | Efficienza | 2 | Servizio sempre "Impasta ADESSO"; nessun piano salvabile |
| 8 | Minimalismo | 2 | Risultato dopo ~2.900px; 4 CTA brace uguali; kRatio come numero protagonista |
| 9 | Recupero errori | 1 | Errore Zod grezzo in inglese senza uscita; "3/-1"; target contraddittori nei testi |
| 10 | Aiuto | 2 | Stelle, kRatio, ADU senza spiegazione |

## Detector
CLI: 87 advisory (62 nel planner: 48 font fuori scala, 14 colori incl. #00b894), nessun non-advisory. Overlay: 18–36 per stato. Misure: CTA a 2.600–3.200px; 0/13 slider con nome accessibile, data/ora senza nome; "←" 10×20px, "+ Mix farine" 22px; 2 contrasti sotto soglia; h1+h2 duplicati.

## Problemi prioritari
- P0-1 — Servizio non avvia la sessione: `temperingH` passato dal planner, `WizardInputSchema.strict()` lo rifiuta (schemas.ts:136-151) → errore Zod grezzo.
- P0-2 — Soglia del piano ignorata (DashboardV4.tsx:453, GompertzChartV4.tsx:572); PRONTO "Inforna ORA" acceso con l'impasto in frigo a 4°C, 20h prima del piano; banda uscita frigo "si può infornare ora".
- P1-3 — Il piano si deforma nel passaggio: riscaldo 2.4→5.9h, "modificato manualmente", modale fuori protocollo su un piano TC, timeline senza giorno, appretto extra in Qualità.
- P1-4 — Struttura del planner: risultato in fondo, 4 CTA uguali senza raccomandazione, badge OK sull'esito sbagliato, stato perso tornando dal wizard.
- P2-5 — Testi/dati: "90%" cablato, "3/-1", poolish chiamato biga, "TC Appreto", ore decimali, campo ora troncato.
- P2-6 — Servizio fragile: finestra fattibile strettissima, impasto sempre "adesso", verde per "fattibile".
- P3-7 — Token Classic e a11y: slider senza nome, target piccoli, h2 duplicato.

## Persone
- Professionista: Servizio → errore in inglese, lavoro perso.
- Appassionato del weekend: "modificato manualmente", modale fuori protocollo, PRONTO a mezzanotte, finale "+19h 37m", planner azzerato.
- Primo uso del frigo: può scartare il frigo per errore e infornare impasto a 4°C.
