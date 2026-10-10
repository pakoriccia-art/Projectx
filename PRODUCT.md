# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

PWA mobile-first (`vite-plugin-pwa`, orientamento portrait) distribuita anche come APK tramite involucro Capacitor 6 Android. Una sola interfaccia web, identica su browser e APK; l'involucro nativo aggiunge notifiche locali e aptica, non un linguaggio di design nativo.

## Users

Due pubblici, serviti dallo stesso strumento senza semplificare la tecnica:

- **Appassionati esperti** che impastano a casa con attrezzatura seria (impastatrice a spirale, forno elettrico o a gas da pizza, pirometro).
- **Pizzaioli professionisti** che gestiscono impasti e una finestra di servizio.

Entrambi conoscono il lessico tecnico: W, P/L, Falling Number, DDT, puntata, appretto, biga, poolish. Usano l'app accanto all'impasto, spesso con le mani infarinate e lo sguardo a distanza, durante sessioni che durano ore o giorni.

## Product Purpose

PizzaMatrix fa gestione predittiva degli impasti per pizza. Il flusso è questo:

1. **Wizard** in 8 passi: stile, tipo di impasto, farine e prefermenti, idratazione e sale, lievito, contenitore, tempistiche, riepilogo.
2. **Sessione live**: un motore a due orologi (lievitazione Gompertz × CTM e maturazione enzimatica Arrhenius, mai mescolati), più decadimento della W e pH dinamico, avanza nel tempo reale. Notifica quando si raggiunge lo sweet spot o quando la struttura W diventa critica.
3. **Aggiusta Rotta**: corregge la sessione in corsa (temperature, freddo, durate) e mostra l'effetto sul picco e sul target di cottura.
4. **Forno**: consiglia temperatura e tempo per l'archetipo di forno scelto. È solo consultivo.
5. **Storico**: elenca le sessioni concluse.

A questo si aggiunge il **Pianifica fermentazione**, un solver inverso. Parte da farina, agente e temperature e ricava i protocolli che raggiungono la maturazione target. Gestisce anche la finestra di servizio e il profilo sensoriale (aromi, estensibilità, scioglievolezza).

Successo = infornare nel momento giusto, sapendo perché.

## Positioning

Predizione più monitor live, non un calcolatore di ricette. PizzaMatrix non dà una dose fissa: modella la fermentazione e ti accompagna in tempo reale fino all'infornata, dicendo dove sei e quando sarai pronto.

## Operating Context

- Interfaccia solo in italiano (`lang="it"`, `it-IT`), con registro informale (tu). Unità metriche: g, °C, ore, percentuali del fornaio.
- Protocolli TA (temperatura ambiente) e TC (frigo), con fasi di puntata e appretto.
- Funziona offline: le sessioni sono salvate in IndexedDB (Dexie). Il solver gira in un Web Worker.
- Notifiche locali su Android: "Sweet Spot raggiunto" e "Struttura W critica".
- Deploy web su Vercel. Build Android con Capacitor.

## Capabilities and Constraints

- **Terminologia da preservare**: maturazione enzimatica, lievitazione, biga, poolish, autolisi, riporto, LBF/IDY/LM, malto, W, P/L, Falling Number, DDT, puntata, appretto, staglio, cielo/platea, biscotto, "Aggiusta rotta", sweet spot.
- **Gli input dell'utente non si sovrascrivono mai in silenzio**: idratazione, W, stile e impastatrice. Ogni reset è un avviso con possibilità di annullare.
- Le costanti fisiche cambiano solo con un riferimento bibliografico esplicito. Il README è la base di conoscenza.
- Le soglie marcate `validationStatus: 'hypothesis'` vanno presentate come ipotesi, non come certezze.
- Il Forno è consultivo e non modifica i dati della sessione.
- **Decisione aperta**: la versione mostrata non è coerente. Il README dice v2.4.25, la UI e `package.json` dicono 2.4.0.

## Brand Commitments

- Il nome è **PizzaMatrix**. Il wordmark è in Fraunces e non esiste un logo grafico separato.
- L'icona "brace" (`public/favicon.svg`, `public/icons/`) è un disco incandescente giallo-arancio su bruno scuro.
- L'accento brace `#ff8c32` è usato anche come colore icona delle notifiche.
- La voce è in italiano informale, tecnica e asciutta. Usa emoji con moderazione su CTA e notifiche, e frecce e simboli funzionali (→ ← ✓).

## Evidence on Hand

- `README.md`: base di conoscenza sulla fisica dei modelli.
- `design/dashboard-v4-concept.html`: concept del monitor live (skin BANCO).
- Libreria di farine reali nel planner (Caputo, Molino Casillo, 5 Stagioni).
- Icone e favicon in `public/`.
- Assenti: testimonianze, benchmark, utenti dichiarati, prezzi. Non vanno inventati.

## Product Principles

1. **La previsione guida, l'utente decide.** L'app indica stato e tempi, ma la scelta di infornare resta di chi impasta.
2. **Trasparenza scientifica.** Modelli dichiarati, ipotesi marcate come tali, nessun numero senza origine.
3. **Mai sovrascrivere in silenzio.** Ogni correzione automatica è visibile e reversibile.
4. **Leggibile mentre si lavora.** Lo stato si capisce a colpo d'occhio, da lontano e con le mani occupate.
5. **Offline e affidabile.** Una sessione di 48 ore non dipende dalla rete.

## Accessibility & Inclusion

- Target touch di almeno 44px. Lo slider ha un'area di tocco estesa perché si usa con le mani infarinate.
- Contrasto AA sul tema scuro: i testi muted sono stati alzati apposta.
- `prefers-reduced-motion` va rispettato sia in CSS sia nelle animazioni JS.
- Struttura `<main>` e un `<h1>` per vista.
