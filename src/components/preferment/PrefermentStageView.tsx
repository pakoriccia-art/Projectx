/**
 * PizzaMatrix — prefermenti in maturazione.
 *
 * La fase prima dell'impasto finale. Ogni prefermento ha il suo orologio
 * (tempo termico con fArrhenius del motore, anche se cambia posto): il più
 * lungo parte subito, gli altri più tardi per essere pronti insieme. In alto
 * c'è sempre il più urgente (quello che va oltre per primo) e la finestra per
 * l'impasto finale: da quando sono tutti pronti a quando il primo va oltre.
 * Alla conferma le ore e le temperature vissute entrano nella ricetta e parte
 * la sessione dell'impasto.
 */
import { useEffect, useRef, useState } from 'react';
import { fmtClockDay } from '../../lib/fmtTime';
import { useApp, type WizardDraft } from '../../context/AppContext';
import { Btn, Card, SnapButtons } from '../ui';
import { launchSession } from '../wizard/WizardView';
import { deleteAllPrefermentStages, deletePrefermentStage, updatePrefermentStage } from '../../services/sessionService';
import type { PrefermentStage } from '../../db/db';
import {
  EARLY_PCT, FRIDGE_HINT_PCT, currentSpot, elapsedPrefHours, equivalentTempC, finalWaterAdvice,
  fmtGrams, fmtSpanH, fridgeGain, isPreparable, itemClock, itemState, normalizeStage,
  overSign, placeOf, placeTempC, prefAl, prefDdtC, prefIsFeminine, prefName, prefTempAtMix,
  prefWithArticle, readySigns, readyWord, splitRecipe, stageReadyAt, stageStatus, waterAdvice, fridgePlan, mixedAtFromClock,
  type ItemState, type LateLevel, type PrefPlace, type StageItem,
} from '../../lib/preferment';

const MONO = { fontFamily: 'var(--font-mono)' } as const;
const PLACE: Record<PrefPlace, string> = { fresco: 'in un posto fresco', stanza: 'a temperatura ambiente', frigo: 'in frigo' };
const PLACE_LABEL: Record<PrefPlace, string> = { fresco: 'Fresco', stanza: 'Stanza', frigo: 'Frigo' };
/** Sotto questo scarto dall'orario del piano non si chiede nulla. */
const SHIFT_ASK_MS = 15 * 60_000;

function fmtClock(d: Date | number, now: number): string {
  return fmtClockDay(d, now);
}

const cap = (t: string) => t.replace(/^./, c => c.toUpperCase());
const LEVEL_COLOR: Record<LateLevel, string> = {
  // Testo sempre ad AA: "troppo oltre" si distingue con la parola e con la barra (#d63031), non col testo scuro.
  growing: 'var(--pm4-flour)', ready: 'var(--pm4-ember-lo)', late: 'var(--state-critical)', veryLate: 'var(--state-critical)',
};
const BAR_COLOR: Record<LateLevel, string> = { ...LEVEL_COLOR, growing: 'var(--pm4-tan)', veryLate: 'var(--state-collapsed, #d63031)' };

type Confirm = null | 'early' | 'veryLate' | 'service' | 'skip';

/**
 * "L'ho impastata alle…": l'ora vera dell'impasto, quando non è adesso. La
 * maturazione parte da lì, non dal tocco sul pulsante.
 */
function MixedAtPicker({ trigger, fem, onPick }: { trigger: string; fem: boolean; onPick: (ms: number) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reopen = useRef(false);
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (reopen.current) { triggerRef.current?.focus(); reopen.current = false; }
  }, [open]);
  const id = useRef(`pm-mixed-${Math.random().toString(36).slice(2, 7)}`).current;
  const ms = val ? mixedAtFromClock(val) : null;
  if (!open) return (
    <button ref={triggerRef} type="button" onClick={() => {
      const d = new Date(Date.now() - 3_600_000);
      setVal(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      setOpen(true);
    }} style={{
      alignSelf: 'flex-start', minHeight: 44, background: 'none', border: 'none', cursor: 'pointer',
      ...MONO, fontSize: '0.9rem', color: 'var(--pm4-tan)', textDecoration: 'underline', padding: 0,
    }}>{trigger}</button>
  );
  return (
    <div role="group" aria-label="Orario dell'impasto" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label id={`${id}-l`} htmlFor={id} style={{ ...MONO, fontSize: '0.9rem', color: 'var(--pm4-flour)' }}>
        {fem ? 'Impastata' : 'Impastato'} alle
      </label>
      <input ref={inputRef} id={id} type="time" value={val} onChange={e => setVal(e.target.value)}
        aria-describedby={`${id}-h`}
        style={{ ...MONO, fontSize: '1rem', minHeight: 44, padding: '6px 10px', background: 'var(--bg-elevated)', color: 'var(--pm4-flour)', border: '1px solid var(--pm4-line-strong)', borderRadius: 8 }} />
      <div id={`${id}-h`} role={val && ms == null ? 'alert' : undefined} style={{ ...MONO, fontSize: 11, color: val && ms == null ? 'var(--state-critical)' : 'var(--pm4-umber)' }}>
        {val && ms == null ? 'Al massimo 12 ore fa: per un orario più vecchio annulla e ricomincia.' : 'Un orario più avanti di adesso vale per ieri.'}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}><Btn variant="secondary" onClick={() => { reopen.current = true; setOpen(false); }}>Annulla</Btn></div>
        <div style={{ flex: 1 }}><Btn disabled={ms == null} onClick={() => { if (ms != null) { setOpen(false); onPick(ms); } }}>Salva l'orario</Btn></div>
      </div>
    </div>
  );
}

