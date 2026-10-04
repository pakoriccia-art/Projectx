/**
 * PizzaMatrix — prefermenti in maturazione.
 *
 * La fase prima dell'impasto finale. Ogni prefermento ha il suo orologio
 * (tempo termico con fArrhenius del motore, anche se cambia posto): il più
 * lungo parte subito, gli altri più tardi per essere pronti insieme. La vista
 * dice cosa impastare adesso, a che punto è ciascuno, quando conviene il frigo
 * e cosa preparare dopo. Alla conferma "è pronta" le ore e le temperature
 * vissute entrano nella ricetta e parte la sessione dell'impasto.
 */
import { useEffect, useRef, useState } from 'react';
import { useApp, type WizardDraft } from '../../context/AppContext';
import { Btn, Card, SnapButtons } from '../ui';
import { launchSession } from '../wizard/WizardView';
import { deleteAllPrefermentStages, deletePrefermentStage, updatePrefermentStage } from '../../services/sessionService';
import type { PrefermentStage } from '../../db/db';
import {
  EARLY_PCT, FRIDGE_HINT_PCT, currentSpot, elapsedPrefHours, equivalentTempC, finalWaterAdvice,
  fmtGrams, fmtSpanH, fridgeGain, isPreparable, itemClock, itemProgress, lateLevel, normalizeStage,
  overSign, placeOf, placeTempC, prefDdtC, prefIsFeminine, prefName, prefWithArticle, readySigns,
  splitRecipe, stageReadyAt, waterAdvice, itemLateAt, type LateLevel, type PrefPlace, type StageItem,
} from '../../lib/preferment';

const MONO = { fontFamily: 'var(--font-mono)' } as const;
const PLACE: Record<PrefPlace, string> = { fresco: 'in un posto fresco', stanza: 'a temperatura ambiente', frigo: 'in frigo' };
const PLACE_LABEL: Record<PrefPlace, string> = { fresco: 'Fresco', stanza: 'Stanza', frigo: 'Frigo' };
/** Sotto questo scarto dall'orario del piano non si chiede nulla. */
const SHIFT_ASK_MS = 15 * 60_000;

function fmtClock(d: Date | number, now: number): string {
  const x = new Date(d);
  const t = x.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return x.toDateString() === new Date(now).toDateString()
    ? t : `${x.toLocaleDateString('it-IT', { weekday: 'short' })} ${t}`;
}

const cap = (t: string) => t.replace(/^./, c => c.toUpperCase());
const LEVEL_COLOR: Record<LateLevel, string> = {
  growing: 'var(--pm4-flour)', ready: 'var(--pm4-ember-lo)', late: 'var(--state-critical)', veryLate: 'var(--state-critical)',
};

