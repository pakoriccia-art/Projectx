---
target: Dashboard, Aggiusta rotta, Storico
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/home/user/Projectx/src/components/dashboard/DashboardV4.tsx"
target_fingerprint: "sha256:2b0a7b597ba68940065a08efb5b11040acfc327ed31d4753b7e48508bcd0c127"
target_path: /home/user/Projectx/src/components/dashboard/DashboardV4.tsx
timestamp: 2026-10-05T18-52-46Z
slug: src-components-dashboard-dashboardv4-tsx
---
## Passaggio 32: critique Dashboard, Aggiusta rotta, Storico (25/40)

Metodo: due agenti (design review sull'app reale a 390 e 360 px; detector CLI + overlay nel browser + misure a11y). Solo rapporto, nessuna modifica al codice.

Nielsen: stato 3 · mondo reale 2 · controllo 3 · coerenza 2 · prevenzione 2 · riconoscimento 3 · efficienza 2 · minimalismo 2 · recupero 3 · aiuto 3.

P1:
- Rotta mostra ore decimali grezze ("Freddo in corsa 11.063376624540334h", anche in `aria-valuetext`): `SliderInput` (`src/components/ui/index.tsx:195-202`) stampa il valore com'è; le durate arrivano dal Planner non arrotondate.
- Anteprima kRatio contraddittoria: con la temperatura invariata "0.919 → 0.653 · −29%" e "Δ picco 0.0h" (`RottaView.tsx:66-71`: l'attuale usa la T dell'impasto, il nuovo la T ambiente); "upcoming" grezzo (`:181`, `:198`).
- Rotta TC: tre controlli sulla stessa durata del frigo ("Sposta la cottura", "Freddo in corsa", "Appretto TC" condividono `localTcH`); "Applica" sotto la piega (pagina 1585 px); "Applica" attivo anche senza modifiche.
- Dopo l'infornata "obiettivo 07:11 domani (−12h 30m)" mentre la dashboard ha sempre detto ~10:27 (`DashboardV4.tsx:885-889`, in TA usa la fine delle fasi).

P2:
- Giorni in cinque formati ("domani", "mar 10:27", "gio", "05 ott", giorno lungo); nello Storico l'infornata non ha il giorno; a 360 px la timeline TC tronca "COTTUR".
- Footer Termina: "Ho infornato, chiudi" anche con l'impasto in frigo 18 h prima; con l'annulla fase ancora attivo due "Annulla" impilati.
- Conferma dell'infornata anticipata: "Sì, infornata" in brace e "Aspetto" ghost al 5% di maturazione.
- Rotta TA: dice "l'orario lo decide la maturazione, cambia la temperatura" e sotto offre tre slider di durata.
- "←" di Rotta: 10×19 px, senza `aria-label`.

P3: testo a 10.88 px in Rotta (T attuale/proposta) e unità a 10.2 px; Rotta in font di sistema nel blocco cottura; temperatura ambiente fino a −2°C; "⚠ 1 avvisi"; stati COMPLETATA/INTERROTTA dello Storico dello stesso colore; marker della timeline focusabili dopo l'infornata; gradiente rosso del danger fuori palette (`DashboardV4.tsx:1235`); glow e easing a rimbalzo segnalati dal detector.

Punti di forza: il focus non finisce mai sul body; le conferme dicono le conseguenze ("Cottura prevista 14:11 domani invece di 22:00 domani"); target ≥ 44 px e contrasto ≥ 4.5:1 su dashboard e Storico; nessun overflow a 360 px.
