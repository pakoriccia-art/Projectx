/**
 * PizzaMatrix — prefermento in maturazione.
 *
 * La fase prima dell'impasto finale: cosa impastare adesso, a che punto è la
 * maturazione (tempo termico con fArrhenius del motore, anche se il prefermento
 * cambia posto), i segni da guardare e cosa preparare dopo. Alla conferma "è
 * pronto" la durata e la temperatura vissute entrano nella ricetta e parte la
 * sessione dell'impasto.
 */
import { useEffect, useRef, useState } from 'react';
import { useApp, type WizardDraft } from '../../context/AppContext';
import { Btn, Card, SnapButtons } from '../ui';
import { launchSession } from '../wizard/WizardView';
import { deleteAllPrefermentStages, deletePrefermentStage, updatePrefermentStage } from '../../services/sessionService';
import { ddtForStyle } from '../../data/styleConstraints';
import type { PrefermentStage } from '../../db/db';
import {
  EARLY_PCT, currentSpot, elapsedPrefHours, equivalentTempC, fmtGrams, isPreparable,
  lateThresholdPct, overSign, placeOf, placeTempC, prefDdtC, prefIsFeminine, prefName,
  prefProgress, prefWithArticle, readySigns, splitRecipe, waterAdvice, type PrefPlace,
} from '../../lib/preferment';

const MONO = { fontFamily: 'var(--font-mono)' } as const;
const PLACE: Record<PrefPlace, string> = { fresco: 'in un posto fresco', stanza: 'a temperatura ambiente', frigo: 'in frigo' };
const PLACE_LABEL: Record<PrefPlace, string> = { fresco: 'Fresco', stanza: 'Stanza', frigo: 'Frigo' };
/** Sotto questo scarto dall'orario del piano non si chiede nulla. */
const SHIFT_ASK_MS = 15 * 60_000;

function fmtClock(d: Date, now: number): string {
  const t = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date(now).toDateString()
    ? t : `${d.toLocaleDateString('it-IT', { weekday: 'short' })} ${t}`;
}

