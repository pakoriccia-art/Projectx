---
name: PizzaMatrix
description: Gestione predittiva degli impasti della pizza — monitor di fermentazione live
colors:
  ember: "#ff8c32"
  ember-lo: "#ffd166"
  cold: "#74b9ff"
  ok: "#3ddc97"
  critical: "#ff7675"
  collapsed: "#d63031"
  maturation-gold: "#e6c84a"
  char: "#0a0806"
  surface: "#141008"
  elevated: "#1e1810"
  panel-hi: "#1c140b"
  panel-lo: "#100b07"
  flour: "#e8d5b0"
  tan: "#a99a76"
  umber: "#9a855a"
  faint: "#837049"
typography:
  display:
    fontFamily: "Fraunces, serif"
    fontSize: "2.6rem"
    fontWeight: 900
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Fraunces, serif"
    fontSize: "1.4rem"
    fontWeight: 700
  readout:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "35px"
    fontWeight: 800
    lineHeight: 0.82
    fontFeature: "tnum"
  body:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "0.9rem"
    fontWeight: 700
  label:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "10px"
    fontWeight: 700
    letterSpacing: "0.2em"
rounded:
  xs: "2px"
  sm: "8px"
  md: "10px"
  panel: "12px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  page-h: "18px"
components:
  button-primary:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.char}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
    height: "44px"
  button-ghost:
    backgroundColor: "rgba(255,255,255,0.04)"
    textColor: "{colors.tan}"
    rounded: "9px"
    padding: "13px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.critical}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "12px 20px"
    height: "44px"
  panel:
    backgroundColor: "{colors.panel-hi}"
    rounded: "{rounded.panel}"
    padding: "13px 14px 14px"
  input:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.flour}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
    height: "44px"
  chip:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.tan}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
    height: "44px"
  chip-active:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.char}"
  state-badge:
    textColor: "{colors.ok}"
    typography: "{typography.label}"
    rounded: "5px"
    padding: "2px 7px"
---

# Design System: PizzaMatrix

## Overview

**Creative North Star: "La Brace che Misura"**

PizzaMatrix è uno strumento di misura che vive nel buio caldo di un forno spento. Tutto riposa su bruni carbone e testi color farina, finché la brace non si accende: l'arancio segnala l'azione da compiere o lo stato ottimale, l'oro la maturazione che sale, il blu il freddo del frigo, il rosso il pericolo. La scienza (Gompertz, Arrhenius, decadimento della W) arriva calda e leggibile, non clinica.

Il registro di riferimento è **BANCO**, la skin `pm4-*` del monitor live e del Forno. Ha pannelli con profondità "fresata", canali numerati incisi ("01 · MATURAZIONE"), LED a segmenti e valori monospazio grandi. La skin **Classic** (`Card`/`Btn`/`S` in `src/components/ui/index.tsx`, usata da Wizard, Planner, Rotta e Storico) è legacy e va fatta convergere verso BANCO. I componenti sono tattili e robusti: si usano con le mani infarinate, a distanza, durante sessioni di ore. La densità è alta ma ordinata: una colonna mobile, un valore protagonista per pannello.

**Key Characteristics:**
- Solo tema scuro, a base bruno-carbone. Nessun grigio freddo e nessun bianco puro sulle superfici.
- La brace (`ember`) è l'unico accento caldo d'azione. Il colore significa stato, non decorazione.
- JetBrains Mono è la voce dello strumento: etichette, valori, bottoni. Fraunces resta solo per il wordmark e i titoli.
- La profondità è fresata: luce incisa in alto, ombra in basso, una caduta morbida sotto il pannello.
- Il movimento è funzionale: i pannelli emergono, i LED si riempiono in sequenza, l'alert critico pulsa.

## Colors

Notte di forno: neutri bruno-carbone e farina, accesi da pochi colori di stato saturi.

