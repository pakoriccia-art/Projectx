---
target: dashboard live
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:/home/user/Projectx/src/components/dashboard/DashboardV4.tsx"
target_fingerprint: "sha256:08ad2f61c9cf6cbf1922e793c8bedb0a780ed35026d423a0553fef2c9a9f7679"
target_path: /home/user/Projectx/src/components/dashboard/DashboardV4.tsx
timestamp: 2026-10-04T10-12-44Z
slug: src-components-dashboard-dashboardv4-tsx
closed: true
---
Method: dual-agent (A: design review · B: detector + browser). Overlay detect.js non iniettato (plan mode); sostituito da CLI + misure in pagina.

## Design Health Score — 19/40 (Scarso)
| # | Euristica | Voto | Problema |
|---|---|---|---|
| 1 | Visibilità stato | 2 | Eroe = 4.5% maturazione, non "pronto alle HH:MM"; "OK" = in corso e sweet spot |
| 2 | Mondo reale | 3 | Gergo motore (2-CLOCK, t/t_crit, Newton τ); giallo ATTENZIONE in avvicinamento |
| 3 | Controllo | 1 | Tap su fase futura = skip immediato, irreversibile |
| 4 | Coerenza | 2 | Cottura 12.5h / 12.5h / 22:34, divergono dopo cambio fase |
| 5 | Prevenzione errori | 1 | Skip di fase senza conferma; conferma fine sessione con distruttivo dominante |
| 6 | Riconoscimento | 2 | target 80% ×3, ETA non scritta |
| 7 | Efficienza | 2 | Default Analisi, toggle 31px, nessun wake-lock |
| 8 | Minimalismo | 2 | Slider T ambiente è l'elemento più forte in Analisi |
| 9 | Recupero errori | 2 | Ribbon critici senza azione |
| 10 | Aiuto | 2 | Nessuna spiegazione inline, ipotesi non marcate |

## Specificità
Autoriale nella pelle (BANCO), non nella risposta: costruito su "a che % sei", non "quando inforno". Detector: 73 finding (70 advisory, quasi tutti DashboardView.tsx dead code); reali: layout-transition SemaforoCard:73 (dead), dark-glow decorativo su logo/ember; pulsing-dot LIVE = falso positivo. Browser: sticky header/footer rotti in Analisi (#root overflow-x hidden), 78/113 testi ≤10px, assi W 9px, Forno 7 contrasti < AA via opacity, toggle 31px, ← Dashboard 16px.

## Priority issues
- [P0] Skip di fase con un tap, irreversibile (FermentationTimeline.tsx:153) → conferma + annulla 10s (harden)
- [P0] Nessuna risposta a "quando inforno?" → eroe PRONTO ~HH:MM, orari assoluti, fusione Sweet spot (clarify, layout)
- [P1] Semaforo ambiguo (OK/ATTENZIONE/PRESTO) → stati IN CORSO/QUASI/PRONTO, banner approaching (colorize)
- [P1] Fine sessione solo distruttiva, copy falsa "dati NON salvati" (DashboardV4.tsx:610) → "Ho infornato" + esito, copy vera (clarify, delight)
- [P2] Default Analisi, sticky rotti, toggle 31px, slider dominante, no wake-lock (adapt, quieter)

## Persona red flags
Pizzaiolo mani infarinate: marker tappabili, toggle 31px, eroe cachi illeggibile, schermo si spegne. Prima sessione: atterra su Analisi densa, gergo, giallo allarmante, minaccia di perdita dati. Pro con finestra di servizio: ore decimali, finestra nascosta, header/timeline divergenti.

## Minor
Linea timeline fissa 42%; refuso APPRETO; useMemo dopo early return (DashboardV4:352); fallback grigi freddi; hex a mano e #2a8f74; nessun aria-live; Collapsible div non accessibile; legenda grafico.

## Domande
Una riga a un metro: 70.2% o "Inforna alle 21:10"? Perché lo sweet spot ha meno cerimonia del collasso? Timeline: strumento o telecomando senza sicura?