type Confirm = null | 'early' | 'veryLate' | 'service';

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
  const secondaries = items.slice(1);
  const type = main?.type ?? 'biga';
  const fem = prefIsFeminine(type);
  const Name = cap(prefWithArticle(type));
  const fridge = draft.fridgeTempC ?? 4;
  const mainProg = main ? itemProgress(main, now) : { pct: 0, etaMs: now, started: false };
  const mainLevel = lateLevel(type, mainProg.pct);
  const readyMs = mainProg.etaMs;
  // "Oltre da" si conta dalla soglia di ritardo, come nel banner e nelle notifiche.
  const mainLateAt = main ? itemLateAt(main, now) : null;
  const spotOf = (it: StageItem) => currentSpot(it, prefOf(it) ? placeOf(prefOf(it)!) : 'fresco');
  const spot = main ? spotOf(main) : { place: 'fresco' as PrefPlace, tempC: 16 };
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
  const updateItem = (id: string, patch: Partial<StageItem>) => {
    const t = Date.now();
    const nextItems = items.map(it => (it.id === id ? { ...it, ...patch } : it));
    setNow(t);   // l'orologio della vista va al momento della modifica
    save({ items: nextItems, readyAt: new Date(stageReadyAt(nextItems, t)) });
  };
  const moveTo = (it: StageItem, place: PrefPlace) => {
    if (place === spotOf(it).place) return;
    updateItem(it.id, { moves: [...(it.moves ?? []), { at: new Date(), place, tempC: placeTempC(place, fridge) }] });
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

  const progs = items.map(it => ({ it, p: itemProgress(it, now) }));
  const anyVeryLate = progs.some(({ it, p }) => p.started && lateLevel(it.type, p.pct) === 'veryLate');
  const anyEarly = progs.some(({ p }) => p.started && p.pct < EARLY_PCT);
  const pendingSecondary = secondaries.find(it => !it.mixedAt);
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
        {w && <div style={{ ...MONO, fontSize: 12, color: 'var(--pm4-umber)', lineHeight: 1.5 }}>Per un impasto a ~{prefDdtC(g.type)}°C: {w}.</div>}
      </>
    );
  };

  // Frigo: in anticipo dall'85%, come azione principale quando è già oltre.
  const fridgeHint = (it: StageItem, urgent: boolean) => {
    const p = itemProgress(it, now);
    if (!p.started || spotOf(it).place === 'frigo') return null;
    const lvl = lateLevel(it.type, p.pct);
    if (!urgent && (p.pct < FRIDGE_HINT_PCT || lvl === 'late' || lvl === 'veryLate')) return null;
    if (urgent && lvl !== 'late' && lvl !== 'veryLate') return null;
    const g = fridgeGain(it, now, fridge);
    const nm = prefWithArticle(it.type), f = prefIsFeminine(it.type);
    return (
      <Card key={`fr-${it.id}`} elevated>
        <div style={{ ...MONO, fontSize: 13, lineHeight: 1.5, color: 'var(--pm4-flour)', marginBottom: 10 }}>
          {urgent
            ? `${cap(nm)} è oltre: in frigo rallenta e ti dà tempo per impastare.`
            : `Se non impasti entro le ${fmtClock(g.lateAtStay, now)}, metti ${nm} in frigo: regge fino alle ${fmtClock(g.lateAtFridge, now)} (+${fmtSpanH(g.gainH * 3_600_000)}).`}
        </div>
        <Btn variant={urgent ? 'primary' : 'secondary'} onClick={() => moveTo(it, 'frigo')}>
          Mett{f ? 'ila' : 'ilo'} in frigo{urgent ? ' (rallenta)' : ''}
        </Btn>
      </Card>
    );
  };

  const label = { ...MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--pm4-tan)' };
  function row(k: string, v: string) {
    return (
      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, ...MONO, fontSize: 13, lineHeight: 1.9 }}>
        <span style={{ color: 'var(--pm4-tan)' }}>{k}</span>
        <span style={{ color: 'var(--pm4-flour)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{v}</span>
      </div>
    );
  }

  const dosesOpen = (!stage.mixedAck && mainProg.pct < 15) || showDoses;
  const autolysis = recipe.prefs.filter(g => g.type === 'autolysis');
  const finalWater = finalWaterAdvice(draft, spot.tempC);
  const title = mainLevel === 'growing' ? `${Name} sta maturando`
    : mainLevel === 'ready' ? `${Name} è ${fem ? 'pronta' : 'pronto'}`
      : `${Name} è oltre da ${fmtSpanH(now - (mainLateAt ?? readyMs))}`;
  const big = mainLevel === 'growing' ? fmtClock(readyMs, now) : mainLevel === 'ready' ? 'PRONTA' : 'OLTRE';
  const heroColor = LEVEL_COLOR[mainLevel];

  return (
    <div style={{ padding: '24px var(--padding-h) max(24px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560, margin: '0 auto' }}>
      <div style={label}>Prefermento · in corso</div>

      {/* Hero: il prefermento principale (il più lungo) */}
      <div>
        <h2 ref={titleRef} tabIndex={-1} style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: mainLevel === 'growing' ? 'var(--pm4-flour)' : heroColor, outline: 'none' }}>
          {title}
        </h2>
        <div role="timer" aria-live="off"
          aria-label={mainLevel === 'growing' ? `${fem ? 'Pronta' : 'Pronto'} alle ${fmtClock(readyMs, now)}` : `${fem ? 'Pronta' : 'Pronto'} dalle ${fmtClock(readyMs, now)}`}
          style={{ ...MONO, marginTop: 10, fontSize: 44, fontWeight: 800, lineHeight: 1, color: heroColor, fontVariantNumeric: 'tabular-nums' }}>
          {big}
        </div>
        <div style={{ ...MONO, marginTop: 8, fontSize: 13, color: 'var(--pm4-tan)' }}>
          maturazione ~{Math.round(mainProg.pct)}% · {mainLevel === 'growing'
            ? `${fem ? 'pronta' : 'pronto'} tra ${fmtSpanH(readyMs - now)}`
            : `era ${fem ? 'pronta' : 'pronto'} alle ${fmtClock(readyMs, now)}${mainLevel === 'ready' ? ' · controlla i segni' : ''}`}
        </div>
        <div aria-hidden="true" style={{ marginTop: 12, height: 6, borderRadius: 3, background: 'var(--pm4-line)' }}>
          <div style={{ width: `${Math.min(100, mainProg.pct)}%`, height: '100%', borderRadius: 3, background: mainLevel === 'growing' ? 'var(--pm4-tan)' : heroColor }} />
        </div>
        <div style={{ ...MONO, marginTop: 8, fontSize: 12, color: 'var(--pm4-umber)' }}>
          {fem ? 'Impastata' : 'Impastato'} alle {fmtClock(startMs, now)} · ora {PLACE[spot.place]} (~{Math.round(spot.tempC)}°C)
        </div>
      </div>

      {/* Adesso: le dosi del principale */}
      {main && (dosesOpen ? (
        <Card elevated>
          <div style={{ ...label, marginBottom: 8, color: 'var(--accent-brand)' }}>Adesso: impasta {prefWithArticle(type)}</div>
          {doses(main)}
          <div style={{ marginTop: 10 }}>
            <Btn onClick={() => { setShowDoses(false); save({ mixedAck: true }); }}>Fatto ✓</Btn>
          </div>
        </Card>
      ) : (
        <button type="button" onClick={() => setShowDoses(true)} style={{
          alignSelf: 'flex-start', minHeight: 44, background: 'none', border: 'none', cursor: 'pointer',
          ...MONO, fontSize: 13, color: 'var(--pm4-tan)', textDecoration: 'underline', padding: 0,
        }}>
          Rivedi le dosi {fem ? 'della' : 'del'} {prefName(type)}
        </button>
      ))}

      {/* Già oltre: il frigo è l'azione principale */}
      {main && fridgeHint(main, true)}

      {/* Dove si trova adesso il principale */}
      {main && (
        <SnapButtons<PrefPlace>
          label={secondaries.length ? `Dove si trova ${prefWithArticle(type)}` : 'Dove si trova adesso'}
          options={(['fresco', 'stanza', 'frigo'] as PrefPlace[]).map(pl => ({
            value: pl, label: PLACE_LABEL[pl], desc: `~${placeTempC(pl, fridge)}°C`,
          }))}
          value={spot.place}
          onChange={pl => moveTo(main, pl)}
        />
      )}

      {/* Frigo in anticipo */}
      {main && fridgeHint(main, false)}

      {/* Gli altri prefermenti: ognuno col suo orario */}
      {secondaries.map(it => {
        const p = itemProgress(it, now);
        const nm = prefWithArticle(it.type), f = prefIsFeminine(it.type);
        const startAt = new Date(it.startAt).getTime();
        const lvl = p.started ? lateLevel(it.type, p.pct) : 'growing';
        if (!p.started) {
          const due = now >= startAt;
          return (
            <Card key={it.id} elevated={due}>
              <div style={{ ...label, marginBottom: 8, color: due ? 'var(--accent-brand)' : 'var(--pm4-tan)' }}>
                {due ? `Adesso: impasta ${nm}` : `Poi: ${nm} alle ${fmtClock(startAt, now)}`}
              </div>
              {!due && (
                <div style={{ ...MONO, fontSize: 12, color: 'var(--pm4-umber)', lineHeight: 1.5, marginBottom: 6 }}>
                  Tra {fmtSpanH(startAt - now)}: così {f ? 'è pronta' : 'è pronto'} insieme a {prefWithArticle(type)}. Ti avviso.
                </div>
              )}
              {doses(it)}
              <div style={{ marginTop: 10 }}>
                <Btn variant={due ? 'primary' : 'secondary'} onClick={() => updateItem(it.id, { mixedAt: new Date() })}>
                  {due ? 'Fatto ✓' : `L'ho già impastat${f ? 'a' : 'o'}`}
                </Btn>
              </div>
            </Card>
          );
        }
        const sp = spotOf(it);
        return (
          <Card key={it.id}>
            <div style={{ ...label, marginBottom: 6 }}>{cap(prefName(it.type))}</div>
            <div style={{ ...MONO, fontSize: 13, color: LEVEL_COLOR[lvl], marginBottom: 10 }}>
              ~{Math.round(p.pct)}% · {lvl === 'growing' ? `${f ? 'pronta' : 'pronto'} alle ${fmtClock(p.etaMs, now)}`
                : lvl === 'ready' ? `${f ? 'pronta' : 'pronto'} · controlla i segni` : `oltre da ${fmtSpanH(now - (itemLateAt(it, now) ?? p.etaMs))} · ${overSign(it.type)}`}
            </div>
            <SnapButtons<PrefPlace>
              label={`Dove si trova ${nm}`}
              options={(['fresco', 'stanza', 'frigo'] as PrefPlace[]).map(pl => ({ value: pl, label: PLACE_LABEL[pl], desc: `~${placeTempC(pl, fridge)}°C` }))}
              value={sp.place}
              onChange={pl => moveTo(it, pl)}
            />
            {fridgeHint(it, true)}
            {fridgeHint(it, false)}
          </Card>
        );
      })}

      {/* Segni */}
      <Card>
        <div style={{ ...label, marginBottom: 8 }}>Come capire che è {fem ? 'pronta' : 'pronto'}</div>
        {(mainLevel === 'late' || mainLevel === 'veryLate') && (
          <div role="alert" style={{ ...MONO, fontSize: 13, lineHeight: 1.5, color: 'var(--state-critical)', marginBottom: 8 }}>
            ⚠ {overSign(type)}.
          </div>
        )}
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, lineHeight: 1.45, color: 'var(--pm4-flour)' }}>
          {readySigns(type).map(s => <li key={s}>{s}</li>)}
        </ul>
      </Card>

      {/* Impasto finale */}
      <Card>
        <div style={{ ...label, marginBottom: 8 }}>Per l'impasto finale prepara</div>
        {recipe.prefs.filter(g => g.type !== 'autolysis').map(g => row(`${cap(prefName(g.type))} (${prefIsFeminine(g.type) ? 'tutta' : 'tutto'})`, fmtGrams(g.totalG)))}
        {row('Farina', fmtGrams(recipe.final.flourG))}
        {row('Acqua', fmtGrams(recipe.final.waterG))}
        {row('Sale', fmtGrams(recipe.final.saltG))}
        {recipe.final.fatG > 0 && row('Grassi', fmtGrams(recipe.final.fatG))}
        {recipe.final.yeastG > 0 && row(yeastLabel, fmtGrams(recipe.final.yeastG))}
        {autolysis.map(g => (
          <div key={g.id} style={{ ...MONO, marginTop: 6, fontSize: 12, color: 'var(--pm4-flour)', lineHeight: 1.5 }}>
            Autolisi: {fmtGrams(g.flourG)} farina + {fmtGrams(g.waterG)} acqua, mescolate ~{Math.max(0.5, prefs.find(p => p.id === g.id)?.durationH ?? 1)} h prima dell'impasto finale.
          </div>
        ))}
        {finalWater && (
          <div style={{ ...MONO, marginTop: 6, fontSize: 12, color: 'var(--pm4-umber)', lineHeight: 1.5 }}>
            Con {prefWithArticle(type)} a ~{Math.round(spot.tempC)}°C: {finalWater}.
          </div>
        )}
      </Card>

      {error && <div role="alert" style={{ ...MONO, fontSize: 13, color: 'var(--state-critical)' }}>{error}</div>}

      {/* Impasto finale: un impasto in corso blocca, poi le conferme in fila */}
      {state.activeSession ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div role="status" style={{ ...MONO, fontSize: 13, lineHeight: 1.5, color: 'var(--pm4-tan)' }}>
            C'è un impasto in corso: per avviarne un altro, prima terminalo.
          </div>
          <Btn variant="secondary" onClick={() => dispatch({ type: 'NAV', view: 'dashboard' })}>Vai all'impasto in corso</Btn>
        </div>
      ) : pendingSecondary ? (
        <div role="status" style={{ ...MONO, fontSize: 13, lineHeight: 1.5, color: 'var(--pm4-tan)' }}>
          L'impasto finale si sblocca quando hai impastato anche {prefWithArticle(pendingSecondary.type)} (alle {fmtClock(new Date(pendingSecondary.startAt), now)}).
        </div>
      ) : confirm ? (
        <div ref={confirmRef} tabIndex={-1} role="group" aria-label="Conferma impasto finale" style={{ display: 'flex', flexDirection: 'column', gap: 10, outline: 'none' }}>
          {confirm === 'veryLate' && (<>
            <div style={{ ...MONO, fontSize: 13, lineHeight: 1.5, color: 'var(--state-critical)' }}>
              {Name} è al ~{Math.round(Math.max(...progs.filter(x => x.p.started).map(x => x.p.pct)))}%: l'impasto può venire acido e meno strutturato.
            </div>
            <Btn onClick={() => setConfirm(null)}>Aspetto, la controllo</Btn>
            <Btn variant="secondary" onClick={() => goOn('veryLate')}>Impasto lo stesso</Btn>
          </>)}
          {confirm === 'early' && (<>
            <div style={{ ...MONO, fontSize: 13, lineHeight: 1.5, color: 'var(--pm4-ember-lo)' }}>
              {Name} è al ~{Math.round(mainProg.pct)}%: l'impasto partirà meno maturo e ci metterà di più.
            </div>
            <Btn onClick={() => setConfirm(null)}>Aspetto</Btn>
            <Btn variant="secondary" onClick={() => goOn('early')}>Impasto lo stesso</Btn>
          </>)}
          {confirm === 'service' && target && (<>
            <div style={{ ...MONO, fontSize: 13, lineHeight: 1.5, color: 'var(--pm4-flour)' }}>
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
          <Btn variant={mainLevel === 'growing' ? 'secondary' : 'primary'} onClick={() => goOn(null)}>
            {fem ? 'È pronta' : 'È pronto'}: impasto finale →
          </Btn>
        </div>
      ) : null}

      {confirmCancel ? (
        <div ref={cancelRef} tabIndex={-1} role="group" aria-label="Conferma annullamento" style={{ display: 'flex', flexDirection: 'column', gap: 10, outline: 'none' }}>
          <div style={{ ...MONO, fontSize: 13, color: 'var(--pm4-tan)' }}>Annullo la preparazione? Non resta nello Storico.</div>
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
