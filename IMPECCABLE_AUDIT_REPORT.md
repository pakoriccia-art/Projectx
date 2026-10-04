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

## Passaggio 5: polish e nuova critique

**Polish:**
- Niente pannelli annidati: grafico "04 · Andamento" e Profilo impasto ora vivono in un solo pannello.
- `QualityProfileCard` estratto in un file suo (stesse formule, usa `buildPiecewiseData`); eliminata `DashboardView.tsx` (1245 righe di codice morto) e `ProgressBar`.
- Grafico: legenda su una riga, etichette non tagliate, soglia allineata al profilo di stile (80%), transizioni senza testo sovrapposto.
- Colori riportati ai token (Scioglievolezza, ❄ senza glow).

**Nuova critique (dual-agent): 26/40, prima 19/40.** Rilevatore CLI: 73 → 30 segnalazioni, 2 non advisory intenzionali. Nessun target sotto 44px; contrasto ok in Monitor e Analisi.

**Aperti (per un prossimo giro):**
- P0: le fasi pianificate passano senza avviso e, una volta scadute, non si possono più toccare dalla timeline.
- P1: l'eroe non si legge in 1s a 1m (etichetta "Pronto per infornare" sopra IN CORSO, readout 35px); l'header mostra l'orario del piano invece della previsione.
- P2: verde usato anche per stati non pronti; chiusura della sessione senza riepilogo.
- P3: a11y dei modali, testo a 10px, contrasto della timeline a PRONTO.

## Passaggio 6: correzioni della seconda critique (P0–P3)

Scelte dell'utente: banda + notifica per le fasi, header sulla previsione, voto dopo l'assaggio, tutto da P0 a P3. Motore non toccato.

- **P0, fasi pianificate.** Quando arriva l'orario di una fase, sopra il blocco centrale compare "È ora dello staglio · Tra 15 min / Fatto ora", con l'anteprima della nuova cottura e l'annulla di 10s. La notifica locale è programmata in anticipo all'orario della fase, così arriva anche a telefono bloccato; "Tra 15 min" ne programma un'altra. Nella timeline la fase in ritardo resta toccabile ("in ritardo", brace). Logica in `src/lib/phaseDue.ts`, con test.
- **P1-a, leggibilità.**
  - Etichetta "Inforni alle" / "Inforna".
  - Orario a 60px in Monitor, con il giorno come suffisso ("domani").
  - Toggle Monitor/Analisi spostato sotto la risposta; "?" dentro il pannello.
  - LED a 14px, testo minimo 11px.
- **P1-b, un solo orario.** Header e blocco centrale mostrano la stessa previsione. Il "piano" è la cottura corrente della timeline, senza più "superato". Una sola fase corrente nella strip. I ribbon di quasi pronto / pronto sono rimossi perché ripetevano il blocco centrale.
- **P2-a, verde solo per "pronto".** Celle secondarie, fasi fatte, linea di avanzamento, pallino "live", curva del glutine e stato W ok passano a farina, terra d'ombra o brace.
- **P2-b, finale.** "Ho infornato" registra ora reale, piano e maturazione, e mostra un riepilogo con annulla. Il voto si dà dopo l'assaggio: promemoria a +30 min e chip nello Storico. La tenuta ("regge fino a ~HH:MM") è visibile già prima del pronto. "Aggiusta rotta" resta disponibile anche a PRONTO.
- **P3, accessibilità.**
  - Modali con `role="dialog"`/`alertdialog`, `aria-modal`, focus intrappolato e restituito.
  - "Continua a monitorare" e "Resta a temperatura ambiente" a 44px.
  - Il codice "ta_only" sostituito da parole; messaggio della fase bloccata non più tagliato.

**Verifica:** typecheck e test verdi (incluso il nuovo `phaseDue.test.ts`). Percorso completo nel browser con orologio simulato, senza errori in console: banda, rinvio, "Fatto ora", PRONTO, infornata, annulla, Storico, voto. Rilevatore sulla dashboard: 30 → 24 segnalazioni, le stesse 2 non advisory intenzionali.

## Passaggio 7: terza critique (25/40)

Andamento sulla dashboard: 19 → 26 → 25. Le correzioni del passaggio 6 tengono (banda della fase, orario a 60px, annulla, verde quasi solo a "pronto", 0 target sotto 44px, 0 fallimenti di contrasto). Il percorso completo però ha fatto emergere problemi nuovi:
- **P0, due risposte a "quando inforno?".** Il blocco centrale usa la maturazione. Header ("piano"), cottura in timeline e anteprima della banda usano la fine della timeline pianificata, che si sposta di ore a ogni fase registrata.
- **P1:**
  - dopo "Ho infornato" il blocco centrale e l'annuncio per screen reader restano su "Inforna · ORA";
  - la timeline mostra orari pianificati superati;
  - "Fatto ora" non accetta l'orario reale;
  - il modale di collasso mette il focus su "Termina".
