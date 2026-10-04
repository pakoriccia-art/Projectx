/**
 * PizzaMatrix — prefermento in maturazione.
 *
 * La fase prima dell'impasto finale: conto alla rovescia, segni da guardare,
 * cosa preparare. Nessuna simulazione qui: quando l'utente conferma che è
 * pronto, la durata reale entra nella ricetta e parte la sessione dell'impasto.
 */
import { useEffect, useRef, useState } from 'react';
import { useApp, type WizardDraft } from '../../context/AppContext';
import { Btn, Card } from '../ui';
import { launchSession } from '../wizard/WizardView';
import { deletePrefermentStage } from '../../services/sessionService';
import {
  elapsedPrefHours, fmtGrams, isPreparable, placeOf, prefIsFeminine, prefName,
  prefWithArticle, readySigns, splitRecipe,
} from '../../lib/preferment';

const MONO = { fontFamily: 'var(--font-mono)' } as const;
const PLACE: Record<string, string> = { fresco: 'in un posto fresco', stanza: 'a temperatura ambiente', frigo: 'in frigo' };
/** Sotto questa quota della durata prevista si chiede conferma. */
const EARLY_FRACTION = 0.75;

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

export function PrefermentStageView() {
  const { state, dispatch } = useApp();
  const stage = state.prefermentStage;
  const [now, setNow] = useState(() => Date.now());
  const [confirmEarly, setConfirmEarly] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
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
  const Name = prefWithArticle(type).replace(/^./, c => c.toUpperCase());
  const startMs = new Date(stage.startedAt).getTime();
  const readyMs = new Date(stage.readyAt).getTime();
  const plannedMs = Math.max(1, readyMs - startMs);
  const progress = Math.min(1, Math.max(0, (now - startMs) / plannedMs));
  const isDue = now >= readyMs;
  const early = (now - startMs) < plannedMs * EARLY_FRACTION;
  const recipe = splitRecipe({
    totalFlourG: draft.totalFlourGrams ?? 1000, hydrationPct: draft.hydration ?? 65,
    saltPct: draft.salt ?? 2, fatPct: draft.fat, agentDosePct: draft.agentDosePct ?? 0, prefermenti: prefs,
  });
  const agent = draft.agentType ?? 'fresh_yeast';
  const yeastLabel = agent === 'sourdough_wheat' ? 'Lievito madre' : agent === 'instant_dry_yeast' ? 'Lievito secco' : 'Lievito di birra';

  const startDough = () => {
    setError(null);
    // La durata vera (non quella prevista) è quella che conta per la previsione.
    const realH = Math.min(72, elapsedPrefHours(stage.startedAt, Date.now()));
    const shift = Date.now() - readyMs;
    const finalDraft: WizardDraft = {
      ...draft,
      prefermentTiming: 'ready',
      prefermenti: prefs.map(p => (isPreparable(p) ? { ...p, durationH: realH } : p)),
      targetBakeAt: draft.targetBakeAt ? new Date(new Date(draft.targetBakeAt).getTime() + shift) : undefined,
    };
    try {
      launchSession(finalDraft, dispatch);
    } catch (e) {
      console.error('[PrefermentStage] launchSession', e);
      setError("Non riesco ad avviare l'impasto con questi valori. Riprova o annulla la preparazione.");
      return;
    }
    dispatch({ type: 'PREF_STAGE_SET', stage: null });
    if (stage.id != null) deletePrefermentStage(stage.id).catch(err => console.error('[deletePrefermentStage]', err));
  };

  const cancel = () => {
    dispatch({ type: 'PREF_STAGE_SET', stage: null });
    if (stage.id != null) deletePrefermentStage(stage.id).catch(err => console.error('[deletePrefermentStage]', err));
  };

  const label = { ...MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--pm4-tan)' };

  return (
    <div style={{ padding: '24px var(--padding-h) max(24px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560, margin: '0 auto' }}>
      <div style={label}>Prefermento · in corso</div>

      {/* Hero: quando è pronto */}
      <div>
        <h2 ref={titleRef} tabIndex={-1} style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--pm4-flour)', outline: 'none' }}>
          {Name} sta maturando
        </h2>
        <div role="timer" aria-live="off" style={{ ...MONO, marginTop: 10, fontSize: 44, fontWeight: 800, lineHeight: 1, color: isDue ? 'var(--pm4-ember-lo)' : 'var(--pm4-flour)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtClock(new Date(readyMs), now)}
        </div>
        <div style={{ ...MONO, marginTop: 8, fontSize: 13, color: 'var(--pm4-tan)' }}>
          {isDue
            ? `${fem ? 'pronta' : 'pronto'} da ${fmtSpan(now - readyMs)} · controlla i segni`
            : `${fem ? 'pronta' : 'pronto'} tra ${fmtSpan(readyMs - now)}`}
        </div>
        <div aria-hidden="true" style={{ marginTop: 12, height: 6, borderRadius: 3, background: 'var(--pm4-line)' }}>
          <div style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 3, background: isDue ? 'var(--pm4-ember-lo)' : 'var(--pm4-tan)' }} />
        </div>
        <div style={{ ...MONO, marginTop: 8, fontSize: 12, color: 'var(--pm4-umber)' }}>
          {fem ? 'Impastata' : 'Impastato'} alle {fmtClock(new Date(startMs), now)}
          {main ? ` · ${PLACE[placeOf(main)]} (~${Math.round(main.tempC)}°C)` : ''}
        </div>
      </div>

      {/* Segni */}
      <Card>
        <div style={{ ...label, marginBottom: 8 }}>Come capire che è {fem ? 'pronta' : 'pronto'}</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, lineHeight: 1.45, color: 'var(--pm4-flour)' }}>
          {readySigns(type).map(s => <li key={s}>{s}</li>)}
        </ul>
      </Card>

      {/* Impasto finale */}
      <Card>
        <div style={{ ...label, marginBottom: 8 }}>Per l'impasto finale prepara</div>
        {[
          ...recipe.prefs.map(g => [`${prefName(g.type).replace(/^./, c => c.toUpperCase())} (${prefIsFeminine(g.type) ? 'tutta' : 'tutto'})`, fmtGrams(g.totalG)] as const),
          ['Farina', fmtGrams(recipe.final.flourG)] as const,
          ['Acqua', fmtGrams(recipe.final.waterG)] as const,
          ['Sale', fmtGrams(recipe.final.saltG)] as const,
          ...(recipe.final.fatG > 0 ? [['Grassi', fmtGrams(recipe.final.fatG)] as const] : []),
          ...(recipe.final.yeastG > 0 ? [[yeastLabel, fmtGrams(recipe.final.yeastG)] as const] : []),
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', ...MONO, fontSize: 13, lineHeight: 1.9 }}>
            <span style={{ color: 'var(--pm4-tan)' }}>{k}</span>
            <span style={{ color: 'var(--pm4-flour)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
          </div>
        ))}
        <div style={{ ...MONO, marginTop: 6, fontSize: 12, color: 'var(--pm4-umber)', lineHeight: 1.5 }}>
          La temperatura dell'acqua te la dico quando impasti.
        </div>
      </Card>

      {error && <div role="alert" style={{ ...MONO, fontSize: 13, color: 'var(--state-critical)' }}>{error}</div>}

      {confirmEarly ? (
        <div role="group" aria-label="Conferma impasto anticipato" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...MONO, fontSize: 13, lineHeight: 1.5, color: 'var(--pm4-ember-lo)' }}>
            {Name} ha solo {fmtSpan(now - startMs)} su {fmtSpan(plannedMs)}: l'impasto partirà meno maturo e ci metterà di più.
          </div>
          <Btn onClick={startDough}>Sì, impasto adesso</Btn>
          <Btn variant="secondary" onClick={() => setConfirmEarly(false)}>Aspetto</Btn>
        </div>
      ) : (
        <Btn onClick={() => (early ? setConfirmEarly(true) : startDough())}>
          {fem ? 'È pronta' : 'È pronto'}: impasto finale →
        </Btn>
      )}

      {confirmCancel ? (
        <div role="group" aria-label="Conferma annullamento" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...MONO, fontSize: 13, color: 'var(--pm4-tan)' }}>Annullo la preparazione? Non resta nello Storico.</div>
          <Btn variant="danger" onClick={cancel}>Sì, annulla</Btn>
          <Btn variant="secondary" onClick={() => setConfirmCancel(false)}>No, continua</Btn>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><Btn variant="secondary" onClick={() => dispatch({ type: 'NAV', view: 'home' })}>← Home</Btn></div>
          <div style={{ flex: 1 }}><Btn variant="secondary" onClick={() => setConfirmCancel(true)}>Annulla</Btn></div>
        </div>
      )}
    </div>
  );
}
