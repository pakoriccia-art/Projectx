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

## Passaggio 19: P1 e P2 della critique del prefermento, previsione della biga

- Ricette impossibili bloccate (farina dei prefermenti oltre il 90%, acqua dei prefermenti oltre il totale) con la correzione proposta e annullabile; il secondo prefermento nasce con la quota rimasta.
- Una sola preparazione alla volta (domanda "sostituisco?"), salvata prima di aprirsi; ripresa anche con un impasto in corso e raggiungibile dalla dashboard.
- Fase in corso: dosi del prefermento e acqua alla temperatura giusta, "Dove si trova adesso" (Fresco/Stanza/Frigo), maturazione in % con tempo termico (fArrhenius del motore, solo chiamato); all'impasto entrano ore e temperatura equivalente vissute.
- Conferma anticipata con "Aspetto" in evidenza; ritardo oltre 125% (biga) / 115% (poolish) con titolo, segno di troppo maturo e seconda notifica.
- Servizio fisso o spostato: lo sceglie chi impasta quando c'è un orario di cottura.
- Durata non più reinterpretata in silenzio; orari del Planner coerenti con la fase; pulsante "danger" a contrasto AA.

## Passaggio 20: seconda critique del flusso prefermento (27/40, prima 25/40)

Risolti: ricetta impossibile, fase persa con un impasto attivo, dosi nella fase, conferma anticipata, autolisi, orari planner/fase. Restano 3 P1: due prefermenti seguiti con il nome e le soglie di quello sbagliato, ritardo che non scala col rischio, doppio clic su "Sostituisci" che crea due fasi. P2: due calcoli diversi dell'acqua finale, fasi salvate dalla build precedente, correzione dell'idratazione fuori range di stile, gerarchia dei pulsanti all'inizio, focus perso dopo le conferme. Detector: 0 sul nuovo componente (ma non vede i font numerici), 5 advisory sul codice nuovo del wizard.

## Passaggio 21: P1 e P2 della seconda critique del prefermento

- Due prefermenti seguiti davvero: un orologio per ciascuno; il più lungo parte subito, gli altri all'ora che li fa finire insieme ("Poi: il poolish alle 23:25", promemoria). L'impasto finale riceve ore e temperatura equivalente di ognuno.
- Ritardo per livelli: PRONTA → OLTRE (soglia 125%/115%) → molto oltre (150%) con conferma prima di impastare; banner e riga in dashboard "⚠ Biga oltre da X h".
- Frigo in anticipo: dall'85% "Se non impasti entro le HH:MM, mettila in frigo: regge fino alle HH:MM (+X h)"; notifica un'ora prima; quando è oltre "Mettila in frigo (rallenta)" è l'azione principale.
- Doppio tocco su "Sostituisci" senza doppioni; domanda con il giorno e "Tieni quella in corso".
- Fasi delle build precedenti convertite all'avvio (maturazione e temperatura equivalente corrette).
- Un solo calcolo dell'acqua finale (nella fase in corso, con il prefermento dov'è); correzione della ricetta entro il range dello stile ("Riduci il poolish al 55%").
- "Fatto ✓" principale all'inizio; con un impasto in corso "È pronta" non c'è e si va all'impasto; focus sulle conferme e ritorno al pulsante.

## Passaggio 22: terza critique del flusso prefermento (27/40)

Stesso punteggio della seconda, per motivi diversi: risolti doppio tocco, fasi legacy, correzione nel range dello stile, soglie e ghiaccio; il modello a più orologi apre nuovi errori di attribuzione. P1: stato sintetico (banner, riga, notifiche, conferme) col nome del principale e i numeri del secondo; secondo prefermento non avviato = vicolo cieco; gerarchia sul più lungo invece che sul più urgente.

## Passaggio 23: P1 della terza critique del prefermento

- Stato attribuito al prefermento giusto: il "focus" è quello che va oltre per primo. Titolo, banner, riga in dashboard, notifiche (130 con tutti i nomi, 131 col nome di chi va oltre, 133 sul primo impastato non in frigo) e conferme ("molto oltre" sul più maturo, "in anticipo" sul meno maturo) nominano l'elemento giusto.
- Secondo prefermento non impastato all'ora: card "da impastare (era alle HH:MM)", ritardo, quando sarà pronto se lo impasti adesso e se l'altro regge (con l'opzione frigo); "Procedi senza" con conferma (farina e acqua passano all'impasto finale). Banner "⚠ Poolish da impastare".
- Gerarchia sul più urgente e finestra per l'impasto finale in alto ("Impasto finale tra le … e le …", "Impasta entro le …", oppure "Non sono pronti insieme"). "TROPPO OLTRE" sopra il 150%, CTA "Impasto finale (è oltre)" mai primario insieme al frigo.
- Piccoli: "pronta/pronto/pronti" declinato, "insieme alla biga", etichetta del timer per livello, aria-label sulla riga in dashboard, acqua finale con la temperatura dei prefermenti pesata sulla massa, wizard con il prefermento principale = il più lungo, "Acqua —" invece di 0 g.

## Passaggio 24: P2/P3 restanti della terza critique del prefermento

- Btn condiviso a 44 px (`minHeight` su primario e secondario): tutta l'app, dashboard verificata.
- Passo 8 bloccato: "Vedi la correzione ↑" nel footer porta in vista e mette il focus sulla correzione; dopo averla applicata il focus va su "Impasta …".
- Focus sulla domanda "C'è già … in corso"; "Tieni quella" lo riporta al pulsante principale.
- Avanzato: gruppi "Tipo pre-fermento 1/2"; ogni cambio di tipo che cambia idratazione, lievito o durata lo dice ("Passando a poolish: … (prima …)") con "Ripristina" che rimette il prefermento com'era.
- Fase in corso: l'avvio del secondo prefermento si sposta ("Prima di 1 h" / "Dopo 1 h", mai prima di adesso), con il nuovo orario di pronto e un avviso se cade di notte.

## Passaggio 25: quarta critique del flusso prefermento (28/40)