- **P2:** Storico ancora Classic (cestino senza conferma, voto non modificabile); `role=status` con pulsanti dentro; banda dello staglio non annunciata.
- **Detector:** 24 segnalazioni. Il verdetto "glow solo negli stati critici" è stato corretto: alcuni glow cromatici restano anche negli stati normali.

## Passaggio 8: correzioni P0 e P1 della terza critique

Scelte dell'utente: un solo orario (la previsione) con il piano come scarto, finale che racconta la sessione, perimetro P0 + P1. Motore non toccato.

- **P0, un solo orario.** Header, blocco centrale e COTTURA nella timeline mostrano la previsione. Il piano delle fasi compare solo come scarto in parole sopra i 30 minuti ("~3h prima del piano"). Il "?" spiega la differenza. Le anteprime di banda e conferma dicono "la previsione resta ~00:46 · il piano delle fasi va alle 04:19"; in frigo resta "vale il piano".
- **P1, finale.** Nuovo campo `readyAt`, registrato al primo PRONTO. Dopo "Ho infornato" il blocco centrale diventa "Infornata alle 00:57 · pronta dalle 00:40 · +17 min", con badge INFORNATA. Lo screen reader annuncia "Infornata registrata" e la timeline risulta tutta fatta. Lo Storico mostra "infornata · pronta dalle".
- **P1, timeline.** Le fasi mostrano l'inizio reale del loro segmento (APPRETTO 23:57 come la banda). "In ritardo" scatta solo dopo 5 minuti. Dopo l'infornata la COTTURA mostra l'orario reale.
- **P1, orario reale.** "Fatto alle 19:57" registra la fase all'orario previsto quando l'ambiente non cambia (TA → TA). Verso o dal frigo si registra adesso, e la banda lo dice.
- **P1, modale di collasso.** Ordine dei pulsanti: "🍕 Inforna adesso" (a fuoco all'apertura), "Continua a monitorare", "Termina senza infornare".

**Verifica:** typecheck e test verdi, con nuovi test per lo scarto e per la transizione all'orario reale. Percorso completo nel browser, senza errori in console. Rilevatore sulla dashboard: 24 → 21 segnalazioni, le stesse 2 non solo informative.

## Passaggio 9: correzioni P2 e P3 della terza critique

- **Storico in stile BANCO.**
  - Ogni card racconta la sessione: "04 ott · 11:56 → infornata 00:56 · pronta dalle 00:39 · 13h 00m". Le celle mostrano maturazione, usura W, farina e agente.
  - L'usura W ora è vera: `persistSession` salva la W finale, prima mancante, per cui lo Storico mostrava sempre 0%.
  - Il voto si può cambiare ("🍕 buona · cambia").
  - Eliminazione con conferma in linea e "↶ Annulla" per 10 secondi; il database si cancella solo allo scadere.
  - Gli errori di salvataggio sono mostrati (`role="alert"`) e il cambiamento viene annullato.
  - "←" ha un'etichetta per lo screen reader e il titolo è un `h1`. Lo stato vuoto non cita più IndexedDB.
- **Pannello "Conferma cambio fase".** È un gruppo etichettato, non più un dialog senza focus. All'apertura il focus va sul titolo, Esc annulla, alla chiusura il focus torna al marker.
- **Bagliori.** Solo nel collasso. Via quelli sul valore del semaforo, su "Usura glutine", sulla fase corrente (ora un anello) e sul pallino "live".
- **Colori e testo.** Profilo impasto in scala calda (farina / brace bassa / brace). Pulsante del modale fuori protocollo sui token. Grafico con i token, testo a 11px e asse "h trascorse". Didascalie a 11px.

**Verifica:** typecheck e test verdi. Nel browser:
- focus del pannello e uscita con Esc;
- Storico: voto, cambio voto, elimina → annulla → elimina → la sessione resta eliminata dopo aver riaperto lo Storico;
- nessun errore in console.

Rilevatore su dashboard, Storico e index.html: 20 segnalazioni, le stesse 2 non solo informative volute.

## Passaggio 10: quarta critique (27/40)

Andamento: 19 → 26 → 25 → 27, al limite tra "accettabile" e "buono". Gli orari di header, blocco centrale e timeline ora coincidono in ogni stato. Banda, "Fatto alle", racconto dell'infornata, focus del pannello di conferma e Storico funzionano. 0 target sotto 44px, 0 contrasti insufficienti.

Aperti:
- **P1-a.** Registrare lo staglio all'orario giusto lo allunga a 4h e l'annulla non ripristina lo stato. Causa probabile: la sessione attiva non ha la timeline in memoria e la transizione la ricostruisce dall'orario.
- **P1-b.** Il 🍕 del grafico usa ancora il target del wizard; lo scarto dal piano è ripetuto tre volte già dal minuto zero.
- **P2.** Restano i glow dei LED e del pallino corrente; lo Storico non confronta previsione e realtà; il focus si perde dopo alcune azioni.

## Passaggio 11: correzioni P1–P3 della quarta critique

Scelte dell'utente: scarto dal piano in un solo punto con un'azione, Storico come calibrazione minima, perimetro P1–P3. Motore non toccato.

- **P1-a, bug della transizione di fase (confermato e corretto).** La sessione partiva in memoria senza timeline e senza `id`, che venivano scritti solo nel database. Gli effetti:
  - ogni cambio di fase ricostruiva la timeline dall'orologio, per cui lo staglio durava 4h invece di 30 min;
  - l'annulla ripartiva da un'altra timeline;
  - i cambi di fase non venivano mai salvati;
  - la chiusura creava un secondo record.

  Ora `WizardView` avvia la sessione con la sua timeline e riceve l'`id` da `startSession`. Verificato nel browser: staglio di 30 min, l'annulla ripristina la banda, la timeline è in IndexedDB, un solo record.
- **P1-b, orario unico.** Il 🍕 del grafico va sulla previsione. Lo scarto dal piano esce da header e timeline e resta solo sotto l'orario grande, con "Aggiusta rotta →". Le anteprime dicono "L'orario di cottura non cambia: ~03:05". L'aiuto spiega cosa guardare nel panetto.
- **P2:**
  - niente più alone sul pallino della fase corrente e sui LED; tolte due classi CSS morte;
  - il pannello di conferma si apre sotto la timeline toccata;
  - il focus non si perde mai: dopo "Fatto ora" va su "↶ Annulla", dopo "Ho infornato" sul titolo "Infornata alle", dopo l'annulla su "Ho infornato", nello Storico su "Annulla" o "↶ Annulla";
  - Storico: riepilogo "Come ti viene di solito" per stile (scarto medio dal pronto, voto medio), "pronta dalle … (+N min)" in ogni card, chip del voto a 44px, un solo `h1`.
- **P3:**
  - "Termina senza infornare" chiede un secondo tocco;
  - la pill dell'header dice "Infornata";
  - niente 🔒 sulla COTTURA;
  - le etichette della timeline sono su due righe volute (nome / TA).

**Verifica:** typecheck e test verdi; percorso completo nel browser senza errori; rilevatore su dashboard, Storico e index.html: 20 → 17 segnalazioni, le stesse 2 non solo informative volute.

## Passaggio 12: ripresa della sessione e test sul telefono

- **Ripresa all'avvio (nuovo `useSessionRestore`).** Prima l'app non ricaricava mai la sessione attiva: se Android la chiudeva durante la lievitazione, la sessione spariva dalla dashboard. Ora:
  - `useTickEngine` salva una fotografia dello stato del tick (`lastTickState`) ogni minuto, a ogni cambio di fase e quando l'app va in background;
  - alla riapertura la sessione riparte, e il tempo trascorso viene recuperato a passi di 15 minuti (`src/lib/catchUp.ts`, con test). Le formule sono le stesse del motore, che non è stato toccato;
  - lo stesso recupero vale tornando alla dashboard da Forno o da Aggiusta rotta (prima quelle ore si perdevano).
- **Storico.** Nasconde i record ancora "active", compresi gli orfani lasciati dal bug dell'`id`.
- **Debug della WebView.** In `capacitor.config.ts` resta abilitato solo nelle build di debug (default di Capacitor), così il test può collegarsi.
- **`scripts/test-telefono.ps1` + `scripts/test-telefono.mjs`:**
  - compila e installa l'app sul telefono in debug USB;
  - verifica staglio (+30 min), annulla, salvataggio in IndexedDB, ripresa dopo chiusura forzata, Storico e non-ripresa dopo Termina;
  - screenshot in `test-results/telefono`.

**Verifica nel browser:** dopo una ricarica la sessione riprende; con 3h simulate ad app chiusa la maturazione passa da 4,5% a 20,6%; dopo Termina la sessione non risorge e nello Storico c'è un solo record.

## Passaggio 13: critique del ramo "Pianifica fermentazione" (15/40)

Primo giro sul planner e sul passaggio planner → wizard → dashboard.
- **P0-1:** la modalità Servizio non avvia la sessione. Il planner passa `temperingH` e la validazione del wizard lo rifiuta, mostrando un errore Zod grezzo in inglese.
- **P0-2:** la soglia scelta nel planner viene ignorata dalla dashboard, e PRONTO "Inforna ORA" si accende con l'impasto in frigo a 4°C, 20 ore prima del piano.
- **P1:** il piano si deforma nel passaggio (riscaldo 2.4 → 5.9h, "modificato manualmente", modale fuori protocollo su un piano col frigo). Nel planner il risultato sta in fondo, ci sono 4 CTA uguali e lo stato si perde tornando dal wizard.
- **P2/P3:** testi incoerenti ("3/-1", "90%" scritto nel codice, poolish chiamato biga), slider senza nome accessibile, token Classic.

## Passaggio 14: correzioni del ramo Pianifica (P0 + P1 + riordino)

Scelte dell'utente: soglia della sessione, "pronto = infornabile", nessun modale fuori protocollo per i piani del planner, P0 + P1 + riordino.
- **P0-1, Servizio.**
  - `temperingH` è ammesso nello schema; gli errori di avvio sono in italiano.
  - La timeline precomputata viene normalizzata all'avvio: prima arrivava tutta "planned", la puntata in corso veniva proposta all'infinito e le fasi non avanzavano più.
  - Verificato nel browser: target 89% → PRONTO alle 21:06 con il piano alle 21:00.
- **P0-2, soglia e "pronto = infornabile".**
  - `resolveThreshold`: vale la soglia della sessione; il semaforo calcola la maturazione con questa e gli allarmi strutturali restano quelli del motore.
  - `canBakeNow`: mai pronto in frigo né col cuore sotto 18° dopo il frigo. Nuovo stato FREDDO.
  - Con un frigo in programma, in frigo o in riscaldo comanda il piano.
  - Stessa soglia nel grafico e nelle notifiche; il wizard di default usa la soglia dello stile.
- **P1-3, passaggio fedele.**
  - Il wizard usa riscaldo e puntata del planner, con il badge "dal Planner".
  - Niente modale fuori protocollo per i piani del planner con il frigo.
  - Timeline con il giorno e con gli orari reali dei segmenti; niente appretto aggiunto in Qualità.
- **Riordino del planner.**
  - Stato conservato tornando dal wizard.
  - "Quando vuoi infornare?" e "Il tuo piano" (orari assoluti, esito, un solo CTA) in cima.
  - Alternative con CTA ghost e badge di esito (Al target / Sotto / Oltre) al posto di "OK".
  - Acqua di impasto e dettagli tecnici in una sezione comprimibile.
  - Ore leggibili, testi corretti ("TC Appretto", target reali, "3/-1", poolish).
  - Slider e campi con nome accessibile, h1 unico, verdi Classic rimossi.
- **Altro:** countdown "3h60" corretto.

**Verifica:** typecheck e test verdi, con nuovi test di schema, soglia, `canBakeNow` e timeline normalizzata. Nel browser le tre modalità del planner arrivano fino a "Ho infornato", senza errori in console. Rilevatore su `src/components/tools`: 87 → 71 segnalazioni, tutte solo informative (in prevalenza dimensioni del testo fuori dalla scala tipografica).

**Riscaldo allineato (su richiesta dell'utente):** nella modalità Orario il riscaldo del planner ora considera il contenitore, come il wizard e la dashboard (cassetta chiusa di default). Il motore non è stato toccato. Verificato: niente più "inforni a ~12°" all'avvio; PRONTO alle 21:06 con il piano alle 21:00, prima era all'01:07.

## Passaggio 15: seconda critique del ramo Pianifica (23/40, prima 15/40)

Risolti i P0 della prima critique, verificati anche sul telefono (scenario "pianifica" 28/28): il Servizio parte, niente PRONTO in frigo, soglia del piano rispettata, piano intatto dal planner alla dashboard, stato conservato. Rilevatore: 87 → 71 segnalazioni, tutte advisory. Il piano consigliato e il suo pulsante sono ora a ~450–600px, prima a 2.600–3.200px.

Aperti:
- **P1:**
  - Servizio: cottura e soglia calcolate sulla fine del servizio, quindi all'inizio del servizio la dashboard dice "non ancora";
  - il piano scivola in silenzio, e l'anteprima della banda promette "l'orario non cambia";
  - card di Servizio e Qualità da debug, con la risposta in fondo;
  - `pickRecommended` instabile: a dati identici il consigliato cambia tra TC Appretto e TC Puntata.
- **P2:** il wizard al passo 8 non mostra gli orari; senza data il planner propone un piano di 66h con il pulsante attivo.
- **P3:** troppo arancione nella prima schermata; 3 slider della modalità Qualità senza nome accessibile.

## Passaggio 16: pulizia delle sessioni orfane

All'avvio `cleanOrphanSessions` (`useSessionRestore.ts`) usa `classifyOrphans` (`src/lib/orphans.ts`, con 6 test):
- un record "active" senza fotografia, o più vecchio di 72h, con un gemello "completed" viene eliminato: è il doppione del vecchio bug;
- senza gemello diventa "interrotta" e resta visibile nello Storico;
- la sessione da riprendere non viene mai toccata.

Verificato nel browser con record finti; lo script del telefono ora controlla che non restino orfane.

## Passaggio 17: P1 della seconda critique del ramo Pianifica

- **Piano consigliato stabile.** Lo scarto dal target viene arrotondato al punto percentuale prima del confronto, così a parità di dati il consigliato non cambia più tra TC Appretto e TC Puntata.
- **Servizio.**
  - La cottura del piano è l'*inizio* del servizio. Il planner passa `serviceWindowH`, e la dashboard mostra la finestra pianificata "servizio 19:00–21:00".
  - La soglia è la maturazione prevista dal solver a inizio servizio (`atServiceStart`): il target del piano vale a fine finestra.
  - La card del Servizio diventa "Il tuo piano · Servizio": orari assoluti, esito "Fattibile" o "Fattibile, al limite", avvisi in italiano, un solo pulsante. Durate, dose e vincoli sono in "Dettagli".
- **Piano che scivola.**
  - Quando comanda il piano l'anteprima è onesta ("Cottura prevista 20:19 invece di 20:00").
  - Una riga mostra lo scarto dall'obiettivo dell'utente ("obiettivo 20:00 · +50 min · Aggiusta rotta →").
  - Il racconto finale si confronta con l'obiettivo ("obiettivo 20:00 (+1h 07m)").
- **Servizio e Qualità in alto.** Obiettivo e risposta stanno sopra i parametri dell'impasto. Qualità avvisa di preparare prima il prefermento; i suoi 3 cursori hanno un nome accessibile.
- **P2.**
  - Senza data niente piano avviabile ("Scegli giorno e ora della cottura").
  - Il wizard al passo 8 mostra per primi gli orari del piano.
  - "12h 60min" dei suggerimenti del motore diventa "13h" (solo visualizzazione).

**Verifica:** test verdi; telefono 40/40 sulla build precedente; finto telefono 29/29 sulla build nuova; percorsi Orario e Servizio nel browser senza errori.

**Aperto (motore):** nel Servizio il solver calcola il riscaldo senza il contenitore. Nella prova il PRONTO è arrivato ~2h dopo l'inizio del servizio, in parte per ritardi del test nel registrare l'uscita dal frigo. Va allineato nel solver (`engine/serviceWindowSolver.js`), che è fuori perimetro.

## Passaggio 18: prefermento in pratica e prima critique del flusso (25/40)

Biga e poolish con poche scelte (quota, da preparare/già pronta, luogo, durata), ricetta in grammi divisa in prefermento e impasto finale, fase "biga in corso" con conto alla rovescia, segni, notifica e ripresa; l'impasto parte con la durata reale. Telefono: 56/56.

Critique (dual-agent): 25/40, 0 P0, 4 P1 — ricetta incoerente avviabile (acqua o farina dei prefermenti oltre il totale), fase in corso che convive male con altre sessioni o con una seconda fase, dosi della biga assenti nella fase in corso, conferma anticipata e ritardo non calibrati sul rischio. Detector: solo advisory (font fuori scala, in gran parte legacy). Snapshot in `.impeccable/critique/`.

## Verifica
- `tsc --noEmit`: nessun errore.
- `npm test`: 256 test vitest, 154 test engine, 285 test di stress e 1001 asserzioni di fuzz, tutti superati.
- Nuovo giro di screenshot su tutte le viste, mobile e desktop: nessun errore in console imputabile all'app.
- Rilevatore sui file modificati: restano solo le eccezioni intenzionali e le transizioni di `width` descritte sopra.