### Primary
- **Brace Viva** (#ff8c32): azione primaria, stato ottimale alto, linea della lievitazione, marcatore "ora", glow del brand. Corrisponde a `--accent-brand`, `--pm4-ember` e `--state-optimal-hi`.
- **Brace Bassa** (#ffd166): avvisi e stato ottimale basso, prefermento poolish. Corrisponde a `--accent-warning` e `--pm4-ember-lo`.

### Secondary
- **Freddo di Frigo** (#74b9ff): tutto ciò che è TC (protocollo frigo, temperatura nel grafico, asse destro), informazioni, autolisi. Corrisponde a `--state-cold` e `--accent-info`.

### Tertiary
- **Lievito Pronto** (#3ddc97): stato OK del semaforo, LED pieni. Corrisponde a `--pm4-green`.
- **Oro di Maturazione** (#e6c84a): la linea della maturazione enzimatica nel grafico Gompertz.
- **Allarme Rosato** (#ff7675): stato critico, azioni distruttive. Corrisponde a `--state-critical`.
- **Crollo** (#d63031): collasso strutturale e modale bloccante. Corrisponde a `--state-collapsed`.

### Neutral
- **Carbone** (#0a0806): sfondo pagina, e testo sopra la brace nei bottoni primari.
- **Fondo Teglia** (#141008): superficie delle card Classic.
- **Teglia Rialzata** (#1e1810): input, chip inattivi, tooltip.
- **Pannello Alto / Basso** (#1c140b → #100b07): gradiente verticale del pannello BANCO.
- **Farina** (#e8d5b0): testo primario e valori.
- **Crusca** (#a99a76): nomi dei canali, testo secondario.
- **Terra d'Ombra** (#9a855a): chiavi delle celle, didascalie (5.6:1).
- **Cenere** (#837049): testo più tenue, solo per elementi non essenziali (4.2:1, sotto AA per il testo piccolo).
- **Linee**: `rgba(255,206,150,0.085)` per i bordi e `rgba(255,206,150,0.16)` per i bordi in evidenza. Sono bianco caldo, mai bianco puro.

### Named Rules
**The Ember Speaks Rule.** L'arancio brace compare solo sull'azione primaria o su uno stato ottimale. Se tutto è arancio, niente lo è.

**The Color Is State Rule.** Ogni colore saturo corrisponde a uno stato del processo: freddo, ok, attenzione, critico, crollo. Non si aggiungono colori decorativi.

**The One Green Rule.** Il verde "ok" è #3ddc97. Gli altri verdi presenti nel codice Classic (#00b894, #55efc4, #22c55e, #2dd4bf) sono debito da far convergere, non varianti da riusare.

## Typography

**Display Font:** Fraunces (con fallback serif)
**Body/Instrument Font:** JetBrains Mono (con fallback monospace)

**Character:** un serif editoriale pesante dà calore artigianale al nome. Il monospazio tecnico fa parlare tutto il resto come un quadrante di misura.

### Hierarchy
- **Display** (900, 2.6rem, -0.03em): solo il wordmark "PizzaMatrix" in Home.
- **Headline** (700–900, 1.4rem): titoli di passo nel Wizard (`StepHeader`) e brand nel `LiveHeader`.
- **Readout** (800, 35px, line-height 0.82, cifre tabulari): il valore protagonista del semaforo. Scende a 25px nella variante a metà larghezza e a 17px nelle celle secondarie.
- **Body** (400–700, 0.9rem): bottoni, testo dei form, contenuto.
- **Label** (700, 9–10px, tracking 0.12–0.2em, maiuscolo): nomi dei canali, chiavi delle celle, badge di stato.

### Named Rules
**The Tabular Truth Rule.** Ogni valore che cambia nel tempo usa `font-variant-numeric: tabular-nums`, così le cifre non ballano mentre il motore avanza.

**The Fraunces Is a Signature Rule.** Fraunces non entra mai in etichette, dati o bottoni.

Debito noto: nel codice convivono 39 dimensioni di font, tra px, rem e px frazionari. Le nuove interfacce stanno sulla gerarchia qui sopra.

## Layout

Una colonna mobile unica, larga al massimo 430px e centrata (`#root`, ripetuto in DashboardV4). Usa `100dvh` e i safe-area inset (`viewport-fit=cover`). Non ci sono breakpoint di larghezza: su desktop si vede la stessa colonna.

Nel monitor live c'è un header sticky con `backdrop-filter: blur(8px)`. Sotto si impilano i pannelli BANCO, con il semaforo come eroe, poi celle secondarie e grafico. Un footer sticky sfocato contiene "Aggiusta Rotta", Forno e fine sessione. Il Wizard ha un `StepHeader` a 8 segmenti e i comandi Continua/Indietro fissati in basso.

Il ritmo usa gap da 4, 8, 12 e 16px. Il padding orizzontale della pagina è 18px (`--padding-h`). I pannelli BANCO usano un padding di 13–14px, valore storico. Le celle secondarie stanno in una griglia `.pm4-cells` con N colonne uguali.

## Elevation & Depth

Il sistema non è piatto: è fresato. Il pannello BANCO sembra ricavato da un blocco scuro. Ha un gradiente verticale caldo, una linea di luce incisa sul bordo alto, un'ombra incisa sul bordo basso e una caduta morbida sotto il pannello. Gli stati si fanno luce con glow sul testo, non con ombre.

### Shadow Vocabulary
- **Pannello fresato** (`box-shadow: 0 1px 0 rgba(255,220,170,0.05) inset, 0 -1px 0 rgba(0,0,0,0.5) inset, 0 10px 26px -16px rgba(0,0,0,0.9)`): ogni `.pm4-panel`.
- **Pannello critico** (`box-shadow: 0 1px 0 rgba(255,220,170,0.05) inset, 0 0 0 1px rgba(255,118,117,0.10), 0 12px 30px -14px rgba(214,48,49,0.4)`): `.pm4-crit`.
- **Bagliore brace** (`box-shadow: 0 4px 18px rgba(255,140,50,0.28)`): hover del bottone primario.
- **Glow di stato** (`text-shadow: 0 0 18px <colore-stato>5a`): valore del semaforo.

### Named Rules
**The Milled Panel Rule.** La profondità è incisa nel materiale (inset), non sollevata. Un pannello non fluttua: è scavato nel banco.

## Shapes

Gli angoli sono gentili ma non morbidi: 8px per input e chip, 10px per i bottoni, 12px per i pannelli, 14px per le card Classic. Le pill (999px) sono riservate ai badge e alla fase nell'header. I LED del meter sono piccoli rettangoli da 2px di raggio, 10 segmenti con 3px di gap. Gli avvisi usano un bordo sinistro d'accento da 3–4px.

## Components

### Buttons
Tattili, pieni e robusti, sempre alti almeno 44px.
- **Shape:** angoli medi (10px). Il ghost usa 9px.
- **Primary:** fondo brace, testo carbone, JetBrains Mono 700 a 0.9rem, padding 12×20, a tutta larghezza.
- **Hover / Focus:** sale di 2px e prende il bagliore brace. `:focus-visible` mostra un anello visibile.
- **Ghost (BANCO):** fondo bianco al 4%, bordo `line-strong`, testo crusca, 13px/700.
- **Danger:** fondo con gradiente caldo #e0463f → #b3231d e ombra rossa (BANCO), oppure `--state-critical` pieno (Classic).
- **Disabled:** opacità 0.38.

### Chips
- **Style:** `SnapButtons` sono un radiogroup. Inattivi: teglia rialzata con bordo bianco al 10%. Attivi: brace piena, testo carbone, 700, con glow.
- **State:** ogni chip è alto almeno 44px, con padding 10×14 e testo a 0.75rem.

### Cards / Containers
- **Corner Style:** 12px (pannello BANCO).
- **Background:** gradiente da pannello alto a pannello basso.
- **Shadow Strategy:** pannello fresato (vedi Elevation). Lo stato critico aggiunge un bordo rosato.
- **Border:** 1px `rgba(255,206,150,0.085)`.
- **Internal Padding:** 13–14px.
- **Entrata:** animazione `pm4-rise`, 0.5s con ease-out.

### Inputs / Fields
- **Style:** fondo teglia rialzata, bordo bianco al 10%, 8px di raggio, padding 12×16, JetBrains Mono 1rem, altezza minima 44px.
- **Focus:** bordo brace e anello da 3px di brace al 15%.
- **Slider:** traccia da 4px con un'area di tocco di 44px e pollice brace da 20px che si ingrandisce a 1.3 in hover. Nella variante BANCO la traccia va dal freddo alla brace.

### Navigation
- Non c'è una tab bar: le viste cambiano tramite lo stato dell'app.
- **Monitor / Analisi:** toggle segmentato, etichette maiuscole da 10px tracciate a 0.14em. L'attivo ha un fondo caldo trasparente e `aria-pressed`.
- **StepHeader:** progress a 8 segmenti alti 4px, brace quando il passo è completato.

### Signature: Semaforo
Il cuore di BANCO.
- In cima, l'etichetta del canale "01 · MATURAZIONE ENZIMATICA": l'indice è brace, il nome è crusca, seguiti da una linea che si disegna.
- Al centro, il valore readout a 35px nel colore di stato con il suo glow, e un `StateBadge` (TOO_EARLY, OK, WARNING, CRITICAL, COLLAPSED).
- Sotto, il meter a 10 LED. Si riempie in sequenza: 250ms di attesa, poi 45ms per segmento.
- Chiude la griglia di celle secondarie: pH, lievitazione, W.

### Signature: Grafico Gompertz
Recharts, alto 200px, scorrevole in orizzontale. Griglia tratteggiata al 5% di bianco. Tick in mono da 10px, color terra d'ombra.

| Linea | Colore | Spessore | Tratto |
|---|---|---|---|
| Lievitazione | Brace | 2px | tratteggiata `5 3` |
| Maturazione | Oro | 2px | continua |
| Temperatura | Freddo | 1.5px | tratteggiata `4 2` |

Ci sono anche linee di riferimento per "ora", per il target di cottura e per le soglie 65 e 85.

## Do's and Don'ts

### Do:
- **Do** usare i token `var(--…)` di `index.html` invece degli hex scritti a mano. #0a0806 ripetuto 15 volte è debito.
- **Do** costruire le nuove schermate con il linguaggio BANCO: `.pm4-panel`, canali numerati, celle, LED.
- **Do** mantenere ogni target toccabile ad almeno 44px.
- **Do** usare cifre tabulari su ogni valore live.
- **Do** rispettare `prefers-reduced-motion`, sia in CSS sia con `useReducedMotion` in JS.

### Don't:
- **Don't** introdurre nuove palette (Tailwind, flat-UI). Bisogna far convergere i verdi, i gialli e i grigi caldi duplicati sui token esistenti.
- **Don't** usare un secondo accento caldo accanto alla brace per l'azione.
- **Don't** usare Fraunces fuori da wordmark e titoli.
- **Don't** usare bianco puro o grigi freddi per superfici e testi. I neutri sono sempre bruni o color farina.
- **Don't** creare un tema chiaro senza una decisione esplicita. Oggi il sistema è solo scuro.
