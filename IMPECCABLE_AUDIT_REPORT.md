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

## Verifica
- `tsc --noEmit`: nessun errore.
- `npm test`: 256 test vitest, 154 test engine, 285 test di stress e 1001 asserzioni di fuzz, tutti superati.
- Nuovo giro di screenshot su tutte le viste, mobile e desktop: nessun errore in console imputabile all'app.
- Rilevatore sui file modificati: restano solo le eccezioni intenzionali e le transizioni di `width` descritte sopra.
