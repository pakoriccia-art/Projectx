---
target: flusso prefermento (biga/poolish)
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/home/user/Projectx/src/components/preferment/PrefermentStageView.tsx"
target_fingerprint: "sha256:ff93beb74c640c08a6d88d0e69db7b693dc7ef6e0a9e469643623dd44b3ad131"
target_path: /home/user/Projectx/src/components/preferment/PrefermentStageView.tsx
timestamp: 2026-10-04T17-08-40Z
slug: src-components-preferment-prefermentstageview-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

# Critique — flusso prefermento (biga/poolish): 25/40

| # | Euristica | Voto | Problema chiave |
|---|---|---|---|
| 1 | Visibilità dello stato | 3 | Ora e countdown chiari, ripresa ok; dopo l'ora prevista il tono non cambia |
| 2 | Mondo reale | 3 | Lessico giusto; "Farine rinfresco" sopra una farina che vale anche per la biga |
| 3 | Controllo e libertà | 2 | "Già pronta 20 h" → "Da preparare" reinterpreta la durata in silenzio |
| 4 | Coerenza | 3 | Poolish "8–16 h" ma frigo 16–36 h; brace sull'opzione rischiosa |
| 5 | Prevenzione errori | 1 | Si parte con acqua dei prefermenti > acqua totale o 100% farina in prefermento |
| 6 | Riconoscere | 2 | Nella fase in corso mancano le dosi della biga appena "da impastare" |
| 7 | Flessibilità | 3 | Semplice / Avanzato / Planner, "Regola a mano" |
| 8 | Minimalismo | 3 | Fase pulita; passo 8 con 6 card e formula DDT grezza |
| 9 | Recupero errori | 2 | Avvisi non bloccanti e senza azione |
| 10 | Aiuto | 3 | Segni di maturazione, nota planner |

Specificità: autoriale (segni sensoriali, luogo+temperatura, "Biga (tutta)", durata reale nella previsione). Detector: 0 bloccanti, 41 advisory (font fuori scala, 30 legacy); overlay: solo regole globali della shell sulla fase in corso.

## Priorità
- [P1] Ricetta incoerente avviabile (acqua prefermenti > totale; Σ prefermenti 100% → "Farina 0 g"; secondo prefermento creato al 50%). Bloccare con blockedReason + azione correttiva; secondo prefermento con quota residua.
- [P1] Fase "in corso": coesistenza con sessione attiva (lo stage sparisce al reload, notifica cancellata), due stage contemporanei, race sull'id prima del salvataggio.
- [P1] Nella fase in corso mancano le dosi della biga e la temperatura dell'acqua per la biga; la card acqua del passo 8 sembra riferita alla biga.
- [P1] Conferma anticipata con il brace su "Sì, impasto adesso"; nessuna escalation dopo l'ora prevista, notifica unica.
- [P2] Cambio "Già pronta ↔ Da preparare" sovrascrive la durata in silenzio, nessuna durata selezionata.
- [P2] targetBakeAt spostato in silenzio all'impasto; orari Planner (primo prefermento) ≠ stage (massimo).
- [P2] Autolisi nella fase senza composizione né tempi; numerata "1" anche se si fa per ultima.
- [P3] Btn 40–42px; banner "pronta alle lun 11:01"; font 1.5rem/13/12px fuori scala; "Sì, annulla" bianco su #ff7675 (~2.6:1); riporto mostra "lievito 0.05%"; "×" di PrefRow 22px senza aria-label.

## Persone
- Esperto: biga al 100% impossibile; una sola farina per biga e rinfresco.
- Professionista: servizio spostato da solo; ritardo senza escalation.
- Alle prime armi: ghiaccio accanto a "Impasta la biga"; conferma anticipata spinge all'opzione sbagliata; sul web la notifica non arriva.

## Domande
1. La biga dovrebbe avere una sua previsione di maturazione invece di un'ora fissa?
2. Per un professionista è fisso il servizio o la biga?