Risolti i P1 della terza (attribuzione, vicolo cieco del secondo, gerarchia sul più urgente) e i P2/P3 (ritardo scalato, focus, nomi dei gruppi, cambio tipo reversibile, avvio spostabile, Btn 44 px). Nuovi P1: poolish in ritardo con la biga già oltre (testo incoerente, primario sbagliato), CTA dell'impasto finale sotto la piega a PRONTA, notifica di ritardo solo sul primo prefermento. P2: "Sono pronti" in crescita, slider idratazione oltre lo schema, testi delle notifiche 132/133, contrasto "troppo oltre".

## Passaggio 26: P1 della quarta critique del prefermento

- Secondo prefermento in ritardo: testo coerente ("la biga è già oltre da 2 h: aspettare il poolish la porterebbe ancora più avanti", oppure "in frigo la rallenti: regge fino alle …, in tempo") e un solo pulsante principale, quello che conviene: "Metti la biga in frigo e impasta il poolish" se il frigo basta, "Procedi senza il poolish" se no. Il frigo nell'hero diventa secondario.
- Quando è il momento (pronta, oltre) il pulsante dell'impasto finale sta subito sotto l'orario; in crescita dice "Impasto finale adesso", mai "pronti".
- Notifica di ritardo per ciascun prefermento impastato (131/134/135); 132 "insieme" solo se l'orario non è stato spostato; grammatica della 133.

## Passaggio 27: P2/P3 della quarta critique del prefermento

- Slider di idratazione dei prefermenti con gli stessi limiti dello schema (biga 40–55, poolish 95–105, riporto 55–75, autolisi 50–80); messaggi di validazione in italiano.
- "Troppo oltre": testo ad AA (#ff7675), il rosso scuro resta per la barra; etichetta del timer distinta; concordanza "Controllala/Controllalo"; consiglio pratico (usarne meno o rinfrescarla).
- Segni per ogni prefermento impastato; il segno di troppo maturo è una verifica ("Se ha odore pungente…, è oltre"), anche nelle notifiche.
- "PRONTA ALLE" sopra l'orario grande; "Cade di notte" sotto la finestra; banner "non pronti insieme"; "Da impastare adesso" prima di "Fatto".
- Focus dopo "No" e dopo "Ripristina"; "Tieni quella" porta su "← Indietro"; domanda di sostituzione più compatta; "Vedi la correzione ↑" solo se c'è una correzione; "Acqua —" al passo 8; "Anticipa/Posticipa 1 h"; niente doppio "Vai all'impasto in corso"; virgola decimale; secondo prefermento in Avanzato al 25%.
- Caratteri del codice del flusso ricondotti alla scala (0,9rem body, 11px label, 35px readout, 1,4rem headline). Restano le segnalazioni legacy del wizard.

## Passaggio 28: quinta critique del flusso prefermento (28/40)

Risolti i P1/P2/P3 della quarta (CTA in vista, avvisi per ogni prefermento, slider nello schema, contrasto, segni per ogni prefermento, focus). Nuovi P1: il frigo consigliato per il ritardo del poolish porta a "Non sono pronti insieme" (controlla che la biga non vada oltre, non che sia pronta in tempo); quando un prefermento è oltre il primario è il frigo e non l'impasto finale (in troppo oltre nessun primario). P2: "Fatto" non registra l'ora reale, poolish in ritardo senza notifica, impasto finale primario all'81% senza conferma, focus dopo "Fatto".

## Passaggio 29: critique del ramo Nuovo impasto, dall'inizio alla fine (24/40)

Prima critique sull'intero ramo Diretto (wizard → dashboard → Rotta → Forno → Storico); le precedenti valutavano solo la dashboard (27). Il monitor migliora; emergono incoerenze tra le viste: tre orari di cottura diversi, acqua 21 °C al passo 4 e 3,9 °C al passo 8 (durata d'impastamento 0 contro 12 min), TC su Napoletana sospeso da un modale e non salvato (dopo il reload torna TA), infornata non salvata fino a "Fine · salva", Aggiusta rotta senza effetto sull'orario.

## Passaggio 30: P1 delle critique Nuovo impasto (24/40) e Prefermento (28/40)

