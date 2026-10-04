# Impeccable — Audit e Polish (PizzaMatrix)

**Contesto:** `PRODUCT.md`, `DESIGN.md` e `.impeccable/design.json`. Il riferimento visivo è la skin BANCO, secondo la direzione "La Brace che Misura".

**Metodo:**
- Rilevatore `impeccable detect` su `index.html` e `src`.
- Screenshot di tutte le viste a 390×844 e 1280×800, ottenuti guidando l'app reale: Home → Wizard 8 passi → Dashboard → Rotta → Forno → Storico → Planner.
- `tsc` più l'intera suite di test.

## Punteggio

| # | Dimensione | Prima | Dopo | Nota |
|---|---|---|---|---|
| 1 | Accessibilità | 2 | 3 | Wizard bloccato senza spiegazione; etichette a 8.5–9px; toggle malto sotto i 44px |
| 2 | Performance | 3 | 3 | Restano transizioni di `width` sulle barre di avanzamento (impatto basso) |
| 3 | Responsive | 3 | 3 | Colonna mobile da 430px coerente; target da 44px quasi ovunque |
| 4 | Theming | 2 | 3 | Palette Tailwind e flat-UI mescolate ai token |
| 5 | Integrità di implementazione | 2 | 3 | Barre laterali colorate, testi duplicati, numeri e stati mal formattati |
| **Totale** | | **12/20** (accettabile) | **15/20** (buono) | |

## Corretto in questo passaggio

### P1
- **Wizard: Continua disabilitato senza motivo** (passi 1, 2 e 5 partono senza selezione). Ora sopra il bottone c'è un messaggio `role="status"` collegato con `aria-describedby` (es. "Scegli uno stile per continuare"). File: `src/components/wizard/WizardView.tsx`.
- **Testo sotto i 10px** (8.5, 9 e 9.5px) in Dashboard, Semaforo, LiveHeader, Timeline, grafico Gompertz e Forno. Portato a 10px.
- **Toggle "Malto diastatico"**: era alto circa 24px e non aveva `aria-expanded`. Ora è alto 44px e ha `aria-expanded`.

