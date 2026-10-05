---
target: ramo Nuovo impasto (Diretto) end-to-end
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
target_identity: "file:/home/user/Projectx/src/components/dashboard/DashboardV4.tsx"
target_fingerprint: "sha256:7c74049d7689425f0eaffa02bc871cad9b65b75c54cd3b07a2c9c48dc6053226"
target_path: /home/user/Projectx/src/components/dashboard/DashboardV4.tsx
timestamp: 2026-10-05T12-31-45Z
slug: src-components-dashboard-dashboardv4-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

# Critique — ramo Nuovo impasto (Diretto) dall'inizio alla fine: 24/40

Prima volta sull'intero ramo (le critique precedenti riguardavano solo la dashboard: 19 → 26 → 25 → 27). Il monitor migliora; il ramo completo mostra incoerenze tra le viste.

| # | Euristica | Voto | Problema chiave |
|---|---|---|---|
| 1 | Visibilità dello stato | 3 | Monitor eccellente; il riepilogo non dice mai quando inforni |
| 2 | Mondo reale | 3 | Termini interni a vista: kRatio, "upcoming", validationStatus, cordierite_refrattaria |
| 3 | Controllo | 3 | Annulla ovunque; conferma di fase sotto il footer |
| 4 | Coerenza | 1 | Tre orari di cottura diversi; acqua 21,0 °C al passo 4 e 3,9 °C al passo 8 |
| 5 | Prevenzione errori | 2 | Passo 7 accetta durate ~3h corte senza dirlo; TC su Napoletana contestato dopo l'avvio |
| 6 | Riconoscere | 3 | Chip descrittivi, riepilogo completo |
| 7 | Flessibilità | 2 | Nessun "a che ora inforni" nel wizard; "Ho infornato" solo a PRONTO |
| 8 | Minimalismo | 3 | Riepilogo ripetitivo, formula dell'acqua in primo piano |
| 9 | Recupero | 2 | Modale fuori protocollo contraddittorio; Forno "NON FATTIBILE" + "CONSIGLIATO" |
| 10 | Aiuto | 2 | Poche spiegazioni sulle scelte che pesano |

## Priorità
- [P0/P1] Tre orari di cottura (passo 7 = somma fasi, dashboard = motore, Rotta = piano + slittamento).
- [P0/P1] Acqua: passo 4 durata 0 (modello legacy, 21 °C), passo 8 e sessione 12 min (3,9 °C): input sovrascritto in silenzio.
- [P0/P1] TC su Napoletana: scelta del wizard sospesa da un modale con testo sbagliato; la conferma non è salvata nel DB e dopo il reload torna tutto TA in silenzio (notifiche comprese).
- [P1] "Ho infornato": bakedAt/readyAt non salvati fino a "Fine · salva": un reload perde l'infornata.
- [P1] Conferma di fase sotto il footer; Forno che si contraddice.
- [P2] Aggiusta rotta: lo slittamento non ha effetto e le modifiche non sono salvate; "Ho infornato" solo a PRONTO; Termina senza infornata salvato come completata; focus perso (annulla fase, modale, Termina, voto, annulla eliminazione); Rotta: 3 slider senza nome, "←" 10×19.
- [P3] "Puntata TA –" nel riepilogo; testo < 11 px (Forno, Rotta, acqua); ore decimali; τ non spiegato; caratteri fuori scala (26 + molti px non rilevati); pulsing-dot infinito; peso panetto 275 vs 278 g.

## Persone
- Esperto: numeri senza origine (C_attrito senza durata, kRatio −29% senza modifiche).
- Professionista: nessun orario di servizio nel wizard; tre orari; Storico senza protocollo.
- Di fretta: prima schermata "~3h dopo il piano", modale bloccante in TC, "Farine e prefermenti" nel Diretto.

## Domande
1. Il wizard deve chiedere "a che ora vuoi infornare?" e proporre le durate, invece di far scegliere durate che il motore sa sbagliate?
2. Alla fine, "obiettivo 06:30 (+3h 50m)": verdetto sull'utente o racconto della pizza?