Nuovo impasto:
- Un solo orario di cottura: passo 7 e riepilogo usano la stessa previsione della dashboard (motore se tutto TA, piano se c'è il frigo), con il giorno; se le durate scelte portano altrove compare "Allunga/Accorcia l'appretto di X" (annullabile).
- Una sola durata d'impastamento (12 min visibili al passo 4): l'acqua è la stessa al passo 4 e al passo 8.
- Il frigo scelto nel wizard è confermato (niente modale dopo l'avvio; nota al passo 7 per gli stili tutto TA); la scelta dal modale è salvata in IndexedDB.
- "Ho infornato" (e il pronto) salvati subito: l'infornata sopravvive alla chiusura dell'app.
- Il pannello di conferma della fase si porta sopra il footer.
- Forno: "Non raggiunge lo stile" + "Il massimo con questo forno"; niente identificatori grezzi.

Prefermento:
- Il frigo per il ritardo del poolish è consigliato solo se porta a una finestra vera (fridgePlan: simula biga in frigo e poolish impastato adesso).
- Oltre e troppo oltre: l'impasto finale è il primario, il frigo il piano B ("Non puoi impastare adesso?").

## Passaggio 31: P2 delle critique Nuovo impasto e Prefermento

- Aggiusta rotta salva subito (IndexedDB) e ritemporizza la timeline (`retimeTimeline`): con il frigo "Sposta la cottura" allunga o accorcia il frigo e la dashboard mostra il nuovo orario, anche dopo la riapertura; tutto TA dice che l'orario lo decide la maturazione. Slider etichettati, soglia iniziale = quella della dashboard.
- "Ho infornato" sempre disponibile: primario al pronto, secondario prima, con conferma (maturazione e orario del pronto).
- Termina senza infornare = "interrotta" nello Storico (niente voto); la conferma lo dice e offre "Ho infornato, chiudi".
- Focus: paracadute globale (se il comando con il focus si smonta, il focus va sul titolo della vista) più destinazioni precise per Termina, Ho infornato, annulla fase, annulla infornata, eliminazione e voto nello Storico.
- Prefermento: "L'ho impastata prima…" registra l'ora reale (fino a 12 h fa) per la biga e per il poolish; il piano si sposta di conseguenza.
- Notifica 136: il poolish non impastato un'ora dopo l'orario previsto.

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

Corretti i P1 (passaggio 33, sotto).

Punti di forza: il focus non finisce mai sul body; le conferme dicono le conseguenze ("Cottura prevista 14:11 domani invece di 22:00 domani"); target ≥ 44 px e contrasto ≥ 4.5:1 su dashboard e Storico; nessun overflow a 360 px.

## Passaggio 33: P1 della critique Dashboard, Aggiusta rotta, Storico

- Durate leggibili ovunque negli slider ("10h 44m", "30 min"), anche per lo screen reader ("7 ore e 51 minuti"): `fmtHours` / `speakHours` in `src/components/ui/index.tsx`.
- Aggiusta rotta riorganizzata attorno alla risposta: in cima "Inforni alle ~22:00 domani · prima ~20:00 domani · +2h".
  - TA: temperatura ambiente e soglia; le durate (che non spostano l'orario) chiuse in "Durate delle fasi", con la spiegazione.
  - TC: "Sposta la cottura" mostra il frigo che ne risulta ("In frigo: 10h 44m → 12h 44m"); tolta la card duplicata "Freddo in corsa".
  - Ritmo confrontato a parità di grandezza (T ambiente adesso contro T proposta): "Matura il 19% più in fretta che a 20°C"; kRatio, picco e stato (in italiano) in "Dettagli del modello".
  - "Annulla / Applica" in una barra fissa in basso; "Nessuna modifica" disattivato finché non cambia nulla. "←" da 44 px con nome; titolo "Aggiusta rotta".
- Dopo l'infornata il confronto è con l'orario che la dashboard mostrava ("prima del pronto: previsto 08:49 domani (−13h 50m)"), non con la fine delle fasi.

## Passaggio 34: P2 e P3 della critique Dashboard, Aggiusta rotta, Storico

P2:
- Un solo modo di dire il giorno, in tutta l'app: orario prima, giorno come suffisso solo se non è oggi ("20:30", "09:46 domani", "09:46 ieri", "09:46 mer" entro sei giorni, "09:46 12 ott" oltre). `fmtDay` / `fmtClockDay` in `src/lib/fmtTime.ts`, usati da dashboard, timeline, Rotta e Wizard (`fmtBakeClock`), prefermento (`fmtWhen`, `fmtClock`) e Planner. Nello Storico l'infornata e il "pronta dalle" prendono la data quando cadono in un giorno diverso dall'inizio ("03 ott · 18:44 → infornata 19:44 5 ott · 49h 00m"). L'header ("COTTURA ~11:28") resta senza giorno: è il readout compatto, il giorno sta nell'hero.
- Timeline a 360 px con 5 fasi TC: marker da 52 px e gap 8, così entrano senza scorrere; se la strip comunque trabocca (6+ fasi) il fade a destra segue l'overflow misurato e la fase corrente viene portata in vista, senza tagliare l'inizio.
- Pannello Termina: "🍕 Ho infornato, chiudi" solo quando si può infornare (`canBakeNow`); in frigo o con il cuore freddo restano "← Annulla" e "■ Termina". La riga "Fase cambiata · ↶ Annulla" si mostra solo nel footer normale: niente più due "Annulla" impilati con Termina, la conferma o l'infornata aperti.
- Conferma dell'infornata anticipata: "Aspetto" in brace, "Sì, infornata" ghost, come già nel prefermento.

P3:
- Storico: "✓ COMPLETATA" in farina, "■ INTERROTTA" in terra d'ombra (segno e colore); "1 avviso" / "N avvisi"; Esc chiude il cambio del voto (torna su "· cambia") e la conferma di eliminazione (torna sul cestino); unità delle celle da 10.2 px a 11 px (`.pm4-cell-v small`).
- Dopo l'infornata i marker della timeline non sono più comandi: niente `tabindex`, niente `role="button"`.
- Rotta: temperatura ambiente da 10 a 38 °C, come il Planner (prima da −2 a 40). I rilievi su testi a 10.88 px, font di sistema e "←" riguardavano la Rotta precedente alla riscrittura del passaggio 33: verificato, non ci sono più.
- Danger pieno con i token `--pm4-danger-hi` / `--pm4-danger-lo` (in `index.html` e nella palette di DESIGN.md), aspetto invariato. Il testo resta `#ffffff`, valore documentato per `button-danger`.
- Via l'easing a rimbalzo (`--ease-spring`, overshoot) dal pulsante primario e dal pollice dello slider: `--ease-out`. Il glow (brace sul brand, pulsazione dell'alert critico) è una firma dichiarata del design system e resta: eccezione intenzionale.

## Verifica
- `tsc --noEmit`: nessun errore.
- `npm test`: 256 test vitest (4 nuovi su `fmtTime`), 242 test engine, 285 test di stress e 1001 asserzioni di fuzz, tutti superati.
- Controllo nel browser a 390 e 360 px, 25 controlli su 25: formati dei giorni in dashboard, timeline, Planner, Wizard e Storico; "Aspetto" in brace; un solo "Annulla"; "Ho infornato, chiudi" assente in frigo; marker senza ruolo dopo l'infornata; badge, plurale ed Esc nello Storico; nessun testo sotto 11 px in Rotta e Storico; timeline TC intera a 360 px; gradiente del danger dai token.
- Rilevatore sui file toccati: spariti i colori fuori palette del danger, l'easing a rimbalzo e il font a 10.2 px. Restano il glow (intenzionale) e le dimensioni di font fuori scala già note.
- Finto telefono, scenario `tutti`: 74/74. Telefono vero (Samsung SM-S931B), scenario `tutti`: 74/74, compresi i force-stop e la riapertura dopo 60 s (dopo i commit `14d4e85` e `73e06cc` allo script: il socket della WebView chiusa non ferma più il giro, e niente `page.close()` prima del force-stop, che lo lasciava appeso).

## Passaggio 35: critique generale dell'app (25/40)

Method: dual-agent (A: design review sull'app reale a 390 e 360 px, con l'orologio avanzato di 3/13/16/22 h · B: detector CLI su `index.html` e `src`, overlay `detect.js` iniettato su 6 viste, misure a11y e responsive su 24 viste × 2 larghezze). Solo rapporto, nessuna modifica al codice. Verificati nel sorgente i due P0 prima della sintesi.

### Design Health Score

| # | Euristica | Voto | Problema chiave |
|---|---|---:|---|
| 1 | Visibilità dello stato | 2 | In una sessione "tutto in frigo" il chip dice "PUNTATA · TC" e il semaforo misura a temperatura ambiente: "regge fino a ~22:22 domani", poi "PRONTO DA INFORNARE · ORA" in verde con l'impasto a 4 °C |
| 2 | Corrispondenza col mondo reale | 2 | "τ × 1.5" sui contenitori, "C=28.1°C" e "C_attrito" due volte al passo 4, "0.5 h"/"65.4 h" nel riepilogo, "1:16" e "~76s" nello stesso pannello del Forno, "ENGINE · FERMENTATION SCIENCE" in Home |
| 3 | Controllo e libertà | 3 | Annulla ovunque e "Aspetto" primario; ma durante una sessione il monitor non ha uscite verso Home, Planner o Storico |
| 4 | Coerenza e standard | 2 | Sei formati di durata; "Usa questo piano / Usa questo schema / Usa questo"; TC senza riscaldo nel Wizard e con "riscaldo 5h 55m" nel Planner; tre famiglie tipografiche |
| 5 | Prevenzione degli errori | 2 | I default sbagliano da soli: passo 7 TA si apre con "l'impasto sarebbe ancora acerbo"; il Forno si apre su "✗ NON RAGGIUNGE LO STILE"; il Planner lascia avviare un piano con lo staglio dopo il forno |
| 6 | Riconoscimento vs ricordo | 3 | Riepilogo completo e "(dal piano)"; τ, C_attrito e "inforni a ~9°" chiedono di ricordare |
| 7 | Flessibilità ed efficienza | 2 | Otto passi obbligatori a ogni impasto, nessun "rifai questa" dallo Storico; nel Planner risposta in cima e input 1.500 px sotto; ogni chip è un tab stop |
| 8 | Estetica e minimalismo | 3 | Monitor essenziale; rumore in Home, al passo 4 e in QUASI PRONTO (cinque elementi brace) |
| 9 | Recupero dagli errori | 3 | "Allunga l'appretto di 3 h 30" in un tocco; ma il chip "inforni a ~9°" e "Sotto il target" non hanno azione |
| 10 | Aiuto e documentazione | 3 | "Cosa significa" sul semaforo, "ipotesi non ancora validata"; nessun aiuto su τ e contenitori |
| | **Totale** | **25/40** | **Solido nel cuore, incoerente ai bordi** |

### Verdetto di design specificity

**LLM (A):** il monitor live è di questo prodotto e di nessun altro: pannelli fresati, canali numerati, il semaforo che risponde con un orario ("INFORNI ALLE ~12:11 domani · tra 15h 46m · regge fino a ~22:19 domani"), i 10 LED, il grafico brace/oro/freddo. Wizard, Rotta e Prefermento parlano la stessa lingua grazie ai primitivi. La firma si perde ai bordi: la Home è uno splash da template (due righe in inglese, un elenco di modelli matematici, 60% di schermo vuoto); lo Storico è un record con quattro numeri e un cestino; il Forno è un form di preset con un pannello rosso; il Planner è un modulo di 3.400 px dove l'unico momento "di misura" sono le colline delle alternative.

**Rilevatore (B):** 153 segnalazioni, 148 advisory e 5 warning. 112 font fuori rampa (0.72rem ×28, 0.78 ×14, 0.75 ×14, 1.1rem ×13; sotto gli 11 px solo 0.65rem ×4 nel Planner e 0.64rem in `PrefermentCreditCard.tsx:76`), 33 colori fuori palette (16 non documentati: il verde Classic `#00b894` in `WizardView.tsx:1419`, i gialli `rgba(253,203,110,…)` ×4 nel Wizard, gli arancio `rgba(253,186,116,…)` ×3 nel Planner, `rgba(255,200,0,…)` ×3 in WaterTemp, il pomello bianco puro `#fff` in `BakeView.tsx:101`, `#bcd9ff` in `BakeView.tsx:253`), 3 transizioni di `width`/`max-height` in `feedback.tsx:175,194,245` (debito già noto), più il pallino live, il glow critico e la griglia incisa: eccezioni documentate in DESIGN.md. Per file: Planner 36, Wizard 36, WaterTemp 25, feedback 11, index.html 10. Il rilevatore ha colto cose che A non ha visto (il bianco puro del toggle del Forno, i gialli Tailwind) e ha mancato ciò che A ha visto: non legge `0.66rem`/`0.68rem` (10.88 px: 21 dichiarazioni nel Wizard e nel Planner), i `fontSize: 10` numerici di `BakeView.tsx` e `MiniHillCurve.tsx`, né il sans di sistema nelle note. Dove concordano: i testi a 10.88 px del passo 4, del passo 8 e del Planner.

**Overlay:** iniezione riuscita (live-server su 8400, poi fermato). Home 4, Wizard 2, Dashboard 3, Rotta 2, Storico 2, Planner 19 (tiny-text ×5, all-caps-body ×2, nested-cards, em-dash ×15, width-transition ×3). Il browser è headless: nessuna scheda [Human] visibile, solo screenshot. L'overlay considera "tiny" sotto i 12 px, DESIGN.md fissa 11: le voci a 11–11.52 px sono conformi.

**Misure (B):** nessun overflow a 390 e 360 px in 24 viste; un `<h1>` e un `<main>` per vista; 0 bottoni senza nome; reduced-motion rispettato (0 animazioni infinite); focus mai sul body dopo le azioni del monitor. Fuori norma: il `select` "Libreria farine" (324×32 px, unico input senza label, `WizardView.tsx:578`), "▸ Parametri avanzati" 38 px, "Torna alla schermata iniziale" del Planner 36 px di larghezza, i campi giorno/ora del Planner 43 px; i sottotitoli "τ × 1 … 3" del passo 6 a 3.42:1; "Continua →" manda il focus sul body ai passi 1→2, 2→3, 4→5 (dove il Continua seguente monta disabilitato); radiogroup senza nome al passo 4 e nel Forno; 4 mini-curve SVG del Planner senza nome; i "Usa questo" disabilitati del Planner a opacità 0.45 invece dello 0.38 documentato. A 360 px il badge "intatta" di "02 FORZA DEL GLUTINE" finisce nel padding del pannello (misura con font di fallback: Google Fonts è bloccato nel sandbox).

### Impressione generale

Il cuore mantiene la promessa: quando si aspetta, l'app dice un orario, quanto manca, fino a quando regge e perché. Attorno al cuore ci sono tre cose che la smentiscono: la sessione in frigo misurata come se fosse sul banco, il Planner che consiglia con quattro stelle un piano che non ci sta, e i default del Wizard e del Forno che si aprono già in errore. L'opportunità più grande è portare la firma del monitor, l'orario come risposta, in Home e Storico.

### Cosa funziona

1. **Il semaforo che risponde con un orario** (`SemaforoCard.tsx`, `DashboardV4.tsx:572-600`): una riga risponde a quando, quanto manca, fino a quando e perché, con cifre tabulari e lo stesso orario in header, hero e timeline.
2. **Le conferme dicono le conseguenze**: "Passi a STAGLIO · TA ora? PUNTATA accorciata di 8h · L'orario di cottura non cambia"; "Non è ancora al punto (maturazione 5%, pronto ~09:27 domani). Infornata lo stesso?" con "Aspetto" primario; ogni conferma ha un annulla con orizzonte dichiarato.
3. **Il prefermento come vista di lavoro** (`PrefermentStageView.tsx`): dosi, "Fatto ✓", "L'ho impastata prima…", "Come capire che è pronta", acqua e ghiaccio per l'impasto finale, e la biga oltre gestita con "Mettila in frigo (rallenta)". È la valle più difficile del prodotto e la meglio scritta. B conferma: target ≥ 44 px, nessun overflow, focus sempre su un titolo.

### Problemi prioritari

**[P0] La sessione "tutto in frigo" è misurata a temperatura ambiente.** Wizard con "TC · Tutto in frigo", 12 h a 4 °C, cottura prevista ~08:58 domani. Dashboard: chip "PUNTATA · TC", ma "IN CORSO ~12:14 domani · regge fino a ~22:22 domani"; a +13 h "QUASI PRONTO"; a +16 h "PRONTO DA INFORNARE · ORA" in verde e la banda "È ora dello staglio · 4h fa" mentre nessuno ha toccato l'impasto; a +22 h il pannello Termina offre "Ho infornato, chiudi". Causa, verificata: `tickState` parte nullo (`AppContext.tsx:183`) e `useTickEngine.ts:113-116` ricade su `phase='bulk_room'` e `tAmbient=tLaboratorio`; `DashboardV4.tsx:492` fa lo stesso, quindi `isColdPhase` è falso e lo stato FREDDO già disegnato non compare mai; `db.ts:298` costruisce bene la timeline con `bulk_fridge` per primo, ma nessuno la legge all'avvio. Perché conta: è il caso d'uso dichiarato (48 h in frigo), viola "The Ready Is Green Rule" e l'app si contraddice sullo stesso schermo. Fix: all'avvio (e nel restore senza `lastTickState`, `useSessionRestore.ts:66`) seminare `phase` e `tempAmbient` dal segmento `current` della timeline; cablaggio UI/hook, il motore non si tocca. Comando: `/impeccable harden`.

**[P0] Il Planner consiglia con quattro stelle un piano che non sta nel tempo, e lo lascia avviare.** Cottura "19:30 mer · tra 46h 58m"; alternativa "TC totale ★★★★☆ · 65h 57m in tutto · Sotto il target" sopra "TC Appretto ★★★☆☆ · Al target". Con "Usa questo" → "Usa questo piano →" il riepilogo mostra "Staglio 14:09 gio · Forno 19:30 mer" e la dashboard "~52h prima del piano delle fasi". Causa, verificata: `FermentationPlannerView.tsx:267,320,344` assegna le stelle da `viability` e dalle ore di frigo, mai dalle ore disponibili; `:483` aggiunge solo il badge. Perché conta: inganna con un segnale di qualità. Fix: un piano che non ci sta non è un'alternativa: nascosto, o senza CTA con "Non ci sta: servono 66h, ne hai 47 · sposta la cottura a gio 14:25 →"; le stelle includono la fattibilità; il riepilogo rifiuta una fase dopo il Forno. Comando: `/impeccable harden`.

**[P1] I default del Wizard contraddicono il modello e il TC non ha il riscaldo.** Passo 7 TA, senza toccare nulla: "Con queste durate inforneresti alle 08:55 domani: l'impasto sarebbe ancora acerbo (~3 h 30 prima del pronto)". Passo 7 TC: solo "FREDDO TOTALE (PUNTATA + APPRETO) 12h" (refuso, `WizardView.tsx:1591`) e "STAGLIO 30 min"; poi in dashboard "❄ inforni a ~9° · 9° sotto i 18° consigliati" senza azione e "STAGLIO 08:28 · APPRETTO 08:28" allo stesso minuto; il Planner per lo stesso stile calcola "riscaldo 5h 55m". Fix: default dell'appretto dal modello (lo stesso calcolo di "Allunga di 3 h 30"); fase "Riscaldo TA" anche nel Wizard TC (`db.ts:298`, `warmupH` del Planner); il chip freddo diventa un bottone verso Rotta con la correzione precompilata. Comando: `/impeccable harden` + `/impeccable clarify`.

**[P1] Il Forno si apre in errore per lo stile più comune.** Napoletana 65%: "✗ NON RAGGIUNGE LO STILE · Forno a 250°C insufficiente … (3) cambia stile" perché `DEFAULT_PROFILE` (`BakeView.tsx:115`) è "Domestico 250°C", mai scelto dall'utente. Nello stesso pannello "TEMPO 1:16" e "Tempo indicativo ~76s", "PIROMETRO (MODDED)", pomello del toggle in bianco puro (`:101`). Fix: chiedere il forno nel Wizard o ricordare l'ultimo usato; senza informazione, archetipo in cima e verdetto sotto; un solo formato ("76 s"). Comando: `/impeccable onboard` + `/impeccable clarify`.

**[P2] Le durate hanno sei formati e la brace parla cinque volte.** "12 h 30", "tra 15h 46m", "0.5 h"/"65.4 h" nel riepilogo (`Metric` con `unit="h"`, contro il Don't di DESIGN.md), "1:16"/"~76s", "65h 57m", "7.0h → 4.9h" in Qualità. In QUASI PRONTO: "Fatto ora" brace piena, badge brace, readout brace, "Aggiusta rotta →" nel semaforo e "Aggiusta rotta" con contorno brace nel footer, a 300 px l'uno dall'altro. Fix: `fmtHours` di `ui/index.tsx` ovunque, compreso `Metric` e le card del Planner; una sola azione brace per schermata. Comando: `/impeccable polish` + `/impeccable quieter`.

Altri P2, da non perdere: il monitor è un vicolo cieco per 48 ore (il wordmark non porta alla Home, niente Planner né Storico con una sessione viva; la Home già sa mostrare "Poolish in corso →", manca lo stesso pattern per la sessione); tastiera e screen reader (radiogroup con un tab stop per chip e senza frecce, `ui/index.tsx:236-243`; focus sul body dopo "Continua" ai passi 1→2, 2→3, 4→5; cambio di stato del semaforo senza `aria-live`; `select` farine senza label; nel Storico il cestino arriva in tabulazione prima del voto).

### Red flag per persona

**Pizzaiolo in servizio, telefono a un metro:** legge "ORA" verde e tira fuori il panetto dal frigo; il chip "PUNTATA · TC" da 11 px che lo smentisce non lo vede. Apre il Forno al pronto e trova "✗ NON RAGGIUNGE LO STILE" per un forno domestico che non ha. Non può pianificare l'impasto di domani finché quello di oggi è vivo. Al passo 6 deve scegliere fra 7 chip "τ × 2.2 / τ × 2.5" con le dita sporche.

**Appassionato alla prima sessione da 48 h in frigo:** sceglie "Cottura 19:30 mer", preme "Usa questo" su quattro stelle e si ritrova "Staglio gio · Forno mer". In dashboard legge "~12:14 domani · regge fino a ~22:22" mentre il suo piano dice 08:58: non sa a quale orario credere. "❄ inforni a ~9°" gli dice che c'è un problema, non cosa fare.

**Screen reader / solo tastiera:** cinque Tab per sentire gli stili, le frecce non fanno nulla; dopo "Continua →" il focus cade sul body e "Passo 2 di 8" non viene annunciato; "PRONTO DA INFORNARE" arriva senza annuncio; 8 Tab per impostare giorno e ora nel Planner; "Usa questo piano →" disabilitato senza `aria-describedby`.

### Osservazioni minori

- "INFORNI ALLE ?": il bottone di aiuto si legge come punto interrogativo dell'orario.
- Eliminazione in danger quieto e Termina in danger pieno: due pesi per due azioni distruttive.
- "Fine · salva": il punto mediano è un microformato interno finito in un'etichetta.
- Analisi ripete per intero il semaforo di Monitor sotto "01 STATO".
- Planner senza data: "IL TUO PIANO · Staglio 13:55 gio · Forno 14:25 gio" per un orario che nessuno ha scelto; in Servizio senza data nessuna CTA.
- Qualità: tre meter in blu, giallo e arancio, colori decorativi.
- Storico: "MATURAZ. 5% · USURA W 0%" sopra "Com'è venuta?"; l'ordine di un diario è esito, infornata, numeri. Lo stato vuoto non dice cosa ci finirà.
- Home: "ENGINE v2.4.0 · FERMENTATION SCIENCE" e "Capacitor Android + Web" in inglese; tagline e note del Wizard nel sans di sistema (`index.html:71`, `App.tsx:159-172`).
- Riepilogo con LM: "200g lievito madre" va a capo su tre righe.
- Passo 3 biga + LM: la biga resta a lievito di birra anche con pasta madre al passo 5: da verificare se voluto.
- Gli `input type=date/time` non forzano `lang`: nel Chromium di test "07:33 PM" e "mm/dd/yyyy".
- Detector: `.pm4-btn { transition: all .18s }` (`index.html:387`); 46 righe con bianco puro o trasparente contro il Do "mai il bianco trasparente", che DESIGN.md stesso contraddice documentando `button-ghost` a `rgba(255,255,255,0.04)`.

### Domande

1. Se il semaforo risponde con un orario, perché la Home non lo fa? Cosa perderebbe con "🍕 Napoletana · inforni alle ~12:11 domani" al posto di "ENGINE v2.4.0 · FERMENTATION SCIENCE"?
2. Perché un esperto deve rifare 8 passi per la pizza del sabato dopo, se lo Storico ha tutto per un "Rifai questa"?
3. Il Wizard chiede il contenitore con 7 opzioni e τ, e non chiede il forno. Qual è la domanda più utile per l'infornata?
4. Il Planner conosce il riscaldo e il Wizard TC no: sono due modelli dello stesso impasto?
5. Se "la previsione guida", perché i default del passo 7 non sono la previsione?
6. Quattro stelle vogliono dire "piano buono" o "freddo lungo"?
7. Il monitor sa dire "Infornata alle 20:30 · prima del pronto (−12h 58m)": perché lo Storico mostra "USURA W 0%" invece di quella frase?

Non visto: lo stato FREDDO del semaforo (mai raggiunto per il P0), COLLASSO e CRITICO, il modale fuori protocollo, le notifiche locali, lo Storico con più sessioni, il Servizio con data impostata. Font reali non caricati nel sandbox: larghezze misurate con i fallback.

## Passaggio 36: P0 e P1 della critique, più Home e Storico

Correzione dei due P0 e dei due P1 del passaggio 35, più la Home con l'impasto in corso e lo Storico. Il motore (`engine/`, `src/engine/`) non è stato toccato.

**A · "TC tutto in frigo" misurata come TA (P0).**
- `seedPhase` (`src/lib/timeline.ts`) prende fase e T ambiente dal segmento in corso della timeline effettiva, con il gate fuori protocollo.
- La usano tick, dashboard, Rotta, Forno, la ripresa della sessione e il primo log: una sessione TC parte in frigo a 4 °C.
- Le sessioni già salvate come TA ripartono in frigo.
- Lo snapshot del tick si salva anche uscendo dalla dashboard.
- In frigo non c'è più "regge fino a", e non si offre "Ho infornato" (né "Ho infornato, chiudi") finché l'impasto non è infornabile.

**C0 + C2 · Riscaldo per "TC tutto in frigo" (P1).**
- `src/lib/warmup.ts` è l'unico calcolo del riscaldo: prima era copiato in Wizard e Planner.
- Il calcolo usa la T laboratorio della sessione (prima 22 °C fissi) ed è arrotondato in su al quarto d'ora.
- Il protocollo `tc` finisce con un appretto a TA (`proofing`), letto dalle fasi canoniche come "APPRETTO · TA".
- Il riscaldo è applicato in wizard (passi 7 e 8), `buildInitialTimeline`, grafico, Planner ("TC totale … · riscaldo") e Rotta.
- Le sessioni salvate prima del riscaldo hanno `temperingH` 0 e restano come sono.
- Corretto il refuso "APPRETO".

**B · Planner (P0).**
- `src/lib/plannerFit.ts` classifica ogni piano: `ok`, `early` o `late`, con tolleranza di 15 min.
- Un piano `late` perde stelle e "Usa questo", finisce in fondo e non è mai consigliato. Mostra "Non ci sta: servono X, ne hai Y" e "Sposta la cottura alle …", che imposta data e ora.
- Un piano `early` dice "Pronta prima: ~…" e tiene la CTA.
- Il passo 8 del wizard si blocca se il piano finisce dopo il Forno.

**C1 · Passo 7 (P1).**
- Con tutto TA l'appretto, finché non lo tocchi, è quello che fa infornare al pronto del motore (`suggestedApprettoH`).
- Etichetta "Appretto (dal modello: inforni al pronto)" e "Ripristina dal modello".
- Sui valori di default non compare più l'avviso "acerbo".

**C3 · Chip "❄ inforni a ~9°" (P1).**
- Il chip diventa un bottone verso Aggiusta rotta ("Aggiungi il riscaldo →").
- Per `tc` e `tc_appreto` Rotta ha la card "Riscaldo TA (fuori dal frigo)" con il valore consigliato, "Usa il consigliato" e il cuore previsto a cottura. Alle sessioni vecchie appende l'appretto a TA.
- Con l'impasto in frigo lo slider della temperatura regola la cucina (T laboratorio), non il tick.

**D · Forno (P1).**
- Senza forno della sessione o dell'ultima volta (`src/lib/prefs.ts`) la vista chiede "Che forno usi?" e non dà verdetti.
- Archetipo e piano stanno prima del verdetto.
- I tempi sono in "76 s" (`fmtSeconds`).
- Tolta la clausola "(3) cambia stile".
- "PIROMETRO · FORNO MODIFICATO", pomello color farina, testi a 11 px.
- L'avviso "impasto freddo" usa lo stesso calcolo della dashboard.

**E · Home e guardie.**
- `bakeForecastFor` (`src/lib/bakeForecast.ts`) calcola l'orario di cottura per dashboard e Home.
- La Home mostra "🍕 Napoletana · inforni alle ~…" verso la dashboard, con lo stesso orario.
- "Nuovo impasto" è disabilitato con "Prima termina l'impasto in corso."
- Testi in italiano, senza "ENGINE … FERMENTATION SCIENCE" né "Capacitor".
- Il wordmark della dashboard torna alla Home.
- Wizard, Prefermento, Planner e Storico non avviano un secondo impasto sopra quello in corso, che resterebbe orfano nel DB.

**F · Storico.**
- Ordine della card: titolo, racconto ("Infornata 20:30 · 45 min dopo il pronto (pronta dalle 19:45)", la stessa frase della dashboard via `src/lib/bakedStory.ts`), voto, numeri, cestino in fondo.
- Il cestino ora arriva dopo il voto anche in tabulazione.

### Verifica

- `npm run typecheck` pulito.
- `npm test`: 286 test vitest e suite engine e stress verdi.
- Finto telefono, scenario `tutti`: 74/74.
- Browser a 390 e 360 px: 27/27 controlli su:
  - wizard TC: chip PUNTATA · TC, strip PUNTATA·TC/STAGLIO/APPRETTO·TA, niente "regge fino a", "Ho infornato" né chip freddo;
  - Home con impasto in corso: card, "Nuovo impasto" disabilitato, wordmark → Home → dashboard;
  - sessione TC vecchia: chip → Rotta → "Usa il consigliato" → cuore ~19° → chip sparito;
  - Forno: prima apertura senza verdetto, "51 s";
  - passo 7 TA senza "acerbo";
  - Storico: racconto prima dei numeri;
  - Planner con la cottura tra 47 h: "TC totale" con "Non ci sta", poi "Sposta la cottura" imposta data e ora;
  - nessuno scroll orizzontale.
- Rilevatore sui file toccati: da 89 a 88 segnalazioni (un colore fuori palette in meno nel Forno, un font del Forno riportato sulla scala di DESIGN.md).
- Da fare: rilanciare `scripts\test-telefono.ps1` sul telefono vero (atteso 74/74).

**Da sapere.** Con la cassetta chiusa e la cucina a 20 °C il modello chiede circa 8h 30m di riscaldo per un panetto da 250 g. È il valore del modello termico già usato per "TC Appretto", ora mostrato anche per "TC tutto in frigo".

## Passaggio 37: modello termico ricalibrato sulla letteratura

Il passaggio 36 aveva esteso il riscaldo dopo il frigo a "TC tutto in frigo": con la cassetta chiusa e la cucina a 20 °C il modello chiedeva ~8h 30m per un panetto da 280 g. Tre ricerche (codice, letteratura termofisica, pratica di pizzeria) hanno mostrato che il numero era sbagliato per tre ragioni. Con il permesso esplicito dell'utente il motore è stato corretto.

**Cosa non andava.**
- **Calore specifico +19%.** `doughSpecificHeat` usava l'idratazione (% sulla farina) come frazione d'acqua dell'impasto: 3,36 kJ/(kg·K) a 65%. Misurato 2,71–2,73 (Matuda, Pessôa Filho & Tadini, J. Cereal Sci. 53:126, 2011); Choi–Okos 2,83.
- **Il "cuore" era la temperatura media.** Il modello di Newton a una temperatura ignora la conduzione interna. Per un panetto da 250 g il numero di Biot è ~0,8: il vero centro è il 25–30% più lento (soluzione di Heisler per la sfera).
- **I due errori si compensavano per il panetto nudo:** 3,3 h contro 3,2–3,3 h della soluzione a conduzione. Per le cassette no.
- **Moltiplicatore della cassetta chiusa ×2,5 senza fonte.** Applicato a tutta la τ. Dalle resistenze in serie (aria interna, parete, aria esterna) la cassetta singola dà un h efficace ~4,9 contro ~9,5 all'aria: ×1,9 sulla sola resistenza esterna. Una cassetta in mezzo a una pila: ×2,9.
- **Soglia dei 18 °C.** Le pizzerie usano 10–15 °C al cuore come minimo (Tom Lehmann, PMQ) e tirano fuori le cassette 1,5–2,5 h prima; 18–20 °C è l'ideale (Gemignani). A 20 °C di cucina gli ultimi 2 °C costano quanto i primi 10.
- **Incoerenze interne:**
  - anteprima del Planner con τ fissa a 3 h;
  - grafico della dashboard con la sola parete laterale per la massa in puntata (τ 2,7 volte più grande);
  - contenitore di default diverso tra motore, tick e app;
  - quattro copie della formula della τ.

**Cosa è cambiato.**
- **Motore** (`engine/engine-v2.4.0.js`):
  - `doughSpecificHeat` sulla massa dell'impasto: acqua (idratazione + 14% umidità della farina) / (100 + idratazione + sale), solidi a 1600 J/(kg·K) (Choi–Okos).
  - Nuovo `effectiveHeatTransferCoeff`: 1/h_eff = f_contenitore/H_AIR + L/(c·k), con `K_DOUGH` 0,35 W/(m·K) (Šeruga et al. 2005) e `H_AIR` 9 W/(m²·K) (convezione di Churchill + irraggiamento). Sfera: L = r, c = 3 (tempo al cuore coerente con Heisler). Massa in puntata: L = altezza del cilindro, c = 2 (fondo isolato).
  - `thermalTimeConstant*` prendono il contenitore; preset ricalibrati: nudo 1,0 · pellicola 1,1 · cassetta aperta 1,3 · vetro coperto 1,6 · sacchetto 1,7 · cassetta chiusa 1,9 · cassetta isolata 2,9.
  - Solver: `thermalServiceTargetC` 15 °C.
- **App:**
  - `CORE_TEMP_AT_BAKE_MIN_C` = 15, nuovo `CORE_TEMP_AT_BAKE_IDEAL_C` = 18 (chip freddo, Forno, Rotta "l'ideale è 18°", passo 7).
  - `src/lib/warmup.ts` usa `thermalTimeConstantSphere` del motore; via le copie in Wizard, Planner (anche `TAU_APPROX_S`) e grafico; cassetta chiusa come default ovunque, anche nel tick.

**Numeri, 250 g a 65%, cuore da 4 °C, cucina a 20 °C:**

| | prima | dopo | letteratura |
|---|---|---|---|
| nudo → 18 °C | 3,3 h | 3,2 h | 3,2–3,3 h |
| cassetta chiusa → 18 °C | 8,2 h | 5,4 h | 5,5–6 h |
| cassetta chiusa → 15 °C | — | 3,0 h | 2,5–4 h (pizzerie a 10–15 °C) |

In app, con la sessione di default (6 panetti da ~280 g, cucina a 20 °C), il riscaldo consigliato in Aggiusta rotta scende da 8h 30m a 3h 15m.

**Test aggiornati.**
- Calore specifico, preset e scala con la massa (ora tra M^⅓ e M^⅔).
- Riferimenti di letteratura in `engine-v2.4.0.test.js` e `src/__tests__/warmup.test.ts`.
- Scenari del solver e degli allarmi spostati dove il nuovo riscaldo, più breve, cambia l'esito:
  - PA1 da 32 h a 40 h;
  - bug #57 da 46 h a 54 h;
  - servizio lungo (overshoot) da 8 h a 10 h;
  - napoletana a 26 h invece di 24 h;
  - "non si riscalda" sotto i 15 °C invece dei 18.

### Verifica
- `npm run typecheck`; `npm test`: vitest 287 + 257, motore, stress 285/285, fuzz 1001/1001.
- Finto telefono 74/74; browser 27/27 (390 px).
- Da fare: telefono vero; una misura con sonda al centro di un panetto (nudo e in cassetta). È l'unico dato che manca: in letteratura non c'è una curva affidabile.

**Limiti.**
- Le fonti web sono state lette dai riassunti dei motori di ricerca (il proxy bloccava le pagine): da ricontrollare sugli originali.
- L'evaporazione non è modellata: un panetto scoperto in una stanza secca si ferma sotto i 18 °C (~15,7 °C al 50% di umidità). Coperto, l'effetto sparisce.
- La massa del panetto ha ancora due formule (con e senza sale, 0,4% sulla τ).