### P2
- **Riepilogo:** mostrava "6.0 panetti", "1000.0 g", "2.0 %". `Metric` ora mostra gli interi senza decimali (`src/components/ui/index.tsx`).
- **Planner, formula dell'acqua:** mostrava un numero grezzo (`26.00249117169833`). Ora è arrotondato (`WaterTempView.tsx`).
- **Intestazione del grafico:** diceva "20.0°C TA · TA". Ora non ripete il protocollo quando è tutto TA (`src/engine/outOfProtocol.ts`).
- **Cella sbollatura:** ripeteva "SBOLLATURA sbollatura +2.5h…". La parola ora compare solo nell'etichetta.
- **Storico:** lo stato era scritto in inglese ("active"). Ora è in italiano: in corso, completata, interrotta, pianificata.
- **"Termina sessione"** era l'elemento più saturo dello schermo. Ora è un bottone quieto con contorno rosato. Il rosso pieno resta solo su "Conferma".
- **Palette Tailwind** (#22c55e, #ef4444, #eab308, #2dd4bf, #60a5fa, #14b8a6, #9ca3af, #fca5a5) e **#555**, che è sotto AA: ricondotti ai colori di DESIGN.md. File: `feedback.tsx`, `PrefermentCreditCard.tsx`, `BakeView.tsx`, `FermentationPlannerView.tsx`, `FermentationTimeline.tsx`, `WizardView.tsx`.
- **Barre laterali colorate** da 3–4px (AlertBadge, Advisory, card dei pre-fermenti, pannelli del Forno). Sostituite da un bordo pieno tinto da 1px.

### P3
- Tolte le etichette di versione dal testo dell'interfaccia: "Sale v2.4:" → "Effetto sale:", "Malto diastatico (v2.4.0)" → "Malto diastatico".
- Applicato il tema anche alle parti disegnate dal browser: `::selection`, `caret-color`, `accent-color`, `color-scheme: dark`.

## Rimasti, come scelte intenzionali o lavoro futuro

Li ho lasciati così di proposito:
- **Pallino "LIVE" pulsante:** indica un motore che avanza davvero, quindi ha un significato e non è decorazione.
- **Glow critico sul testo:** fa parte del linguaggio di stato documentato in DESIGN.md.

Da fare in un passaggio successivo:
- **Transizioni di `width`** su ProgressBar, CoverageBar e meter: sono elementi piccoli. Si possono convertire in `transform: scaleX` con `/impeccable optimize`.
- **Due skin:** Wizard, Planner, Rotta e Storico usano ancora `Card` Classic. La convergenza completa su `.pm4-panel` è un intervento strutturale più ampio (`/impeccable polish wizard` come prossimo passo).
- **Disordine di scala:** circa 39 dimensioni di font e 63 valori di padding inline. Va affrontato con `/impeccable typeset` e `/impeccable layout` dopo la convergenza delle skin.
- **Colore "Cenere"** (#837049, 4.2:1): sotto AA per il testo piccolo. Va usato solo per elementi non essenziali, oppure va alzato.
- **Versione incoerente:** README dice v2.4.25, UI e package dicono 2.4.0. È una decisione di prodotto ancora aperta.

## Passaggio 2: convergenza Classic → BANCO

Il passaggio è stato fatto alla fonte, nei primitivi condivisi di `src/components/ui/index.tsx`, così Wizard, Planner, Rotta e Storico cambiano pelle senza toccare layout né comportamento.

- **`Card`** è un pannello BANCO: `.pm4-panel` con gradiente caldo, bordo `--pm4-line` e profondità fresata. Il reveal sfalsato resta.
- **`S.label`** usa il registro dei canali: Crusca, 11px, tracking 0.14em.
- **`S.unit`** è in Terra d'Ombra.
- **`Btn` secondary** e **bottoni secondari della Home** sono ghost BANCO, con hover brace.
- **`SnapButtons` inattivi** e **input** usano bordi caldi `--pm4-line-strong` al posto del bianco trasparente.
- **Substrato BANCO** (brace e griglia incisa) su tutte le viste, tramite `<main className="pm4-root">`. La dashboard mantiene il suo.
- **Bordi bianchi inline** nelle 4 viste sostituiti da `--pm4-line` e `--pm4-line-strong`.
- **"Cenere"** alzato da #837049 (4.2:1) a #907c52: 4.9:1 sul fondo, 4.5:1 sul pannello.

Punteggio stimato dopo il passaggio 2: **Theming 3→4**, **Integrità 3→4**. Totale **17/20**.

## Passaggio 3: critique della dashboard live e correzioni

**Critique** (doppio agente; snapshot in `.impeccable/critique/`): **19/40**, con 2 problemi P0, 2 P1 e 1 P2. L'utente ha scelto come priorità "sicurezza e verità", per il momento PRONTO una "celebrazione sobria", come scope "tutto", e come vincolo di non toccare il motore di calcolo.

**Corretto**, solo nella presentazione e nelle interazioni (nessuna formula toccata; le funzioni del motore sono solo lette):

- **[P0] Skip di fase:** toccare una fase futura ora apre una conferma con l'impatto ("PUNTATA accorciata di 8h · cottura 14:50 invece di 22:49"). Dopo la conferma, un "↶ Annulla" resta disponibile per 10 secondi (`snapshotPhase` / `restorePhase` in `useTickEngine`). I marker sono raggiungibili da tastiera.
- **[P0] "Quando inforno?":** il protagonista è l'orario di pronto ("~23:07 · tra 1h 45m"), calcolato con `sweetSpotMaturation` e la stessa soglia del semaforo; in frigo segue il piano. A picco raggiunto mostra "ORA" e la finestra residua prima della sbollatura. Il pannello Sweet spot è stato fuso nel protagonista; l'header mostra l'orario di cottura al posto delle ore decimali.
- **[P1] Semaforo:** nuovi stati di presentazione IN CORSO (farina), QUASI PRONTO (brace) e PRONTO DA INFORNARE (verde, con un solo respiro all'ingresso). C'è un avviso "quasi pronto" nell'header. Il giallo e il rosso restano riservati alla W. Un `aria-live` annuncia "Quasi pronto" e "Pronto per infornare".
- **[P1] Fine sessione:** il testo falso "I dati NON saranno salvati" è sostituito da "Verrà salvata nello Storico", con Annulla a sinistra. A picco raggiunto il bottone principale è "🍕 Ho infornato", che registra l'esito (`outcomeRating`); lo Storico lo mostra.
- **[P2]** Monitor come vista di default; toggle alto 44px; header e footer di nuovo fissi (`#root overflow-x: clip`); slider della T ambiente dietro "Modifica T ambiente"; wake lock in Monitor, così lo schermo resta acceso.
- **Minori:**
  - avanzamento reale sulla timeline (non più fisso al 42%);
  - refuso APPRETTO;
  - hook spostato prima del `return` anticipato;
  - colori a token;
  - `Collapsible` accessibile;
  - nel Forno, testi non più resi tenui con l'opacità e target da 44px;
  - etichette del grafico W a 10px;
  - rimossi il glow decorativo su logo e valori e il componente `ProgressBar` inutilizzato;
  - azione "Aggiusta rotta →" sugli avvisi strutturali.

**Verificato nel browser:**
- conferma, annullamento e ripristino della fase;
- header e footer fissi dopo lo scroll;
- testo della chiusura;
- passaggio IN CORSO → QUASI → PRONTO avanzando l'orologio di 2 ore alla volta;
- comparsa di "Ho infornato".

**Rimane:** glossario e spiegazioni inline per "2-clock", t_crit e Newton τ (`/impeccable clarify`, testi di dominio da validare); `transition: width` nella `ProgressBar` di `ui/index.tsx` (`/impeccable optimize`).

## Passaggio 4: clarify (testi della dashboard e dei modali)

L'utente ha scelto: parole chiare più un "?" con la spiegazione; spiegazioni approvate così come proposte; scope limitato a dashboard e modali.

**Gergo del motore sostituito da italiano chiaro.** I termini da fornaio restano (puntata, appretto, W, sbollatura, TA/TC):

| Prima | Dopo |
|---|---|
| `STATO · 2-CLOCK` | `STATO` |
| `STRUTTURA · DECAD. W` | `FORZA DEL GLUTINE (W)` |
| `TERMICA · CUORE IMPASTO · Newton τ` | `TEMPERATURA` |
| `CURVE & CRONOLOGIA` | `ANDAMENTO` |
| `W₀ → W` | `W iniziale → ora` |
| `t / t_crit` | `Usura glutine` |
| `t/t_crit · t_crit 95h` | `limite di stesura tra ~94h 56m` |
| `MATUR.` / `LIEVIT.` | `Maturazione` / `Lievitazione` |

**Sbollatura e temperatura a cottura**, ora in frasi complete:
- `sotto-proof` → "non prevista: a questa T il lievito non arriva al picco";
- "nessuna nelle prossime 48h a 20°C";
- "2h 30m dopo il picco di lievitazione, a 20°C";
- `a cottura … (≥ 18°)` → "cuore a cottura 20.4° · ok (min 18°)".

**Spiegazioni a richiesta.** I canali 01–03 hanno un "?" (target 44px, `aria-expanded`) che apre una riga di spiegazione: i due orologi, l'usura del glutine, la temperatura al cuore.

**Avvisi nell'header** composti con l'ETA: "Quasi pronto · tra ~23 min" e "Pronto per infornare · ancora ~Xh prima della sbollatura". Quando l'orario target è passato, l'header mostra "23:04 · superato" invece di "🍕 ora". Quel testo contraddiceva il semaforo, che diceva ancora "quasi pronto".

**Altri testi aggiornati:**
- "Trascorso" ora è nel formato "11h 00m".
- La legenda del grafico dice "prima di «ora» il registrato, dopo la previsione".
- Modale fuori protocollo: "❄ Aggiungi la fase in frigo" e "Resta tutto a temperatura ambiente".
- Modale collasso: "Termina · salva nello Storico".

**Non toccati:** i messaggi di allerta strutturale prodotti dal motore (vincolo: nessuna modifica al motore) e i termini di dominio.

**Verifica:** typecheck e test verdi; rilevatore senza segnalazioni non advisory sui file modificati; nel browser i "?" aprono le spiegazioni e gli avvisi seguono l'avanzare del tempo.

## Verifica
- `tsc --noEmit`: nessun errore.
- `npm test`: 256 test vitest, 154 test engine, 285 test di stress e 1001 asserzioni di fuzz, tutti superati.
- Nuovo giro di screenshot su tutte le viste, mobile e desktop: nessun errore in console imputabile all'app.
- Rilevatore sui file modificati: restano solo le eccezioni intenzionali e le transizioni di `width` descritte sopra.