function fmtSpan(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(min / 60), m = min % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

const cap = (t: string) => t.replace(/^./, c => c.toUpperCase());

export function PrefermentStageView() {
  const { state, dispatch } = useApp();
  const stage = state.prefermentStage;
  const [now, setNow] = useState(() => Date.now());
  const [confirmEarly, setConfirmEarly] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [askService, setAskService] = useState(false);
  const [showDoses, setShowDoses] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => { if (!stage) dispatch({ type: 'NAV', view: 'home' }); }, [stage, dispatch]);
  if (!stage) return null;

  const draft = stage.draft as WizardDraft;
  const prefs = draft.prefermenti ?? [];
  const main = prefs.find(isPreparable) ?? prefs[0];
  const type = main?.type ?? 'biga';
  const fem = prefIsFeminine(type);
  const Name = cap(prefWithArticle(type));
  const fridge = draft.fridgeTempC ?? 4;
  const startMs = new Date(stage.startedAt).getTime();
  const { pct } = prefProgress(stage, now);
  const readyMs = prefProgress(stage, now, 100).etaMs;
  const isDue = pct >= 100;
  const late = pct >= lateThresholdPct(type);
  const early = pct < EARLY_PCT;
  const spot = currentSpot(stage, main ? placeOf(main) : 'fresco');
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
    if (stage.id != null) {
      const { id: _id, ...rest } = next;
      updatePrefermentStage(stage.id, rest).catch(err => console.error('[updatePrefermentStage]', err));
    }
  };

  const moveTo = (place: PrefPlace) => {
    if (place === spot.place) return;
    const t = Date.now();
    const moves = [...(stage.moves ?? []), { at: new Date(t), place, tempC: placeTempC(place, fridge) }];
    const eta = prefProgress({ ...stage, moves }, t, 100).etaMs;
    setNow(t);   // l'orologio della vista va al momento dello spostamento
    save({ moves, readyAt: new Date(eta) });
  };

  const removeStage = () => {
    dispatch({ type: 'PREF_STAGE_SET', stage: null });
    const p = stage.id != null ? deletePrefermentStage(stage.id) : deleteAllPrefermentStages();
    p.catch(err => console.error('[deletePrefermentStage]', err));
  };

  // Orario del piano (Servizio/Orario): l'impasto parte ora invece che all'ora prevista.
  const plannedMixMs = startMs + (stage.plannedH ?? (new Date(stage.readyAt).getTime() - startMs) / 3_600_000) * 3_600_000;
  const shiftMs = now - plannedMixMs;
  const target = draft.targetBakeAt ? new Date(draft.targetBakeAt) : null;

  const startDough = (moveService: boolean) => {
    setError(null);
    const t = Date.now();
    // Ore vere e temperatura equivalente a quella vissuta: è ciò che conta per la previsione.
    const realH = Math.min(72, elapsedPrefHours(stage.startedAt, t));
    const effT = equivalentTempC(stage, t);
    const finalDraft: WizardDraft = {
      ...draft,
      prefermentTiming: 'ready',
      prefermenti: prefs.map(p => (isPreparable(p)
        ? { ...p, durationH: realH, tempC: effT, place: (stage.moves ?? []).length ? undefined : p.place }
        : p)),
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

  const onReady = () => {
    // Una sessione alla volta: l'impasto in corso non si sovrascrive.
    if (state.activeSession) {
      setError("C'è già un impasto in corso: terminalo dalla dashboard prima di avviare questo.");
      return;
    }
    if (early) { setConfirmEarly(true); return; }
    if (target && Math.abs(shiftMs) >= SHIFT_ASK_MS) { setAskService(true); return; }
    startDough(false);
  };

  // Dosi del prefermento da impastare adesso (+ acqua alla temperatura giusta).
  const prepGrams = recipe.prefs.filter(g => isPreparable(g));
  const prepWater = (g: typeof prepGrams[number]) => {
    const p = prefs.find(x => x.id === g.id);
    return waterAdvice({
      ddtTarget: prefDdtC(g.type), tempAmbient: tLab, waterG: g.waterG,
      massKg: g.totalG / 1000, hydrationPct: p?.hydration ?? 50,
      kneadingMethod: draft.kneadingMethod ?? 'spiral', kneadDurationMin: 3, tapWaterC: draft.tapWaterC,
    });
  };
  const autolysis = recipe.prefs.filter(g => g.type === 'autolysis');
  const finalWater = waterAdvice({
    ddtTarget: ddtForStyle(draft.style), tempAmbient: tLab, waterG: recipe.final.waterG,
    massKg: (draft.totalFlourGrams ?? 1000) * (1 + (draft.hydration ?? 65) / 100) / 1000,
    hydrationPct: draft.hydration ?? 65, kneadingMethod: draft.kneadingMethod ?? 'spiral',
    kneadDurationMin: draft.kneadDurationMin ?? 12, tempPreferment: spot.tempC, tapWaterC: draft.tapWaterC,
  });

  const label = { ...MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--pm4-tan)' };
  const row = (k: string, v: string) => (
    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, ...MONO, fontSize: 13, lineHeight: 1.9 }}>
      <span style={{ color: 'var(--pm4-tan)' }}>{k}</span>
      <span style={{ color: 'var(--pm4-flour)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{v}</span>
    </div>
  );

  return (
    <div style={{ padding: '24px var(--padding-h) max(24px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560, margin: '0 auto' }}>
      <div style={label}>Prefermento · in corso</div>

      {/* Hero: a che punto è, quando è pronto */}
      <div>
        <h2 ref={titleRef} tabIndex={-1} style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: late ? 'var(--pm4-ember-lo)' : 'var(--pm4-flour)', outline: 'none' }}>
          {late ? `${Name} è ${fem ? 'pronta' : 'pronto'} da ${fmtSpan(now - readyMs)}` : `${Name} sta maturando`}
        </h2>
        <div role="timer" aria-live="off" style={{ ...MONO, marginTop: 10, fontSize: 44, fontWeight: 800, lineHeight: 1, color: isDue ? 'var(--pm4-ember-lo)' : 'var(--pm4-flour)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtClock(new Date(readyMs), now)}
        </div>
        <div style={{ ...MONO, marginTop: 8, fontSize: 13, color: 'var(--pm4-tan)' }}>
          maturazione ~{Math.round(pct)}% · {isDue
            ? `${fem ? 'pronta' : 'pronto'} da ${fmtSpan(now - readyMs)}`
            : `${fem ? 'pronta' : 'pronto'} tra ${fmtSpan(readyMs - now)}`}
        </div>
        <div aria-hidden="true" style={{ marginTop: 12, height: 6, borderRadius: 3, background: 'var(--pm4-line)' }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', borderRadius: 3, background: isDue ? 'var(--pm4-ember-lo)' : 'var(--pm4-tan)' }} />
        </div>
        <div style={{ ...MONO, marginTop: 8, fontSize: 12, color: 'var(--pm4-umber)' }}>
          {fem ? 'Impastata' : 'Impastato'} alle {fmtClock(new Date(startMs), now)} · ora {PLACE[spot.place]} (~{Math.round(spot.tempC)}°C)
        </div>
      </div>

      {/* Adesso: cosa impastare */}
      {/* Le dosi servono all'inizio: dopo i primi minuti restano a un tocco. */}
      {(!stage.mixedAck && pct < 15) || showDoses ? (
        <Card elevated>
          <div style={{ ...label, marginBottom: 8, color: 'var(--accent-brand)' }}>Adesso: impasta {prefWithArticle(type)}</div>
          {prepGrams.map(g => {
            const w = prepWater(g);
            return (
              <div key={g.id}>
                {prepGrams.length > 1 && <div style={{ ...label, marginTop: 6 }}>{cap(prefName(g.type))}</div>}
                {row('Farina', fmtGrams(g.flourG))}
                {row('Acqua', fmtGrams(g.waterG))}
                {g.yeastG != null && row(yeastLabel, fmtGrams(g.yeastG))}
                {w && <div style={{ ...MONO, fontSize: 12, color: 'var(--pm4-umber)', lineHeight: 1.5 }}>Per un impasto a ~{prefDdtC(g.type)}°C: {w}.</div>}
              </div>
            );
          })}
          <div style={{ marginTop: 10 }}>
            <Btn variant="secondary" onClick={() => { setShowDoses(false); save({ mixedAck: true }); }}>Fatto ✓</Btn>
          </div>
        </Card>
      ) : (
        <button type="button" onClick={() => setShowDoses(true)} style={{
          alignSelf: 'flex-start', minHeight: 44, background: 'none', border: 'none', cursor: 'pointer',
          ...MONO, fontSize: 12, color: 'var(--pm4-tan)', textDecoration: 'underline', padding: 0,
        }}>
          Rivedi le dosi {fem ? 'della' : 'del'} {prefName(type)}
        </button>
      )}

      {/* Dove si trova adesso: cambia la velocità di maturazione */}
      <SnapButtons<PrefPlace>
        label="Dove si trova adesso"
        options={(['fresco', 'stanza', 'frigo'] as PrefPlace[]).map(pl => ({
          value: pl, label: PLACE_LABEL[pl], desc: `~${placeTempC(pl, fridge)}°C`,
        }))}
        value={spot.place}
        onChange={moveTo}
      />

      {/* Segni */}
      <Card>
        <div style={{ ...label, marginBottom: 8 }}>Come capire che è {fem ? 'pronta' : 'pronto'}</div>
        {late && (
          <div role="alert" style={{ ...MONO, fontSize: 13, lineHeight: 1.5, color: 'var(--pm4-ember-lo)', marginBottom: 8 }}>
            ⚠ {overSign(type)}. Impasta appena puoi.
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

      {confirmEarly ? (
        <div role="group" aria-label="Conferma impasto anticipato" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...MONO, fontSize: 13, lineHeight: 1.5, color: 'var(--pm4-ember-lo)' }}>
            {Name} è al ~{Math.round(pct)}%: l'impasto partirà meno maturo e ci metterà di più.
          </div>
          <Btn onClick={() => setConfirmEarly(false)}>Aspetto</Btn>
          <Btn variant="secondary" onClick={() => {
            setConfirmEarly(false);
            if (target && Math.abs(shiftMs) >= SHIFT_ASK_MS) setAskService(true); else startDough(false);
          }}>Impasto lo stesso</Btn>
        </div>
      ) : askService && target ? (
        <div role="group" aria-label="Orario del servizio" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...MONO, fontSize: 13, lineHeight: 1.5, color: 'var(--pm4-flour)' }}>
            Impasti {shiftMs > 0 ? `${fmtSpan(shiftMs)} dopo` : `${fmtSpan(-shiftMs)} prima di`} quanto previsto. Il servizio?
          </div>
          <Btn onClick={() => startDough(false)}>Tengo il servizio alle {fmtClock(target, now)}</Btn>
          <Btn variant="secondary" onClick={() => startDough(true)}>
            Sposto il servizio alle {fmtClock(new Date(target.getTime() + shiftMs), now)}
          </Btn>
          <Btn variant="secondary" onClick={() => setAskService(false)}>Non ancora</Btn>
        </div>
      ) : (
        <Btn onClick={onReady}>{fem ? 'È pronta' : 'È pronto'}: impasto finale →</Btn>
      )}

      {confirmCancel ? (
        <div role="group" aria-label="Conferma annullamento" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...MONO, fontSize: 13, color: 'var(--pm4-tan)' }}>Annullo la preparazione? Non resta nello Storico.</div>
          <Btn variant="danger" onClick={removeStage}>Sì, annulla</Btn>
          <Btn variant="secondary" onClick={() => setConfirmCancel(false)}>No, continua</Btn>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><Btn variant="secondary" onClick={() => dispatch({ type: 'NAV', view: state.activeSession ? 'dashboard' : 'home' })}>
            {state.activeSession ? '← Impasto in corso' : '← Home'}
          </Btn></div>
          <div style={{ flex: 1 }}><Btn variant="secondary" onClick={() => setConfirmCancel(true)}>Annulla</Btn></div>
        </div>
      )}
    </div>
  );
}