export function PrefermentStageView() {
  const { state, dispatch } = useApp();
  const raw = state.prefermentStage;
  const [now, setNow] = useState(() => Date.now());
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showDoses, setShowDoses] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLDivElement>(null);
  const prevConfirm = useRef<Confirm>(null);
  const prevCancel = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => { if (!raw) dispatch({ type: 'NAV', view: 'home' }); }, [raw, dispatch]);
  // Focus: sulla domanda quando si apre, sul pulsante che l'ha aperta quando si chiude.
  useEffect(() => {
    if (confirm && !prevConfirm.current) confirmRef.current?.focus();
    if (!confirm && prevConfirm.current) readyRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    prevConfirm.current = confirm;
  }, [confirm]);
  useEffect(() => {
    if (confirmCancel && !prevCancel.current) cancelRef.current?.focus();
    if (!confirmCancel && prevCancel.current) {
      const btns = cancelRef.current?.querySelectorAll<HTMLButtonElement>('button');
      btns?.[btns.length - 1]?.focus();
    }
    prevCancel.current = confirmCancel;
  }, [confirmCancel]);
  if (!raw) return null;

  const stage = normalizeStage(raw);
  const items = stage.items ?? [];
  const draft = stage.draft as WizardDraft;
  const prefs = draft.prefermenti ?? [];
  const prefOf = (it: StageItem) => prefs.find(p => p.id === it.id);
  const main = items[0];
  const fridge = draft.fridgeTempC ?? 4;
  const status = main ? stageStatus(stage, now) : null;
  // In alto il più urgente: quello che va oltre per primo.
  const focus: ItemState | null = status?.focus ?? null;
  const fIt = focus?.it ?? main;
  const type = fIt?.type ?? 'biga';
  const fem = prefIsFeminine(type);
  const Name = cap(prefWithArticle(type));
  const level: LateLevel = focus?.level ?? 'growing';
  const readyMs = focus?.etaMs ?? now;
  const spotOf = (it: StageItem) => currentSpot(it, prefOf(it) ? placeOf(prefOf(it)!) : 'fresco');
  const spot = fIt ? spotOf(fIt) : { place: 'fresco' as PrefPlace, tempC: 16 };
  const others = items.filter(it => it.id !== fIt?.id);
  const recipe = splitRecipe({
    totalFlourG: draft.totalFlourGrams ?? 1000, hydrationPct: draft.hydration ?? 65,
    saltPct: draft.salt ?? 2, fatPct: draft.fat, agentDosePct: draft.agentDosePct ?? 0, prefermenti: prefs,
  });
  const agent = draft.agentType ?? 'fresh_yeast';
  const yeastLabel = agent === 'sourdough_wheat' ? 'Lievito madre' : agent === 'instant_dry_yeast' ? 'Lievito secco' : 'Lievito di birra';
  const tLab = draft.tLaboratorio ?? 20;

  // Salva in memoria e in IndexedDB (l'id esiste: la preparazione si salva prima di aprirsi).
  const save = (patch: Partial<PrefermentStage>) => {
    const next = { ...stage, ...patch };
    dispatch({ type: 'PREF_STAGE_SET', stage: next });
    if (raw.id != null) {
      const { id: _id, ...rest } = next as typeof next & { id?: number };
      updatePrefermentStage(raw.id, rest).catch(err => console.error('[updatePrefermentStage]', err));
    }
  };
  const saveItems = (nextItems: StageItem[], patch: Partial<PrefermentStage> = {}) => {
    const t = Date.now();
    setNow(t);   // l'orologio della vista va al momento della modifica
    save({ ...patch, items: nextItems, readyAt: new Date(stageReadyAt(nextItems, t)) });
  };
  const updateItem = (id: string, patch: Partial<StageItem>) =>
    saveItems(items.map(it => (it.id === id ? { ...it, ...patch } : it)));
  const moveTo = (it: StageItem, place: PrefPlace) => {
    if (place === spotOf(it).place) return;
    updateItem(it.id, { moves: [...(it.moves ?? []), { at: new Date(), place, tempC: placeTempC(place, fridge) }] });
  };
  // Senza il secondo prefermento: la sua farina e la sua acqua vanno nell'impasto finale.
  const skipItem = (it: StageItem) => {
    const nextDraft = { ...draft, prefermenti: prefs.filter(p => p.id !== it.id) };
    saveItems(items.filter(x => x.id !== it.id), { draft: nextDraft as Record<string, unknown> });
    setConfirm(null);
  };

  const removeStage = () => {
    dispatch({ type: 'PREF_STAGE_SET', stage: null });
    const p = raw.id != null ? deletePrefermentStage(raw.id) : deleteAllPrefermentStages();
    p.catch(err => console.error('[deletePrefermentStage]', err));
  };

  // Orario del piano (Servizio/Orario): l'impasto parte ora invece che all'ora prevista.
  const startMs = new Date(stage.startedAt).getTime();
  const plannedMixMs = startMs + (main?.plannedH ?? stage.plannedH ?? 12) * 3_600_000;
  const shiftMs = now - plannedMixMs;
  const target = draft.targetBakeAt ? new Date(draft.targetBakeAt) : null;

  const startDough = (moveService: boolean) => {
    setError(null);
    const t = Date.now();
    // Ore vere e temperatura equivalente vissute da ciascun prefermento.
    const finalDraft: WizardDraft = {
      ...draft,
      prefermentTiming: 'ready',
      prefermenti: prefs.map(p => {
        const it = items.find(x => x.id === p.id);
        if (!it || !isPreparable(p)) return p;
        const from = it.mixedAt ?? it.startAt;
        return {
          ...p, durationH: Math.min(72, elapsedPrefHours(from, t)), tempC: equivalentTempC(itemClock(it), t),
          place: (it.moves ?? []).length ? undefined : p.place,
        };
      }),
      targetBakeAt: target ? new Date(target.getTime() + (moveService ? t - plannedMixMs : 0)) : undefined,
    };
    try {
      launchSession(finalDraft, dispatch);
    } catch (e) {
      console.error('[PrefermentStage] launchSession', e);
      setError("Non riesco ad avviare l'impasto con questi valori. Riprova o annulla la preparazione.");
      return;
    }
    removeStage();
  };

  const started = (status?.all ?? []).filter(x => x.started);
  const worst = started.reduce<ItemState | null>((a, b) => (!a || b.pct > a.pct ? b : a), null);
  const many = items.length > 1;
  const allFem = items.every(it => prefIsFeminine(it.type));
  const leastRipe = started.reduce<ItemState | null>((a, b) => (!a || b.pct < a.pct ? b : a), null);
  const anyVeryLate = started.some(x => x.level === 'veryLate');
  const anyEarly = started.some(x => x.pct < EARLY_PCT);
  const pending = (status?.all ?? []).find(x => !x.started) ?? null;
  const askService = !!target && Math.abs(shiftMs) >= SHIFT_ASK_MS;
  const goOn = (from: Confirm) => {
    // Le domande in fila: troppo oltre → in anticipo → servizio.
    if (from === null && anyVeryLate) { setConfirm('veryLate'); return; }
    if ((from === null || from === 'veryLate') && anyEarly) { setConfirm('early'); return; }
    if (from !== 'service' && askService) { setConfirm('service'); return; }
    setConfirm(null);
    startDough(false);
  };

  // Dosi e acqua alla temperatura giusta per un prefermento da impastare.
  const doses = (it: StageItem) => {
    const g = recipe.prefs.find(x => x.id === it.id);
    if (!g) return null;
    const w = waterAdvice({
      ddtTarget: prefDdtC(g.type), tempAmbient: tLab, waterG: g.waterG,
      massKg: g.totalG / 1000, hydrationPct: prefOf(it)?.hydration ?? 50,
      kneadingMethod: draft.kneadingMethod ?? 'spiral', kneadDurationMin: 3, tapWaterC: draft.tapWaterC,
    });
    return (
      <>
        {row('Farina', fmtGrams(g.flourG))}
        {row('Acqua', fmtGrams(g.waterG))}
        {g.yeastG != null && row(yeastLabel, fmtGrams(g.yeastG))}
        {w && <div style={{ ...MONO, fontSize: 11, color: 'var(--pm4-umber)', lineHeight: 1.5 }}>Per un impasto a ~{prefDdtC(g.type)}°C: {w}.</div>}
      </>
    );
  };

  // Frigo: in anticipo dall'85% (vale se lo sposti ora), azione principale quando è già oltre.
  const fridgeHint = (it: StageItem, urgent: boolean) => {
    const s = itemState(it, now);
    if (!s.started || spotOf(it).place === 'frigo') return null;
    if (!urgent && (s.pct < FRIDGE_HINT_PCT || s.level === 'late' || s.level === 'veryLate')) return null;
    if (urgent && s.level !== 'late' && s.level !== 'veryLate') return null;
    const g = fridgeGain(it, now, fridge);
    const nm = prefWithArticle(it.type), f = prefIsFeminine(it.type);
    return (
      <Card key={`fr-${it.id}-${urgent}`} elevated>
        <div style={{ ...MONO, fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--pm4-flour)', marginBottom: 10 }}>
          {urgent
            ? `Non puoi impastare adesso? In frigo ${nm} rallenta e peggiora più piano.`
            : `Non impasti entro le ${fmtClock(g.lateAtStay, now)}? Metti ${nm} in frigo adesso: regge fino alle ${fmtClock(g.lateAtFridge, now)} (+${fmtSpanH(g.gainH * 3_600_000)}).`}
        </div>
        {/* Oltre vuol dire impastare: il frigo è il piano B, mai il primario. */}
        <Btn variant="secondary" onClick={() => moveTo(it, 'frigo')}>
          Mett{f ? 'ila' : 'ilo'} in frigo{urgent ? ' (rallenta)' : ''}
        </Btn>
      </Card>
    );
  };

  const label = { ...MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--pm4-tan)' };
  function row(k: string, v: string) {
    return (
      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, ...MONO, fontSize: '0.9rem', lineHeight: 1.9 }}>
        <span style={{ color: 'var(--pm4-tan)' }}>{k}</span>
        <span style={{ color: 'var(--pm4-flour)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{v}</span>
      </div>
    );
  }
  const placePicker = (it: StageItem, lbl: string) => (
    <SnapButtons<PrefPlace>
      label={lbl}
      options={(['fresco', 'stanza', 'frigo'] as PrefPlace[]).map(pl => ({ value: pl, label: PLACE_LABEL[pl], desc: `~${placeTempC(pl, fridge)}°C` }))}
      value={spotOf(it).place}
      onChange={pl => moveTo(it, pl)}
    />
  );

  const mainState = main ? itemState(main, now) : null;
  const dosesOpen = (!stage.mixedAck && (mainState?.pct ?? 0) < 15) || showDoses;
  const autolysis = recipe.prefs.filter(g => g.type === 'autolysis');
  // Acqua dell'impasto finale: temperatura dei prefermenti dove sono adesso, pesata sulla massa.
  const prefsNow = prefs.map(p => {
    const it = items.find(x => x.id === p.id);
    return it ? { ...p, tempC: spotOf(it).tempC } : p;
  });
  const tPrefNow = prefTempAtMix(prefsNow, draft.totalFlourGrams ?? 1000);
  const finalWater = finalWaterAdvice(draft, tPrefNow);
  const title = level === 'growing' ? `${Name} sta maturando`
    : level === 'ready' ? `${Name} è ${readyWord(fem)}`
      : `${Name} è oltre da ${fmtSpanH(now - (focus?.lateAt ?? readyMs))}`;
  const big = level === 'growing' ? fmtClock(readyMs, now) : level === 'ready' ? readyWord(fem).toUpperCase() : level === 'late' ? 'OLTRE' : 'TROPPO OLTRE';
  const heroColor = LEVEL_COLOR[level];
  const win = status?.window;
  const timerLabel = level === 'growing' ? `${cap(readyWord(fem))} alle ${fmtClock(readyMs, now)}`
    : level === 'ready' ? `${cap(readyWord(fem))} dalle ${fmtClock(readyMs, now)}`
      : `${level === 'veryLate' ? 'Troppo oltre' : 'Oltre'} dalle ${fmtClock(focus?.lateAt ?? readyMs, now)}`;

  // Impasto finale: un impasto in corso blocca, poi le conferme in fila.
  const ctaBlock = (state.activeSession ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div role="status" style={{ ...MONO, fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--pm4-tan)' }}>
            C'è un impasto in corso: per avviarne un altro, prima terminalo.
          </div>

        </div>
      ) : pending ? (
        <div role="status" style={{ ...MONO, fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--pm4-tan)' }}>
          L'impasto finale si sblocca quando hai impastato anche {prefWithArticle(pending.it.type)}{pending.overdueMs > 0 ? ', o se procedi senza.' : ` (alle ${fmtClock(new Date(pending.it.startAt), now)}).`}
        </div>
      ) : confirm && confirm !== 'skip' ? (
        <div ref={confirmRef} tabIndex={-1} role="group" aria-label="Conferma impasto finale" style={{ display: 'flex', flexDirection: 'column', gap: 10, outline: 'none' }}>
          {confirm === 'veryLate' && worst && (<>
            <div style={{ ...MONO, fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--state-critical)' }}>
              {cap(prefWithArticle(worst.it.type))} è al ~{Math.round(worst.pct)}%: l'impasto può venire acido e meno strutturato.
            </div>
            <Btn onClick={() => setConfirm(null)}>Aspetto, {prefIsFeminine(worst.it.type) ? 'la' : 'lo'} controllo</Btn>
            <Btn variant="secondary" onClick={() => goOn('veryLate')}>Impasto lo stesso</Btn>
          </>)}
          {confirm === 'early' && leastRipe && (<>
            <div style={{ ...MONO, fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--pm4-ember-lo)' }}>
              {cap(prefWithArticle(leastRipe.it.type))} è al ~{Math.round(leastRipe.pct)}%: l'impasto partirà meno maturo e ci metterà di più.
            </div>
            <Btn onClick={() => setConfirm(null)}>Aspetto</Btn>
            <Btn variant="secondary" onClick={() => goOn('early')}>Impasto lo stesso</Btn>
          </>)}
          {confirm === 'service' && target && (<>
            <div style={{ ...MONO, fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--pm4-flour)' }}>
              Impasti {shiftMs > 0 ? `${fmtSpanH(shiftMs)} dopo` : `${fmtSpanH(-shiftMs)} prima di`} quanto previsto. Il servizio?
            </div>
            <Btn onClick={() => { setConfirm(null); startDough(false); }}>Tengo il servizio alle {fmtClock(target, now)}</Btn>
            <Btn variant="secondary" onClick={() => { setConfirm(null); startDough(true); }}>
              Sposto il servizio alle {fmtClock(new Date(target.getTime() + shiftMs), now)}
            </Btn>
            <Btn variant="secondary" onClick={() => setConfirm(null)}>Non ancora</Btn>
          </>)}
        </div>
      ) : !dosesOpen ? (
        <div ref={readyRef}>
          {/* Primario solo quando è il momento: mai due primari (con il frigo urgente resta secondario) */}
          <Btn variant={level === 'growing' ? 'secondary' : 'primary'} onClick={() => goOn(null)}>
            {level === 'late' || level === 'veryLate'
              ? 'Impasto finale (è oltre) →'
              : level === 'growing' || started.some(x => x.pct < 100)
                ? 'Impasto finale adesso →'
                : many ? `Sono ${readyWord(allFem, true)}: impasto finale →` : `È ${readyWord(fem)}: impasto finale →`}
          </Btn>
        </div>
      ) : null);
  // Quando è il momento (pronta, oltre) l'azione sta subito sotto l'orario, non in fondo.
  const ctaUp = level !== 'growing';

  return (
    <div style={{ padding: '24px var(--padding-h) max(24px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560, margin: '0 auto' }}>
      <div style={label}>Prefermento · in corso</div>

      {/* Hero: il prefermento più urgente */}
      <div>
        <h2 ref={titleRef} tabIndex={-1} style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: level === 'growing' ? 'var(--pm4-flour)' : heroColor, outline: 'none' }}>
          {title}
        </h2>
        {level === 'growing' && <div style={{ ...label, marginTop: 10 }}>{readyWord(fem)} alle</div>}
        <div role="timer" aria-live="off" aria-label={timerLabel}
          style={{ ...MONO, marginTop: 10, fontSize: 35, fontWeight: 800, lineHeight: 1, color: heroColor, fontVariantNumeric: 'tabular-nums' }}>
          {big}
        </div>
        <div style={{ ...MONO, marginTop: 8, fontSize: '0.9rem', color: 'var(--pm4-tan)' }}>
          maturazione ~{Math.round(focus?.pct ?? 0)}% · {level === 'growing'
            ? `${readyWord(fem)} tra ${fmtSpanH(readyMs - now)}`
            : `era ${readyWord(fem)} alle ${fmtClock(readyMs, now)}${level === 'ready' ? ' · controlla i segni' : ''}`}
        </div>
        <div aria-hidden="true" style={{ marginTop: 12, height: 6, borderRadius: 3, background: 'var(--pm4-line)' }}>
          <div style={{ width: `${Math.min(100, focus?.pct ?? 0)}%`, height: '100%', borderRadius: 3, background: BAR_COLOR[level] }} />
        </div>
        {/* La finestra per l'impasto finale: la vera domanda è "entro quando" */}
        {win && level !== 'late' && level !== 'veryLate' && (
          <div style={{ ...MONO, marginTop: 10, fontSize: '0.9rem', fontWeight: 700, color: win.from > win.to ? 'var(--state-critical)' : 'var(--pm4-flour)' }}>
            {win.from > win.to
              // Nessuna finestra: uno va oltre prima che l'ultimo sia pronto.
              ? `⚠ Non sono pronti insieme: ${prefWithArticle(status!.all.reduce((a, b) => (b.lateAt < a.lateAt ? b : a)).it.type)} va oltre alle ${fmtClock(win.to, now)}, prima che tutto sia pronto (${fmtClock(win.from, now)})`
              : now < win.from
                ? `Impasto finale tra le ${fmtClock(win.from, now)} e le ${fmtClock(win.to, now)}`
                : `Impasta entro le ${fmtClock(win.to, now)}`}
            {win.from <= win.to && (() => {
              const h = new Date(Math.max(win.from, now)).getHours();
              return h >= 23 || h < 6
                ? <div style={{ fontWeight: 400, color: 'var(--pm4-tan)', marginTop: 4 }}>Cade di notte: in frigo puoi spostarla al mattino.</div>
                : null;
            })()}
          </div>
        )}
        <div style={{ ...MONO, marginTop: 8, fontSize: 11, color: 'var(--pm4-umber)' }}>
          {fIt?.id === main?.id && !stage.mixedAck && (focus?.pct ?? 0) < 15
            ? `Da impastare adesso · ${PLACE[spot.place]} (~${Math.round(spot.tempC)}°C)`
            : `${fem ? 'Impastata' : 'Impastato'} alle ${fmtClock(fIt?.mixedAt ?? startMs, now)} · ora ${PLACE[spot.place]} (~${Math.round(spot.tempC)}°C)`}
        </div>
        {(level === 'late' || level === 'veryLate') && (
          <div role="alert" style={{ ...MONO, marginTop: 8, fontSize: '0.9rem', lineHeight: 1.5, color: heroColor }}>
            ⚠ {overSign(type)}.{level === 'veryLate'
              ? ` Controlla${fem ? 'la' : 'lo'} prima di usar${fem ? 'la' : 'lo'}: l'impasto può venire acido e meno strutturato. Se è oltre puoi usarne meno, o rinfrescar${fem ? 'la' : 'lo'} con farina e acqua prima dell'impasto finale.`
              : ''}
          </div>
        )}
      </div>

      {ctaUp && ctaBlock}

      {/* Adesso: le dosi del principale */}
      {main && (dosesOpen ? (
        <Card elevated>
          <div style={{ ...label, marginBottom: 8, color: 'var(--accent-brand)' }}>Adesso: impasta {prefWithArticle(main.type)}</div>
          {doses(main)}
          <div style={{ marginTop: 10 }}>
            <Btn onClick={() => { setShowDoses(false); save({ mixedAck: true }); }}>Fatto ✓</Btn>
          </div>
          {!stage.mixedAck && (
            <div style={{ marginTop: 6 }}>
              <MixedAtPicker trigger={`L'ho ${prefIsFeminine(main.type) ? 'impastata' : 'impastato'} prima…`} fem={prefIsFeminine(main.type)}
                onPick={t => {
                  // la biga matura da quando è stata impastata: si sposta tutto il piano
                  const d = t - new Date(main.startAt).getTime();
                  setShowDoses(false);
                  saveItems(items.map(x => x.id === main.id
                    ? { ...x, startAt: new Date(t), mixedAt: new Date(t) }
                    : x.mixedAt ? x : { ...x, startAt: new Date(new Date(x.startAt).getTime() + d) }),
                  { startedAt: new Date(t), mixedAck: true });
                }} />
            </div>
          )}
        </Card>
      ) : (
        <button type="button" onClick={() => setShowDoses(true)} style={{
          alignSelf: 'flex-start', minHeight: 44, background: 'none', border: 'none', cursor: 'pointer',
          ...MONO, fontSize: '0.9rem', color: 'var(--pm4-tan)', textDecoration: 'underline', padding: 0,
        }}>
          Rivedi le dosi {prefIsFeminine(main.type) ? 'della' : 'del'} {prefName(main.type)}
        </button>
      ))}

      {/* Il più urgente: frigo come azione principale se è oltre, poi dove si trova, poi frigo in anticipo */}
      {fIt && fridgeHint(fIt, true)}
      {fIt && focus?.started && placePicker(fIt, others.length ? `Dove si trova ${prefWithArticle(type)}` : 'Dove si trova adesso')}
      {fIt && fridgeHint(fIt, false)}

      {/* Gli altri prefermenti */}
      {others.map(it => {
        const s = itemState(it, now);
        const nm = prefWithArticle(it.type), f = prefIsFeminine(it.type);
        const startAt = new Date(it.startAt).getTime();
        if (!s.started) {
          const due = now >= startAt;
          const overdue = s.overdueMs > 0;
          // Se lo impasti adesso: quando è pronto e se l'altro regge fino ad allora.
          const readyIfNow = now + it.plannedH * 3_600_000;
          const mainLate = mainState?.started ? mainState.lateAt : null;
          const mainFridge = main && mainState?.started && spotOf(main).place !== 'frigo' ? fridgeGain(main, now, fridge) : null;
          // Il principale è già oltre? Aspettare il secondo lo peggiora; il frigo serve solo se arriva in tempo.
          const mainAlreadyLate = mainLate != null && mainLate <= now;
          const waitingHurts = mainLate != null && mainLate < readyIfNow;
          // Il frigo aiuta solo se porta a una finestra vera: rallenta anche il pronto del principale.
          const fp = main && mainFridge ? fridgePlan(main, it, now, fridge) : null;
          const fridgeHelps = !mainAlreadyLate && !!fp?.window;
          return (
            <Card key={it.id} elevated={due}>
              <div style={{ ...label, marginBottom: 8, color: overdue ? 'var(--state-critical)' : due ? 'var(--accent-brand)' : 'var(--pm4-tan)' }}>
                {overdue ? `${cap(nm)}: da impastare (era alle ${fmtClock(startAt, now)})` : due ? `Adesso: impasta ${nm}` : `Poi: ${nm} alle ${fmtClock(startAt, now)}`}
              </div>
              {!due && (() => {
                // L'orario si può spostare: chi lo impasta decide, la vista dice cosa cambia.
                const readyAtShifted = startAt + it.plannedH * 3_600_000;
                const mainReady = mainState?.etaMs ?? readyAtShifted;
                const together = Math.abs(readyAtShifted - mainReady) < 10 * 60_000;
                const hour = new Date(startAt).getHours();
                const night = hour >= 23 || hour < 6;
                const shift = (h: number) => updateItem(it.id, { startAt: new Date(Math.max(Date.now(), startAt + h * 3_600_000)) });
                return (
                  <>
                    <div style={{ ...MONO, fontSize: 11, color: 'var(--pm4-umber)', lineHeight: 1.5, marginBottom: 6 }}>
                      Tra {fmtSpanH(startAt - now)}: {together
                        ? `così ${f ? 'è pronta' : 'è pronto'} insieme ${main ? prefAl(main.type) : ''}.`
                        : `${f ? 'pronta' : 'pronto'} alle ${fmtClock(readyAtShifted, now)}.`} Ti avviso.
                      {night && ' Cade di notte: puoi anticiparlo e tenerlo più al fresco, o spostarlo dopo.'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <div style={{ flex: 1 }}><Btn variant="secondary" disabled={startAt - 3_600_000 < now} onClick={() => shift(-1)}>Anticipa 1 h</Btn></div>
                      <div style={{ flex: 1 }}><Btn variant="secondary" onClick={() => shift(1)}>Posticipa 1 h</Btn></div>
                    </div>
                  </>
                );
              })()}
              {overdue && (
                <div style={{ ...MONO, fontSize: '0.9rem', color: 'var(--pm4-flour)', lineHeight: 1.5, marginBottom: 8 }}>
                  Sei in ritardo di {fmtSpanH(s.overdueMs)}. Se {f ? 'la' : 'lo'} impasti adesso è {readyWord(f)} alle {fmtClock(readyIfNow, now)}
                  {main && mainLate != null && (mainAlreadyLate
                    ? `, ma ${prefWithArticle(main.type)} è già oltre da ${fmtSpanH(now - mainLate)}: aspettare ${nm} ${prefIsFeminine(main.type) ? 'la' : 'lo'} porterebbe ancora più avanti. Conviene procedere senza.`
                    : waitingHurts
                      ? `, ma ${prefWithArticle(main.type)} va oltre alle ${fmtClock(mainLate, now)}.${fridgeHelps
                        ? ` In frigo ${prefIsFeminine(main.type) ? 'la' : 'lo'} rallenti: pronti insieme tra le ${fmtClock(fp!.window!.from, now)} e le ${fmtClock(fp!.window!.to, now)}.`
                        : mainFridge
                          ? ' Anche in frigo non sarebbero pronti insieme: conviene procedere senza.'
                          : ' Conviene procedere senza.'}`
                      : `, in tempo per ${prefWithArticle(main.type)}.`)}
                </div>
              )}
              {doses(it)}
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Un solo primario: la scelta che conviene. L'utente decide comunque. */}
                {overdue && waitingHurts && fridgeHelps && main ? (
                  <Btn onClick={() => {
                    const t = new Date();
                    saveItems(items.map(x => x.id === main.id
                      ? { ...x, moves: [...(x.moves ?? []), { at: t, place: 'frigo' as PrefPlace, tempC: placeTempC('frigo', fridge) }] }
                      : x.id === it.id ? { ...x, mixedAt: t } : x));
                  }}>
                    Metti {prefWithArticle(main.type)} in frigo e impasta {nm} ✓
                  </Btn>
                ) : null}
                {overdue && waitingHurts && !fridgeHelps && (
                  confirm === 'skip' ? null : <div className="pm-skip"><Btn onClick={() => setConfirm('skip')}>Procedi senza {nm}</Btn></div>
                )}
                {due ? (
                  <Btn variant={!(overdue && waitingHurts) ? 'primary' : 'secondary'} onClick={() => updateItem(it.id, { mixedAt: new Date() })}>
                    {overdue ? `L${f ? 'a' : 'o'} impasto adesso ✓` : 'Fatto ✓'}
                  </Btn>
                ) : null}
                {/* impastato prima (o già fatto): l'ora vera, non quella del tocco */}
                <MixedAtPicker trigger={due ? `L'ho impastat${f ? 'a' : 'o'} prima…` : `L'ho già impastat${f ? 'a' : 'o'}…`} fem={f}
                  onPick={t => updateItem(it.id, { mixedAt: new Date(t) })} />
                {overdue && (
                  confirm === 'skip' ? (
                    <div ref={confirmRef} tabIndex={-1} role="group" aria-label={`Procedi senza ${nm}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, outline: 'none' }}>
                      <div style={{ ...MONO, fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--pm4-tan)' }}>
                        Senza {nm} la sua farina e la sua acqua vanno nell'impasto finale. Confermi?
                      </div>
                      <Btn variant="danger" onClick={() => skipItem(it)}>Sì, procedi senza</Btn>
                      <Btn variant="secondary" onClick={() => {
                        setConfirm(null);
                        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.pm-skip button')?.focus());
                      }}>No</Btn>
                    </div>
                  ) : !(waitingHurts && !fridgeHelps) ? (
                    <div className="pm-skip"><Btn variant="secondary" onClick={() => setConfirm('skip')}>Procedi senza {nm}</Btn></div>
                  ) : null
                )}
              </div>
            </Card>
          );
        }
        return (
          <Card key={it.id}>
            <div style={{ ...label, marginBottom: 6 }}>{cap(prefName(it.type))}</div>
            <div style={{ ...MONO, fontSize: '0.9rem', color: LEVEL_COLOR[s.level], marginBottom: 10 }}>
              ~{Math.round(s.pct)}% · {s.level === 'growing' ? `${readyWord(f)} alle ${fmtClock(s.etaMs, now)}`
                : s.level === 'ready' ? `${readyWord(f)} · controlla i segni` : `oltre da ${fmtSpanH(now - s.lateAt)} · ${overSign(it.type)}`}
            </div>
            {placePicker(it, `Dove si trova ${nm}`)}
            {fridgeHint(it, true)}
            {fridgeHint(it, false)}
          </Card>
        );
      })}

      {/* Segni */}
      <Card>
        {(() => {
          // I segni di ciascun prefermento impastato (il più urgente per primo).
          const shown = [fIt, ...others].filter((x): x is StageItem => !!x && (x.id === fIt?.id || !!x.mixedAt));
          return shown.map((x, i) => (
            <div key={x.id} style={{ marginTop: i ? 12 : 0 }}>
              <div style={{ ...label, marginBottom: 8 }}>
                {shown.length > 1 ? `${cap(prefName(x.type))}: come capire che è ${readyWord(prefIsFeminine(x.type))}` : `Come capire che è ${readyWord(prefIsFeminine(x.type))}`}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.9rem', lineHeight: 1.45, color: 'var(--pm4-flour)' }}>
                {readySigns(x.type).map(sg => <li key={sg}>{sg}</li>)}
              </ul>
            </div>
          ));
        })()}
      </Card>

      {/* Impasto finale */}
      <Card>
        <div style={{ ...label, marginBottom: 8 }}>Per l'impasto finale prepara</div>
        {recipe.prefs.filter(g => g.type !== 'autolysis').map(g => row(`${cap(prefName(g.type))} (${prefIsFeminine(g.type) ? 'tutta' : 'tutto'})`, fmtGrams(g.totalG)))}
        {row('Farina', fmtGrams(recipe.final.flourG))}
        {row('Acqua', recipe.final.waterG >= 1 ? fmtGrams(recipe.final.waterG) : '—')}
        {row('Sale', fmtGrams(recipe.final.saltG))}
        {recipe.final.fatG > 0 && row('Grassi', fmtGrams(recipe.final.fatG))}
        {recipe.final.yeastG > 0 && row(yeastLabel, fmtGrams(recipe.final.yeastG))}
        {autolysis.map(g => (
          <div key={g.id} style={{ ...MONO, marginTop: 6, fontSize: 11, color: 'var(--pm4-flour)', lineHeight: 1.5 }}>
            Autolisi: {fmtGrams(g.flourG)} farina + {fmtGrams(g.waterG)} acqua, mescolate ~{Math.max(0.5, prefs.find(p => p.id === g.id)?.durationH ?? 1)} h prima dell'impasto finale.
          </div>
        ))}
        {finalWater && (
          <div style={{ ...MONO, marginTop: 6, fontSize: 11, color: 'var(--pm4-umber)', lineHeight: 1.5 }}>
            Con i prefermenti dove sono adesso (~{Math.round(tPrefNow ?? spot.tempC)}°C): {finalWater}.
          </div>
        )}
      </Card>

      {error && <div role="alert" style={{ ...MONO, fontSize: '0.9rem', color: 'var(--state-critical)' }}>{error}</div>}

      {!ctaUp && ctaBlock}

      {confirmCancel ? (
        <div ref={cancelRef} tabIndex={-1} role="group" aria-label="Conferma annullamento" style={{ display: 'flex', flexDirection: 'column', gap: 10, outline: 'none' }}>
          <div style={{ ...MONO, fontSize: '0.9rem', color: 'var(--pm4-tan)' }}>Annullo la preparazione? Non resta nello Storico.</div>
          <Btn variant="danger" onClick={removeStage}>Sì, annulla</Btn>
          <Btn variant="secondary" onClick={() => setConfirmCancel(false)}>No, continua</Btn>
        </div>
      ) : (
        <div ref={cancelRef} style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><Btn variant="secondary" onClick={() => dispatch({ type: 'NAV', view: state.activeSession ? 'dashboard' : 'home' })}>
            {state.activeSession ? '← Impasto in corso' : '← Home'}
          </Btn></div>
          <div style={{ flex: 1 }}><Btn variant="secondary" onClick={() => setConfirmCancel(true)}>Annulla</Btn></div>
        </div>
      )}
    </div>
  );
}
