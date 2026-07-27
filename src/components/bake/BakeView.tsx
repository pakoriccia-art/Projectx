/**
 * PizzaMatrix — Configurazione Forno & Raccomandazione Bake (v2.4.21)
 * Vista dedicata: seleziona OvenProfile → FATTIBILE/NON FATTIBILE +
 * blocco CONSIGLIATO (targetTempC, tempo, cielo/platea effusività-dipendenti).
 * Dettagli diagnostici (arresti cinetici, W proiettato) in accordion chiuso.
 *
 * INVARIANTI:
 *  - Non muta session.hydration / W / style (advisory only).
 *  - Non tocca DashboardView (v3.1), wizard, applyPhaseTransition/setPhase.
 *  - Tutte le soglie bake sono validationStatus:'hypothesis'.
 */
import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { db } from '../../db/db';
import type { OvenProfile, OvenArchetype, StoneMaterial, BakeValidationResult } from '../../engine/bake';
import {
  OVEN_ARCHETYPES, STONE_EFFUSIVITY, KNOB_TEMP_MAP_SCALE5, validateBakeFeasibility,
} from '../../engine/bake';
import { computeDashboardEffectiveW, computeCurrentPH } from '../../engine';
import { projectCoreTempAtBakeC, CORE_TEMP_AT_BAKE_MIN_C } from '../../engine/coreTempProjection';
import { SnapButtons } from '../ui';

// ─── Costante Hill exponent (allineata all'engine) ────────────────────────────
const HILL_N = 5;

// ─── Formato mm:ss per il tempo di cottura consigliato ────────────────────────
function fmtMmSs(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function hillW(W0: number, tCrit: number, hours: number): number {
  if (tCrit <= 0) return W0 * 0.5;
  const ratio = hours / tCrit;
  return W0 / (1 + Math.pow(ratio, HILL_N));
}

// ─── Label archetipo ──────────────────────────────────────────────────────────
const ARCHETYPE_LABELS: Record<OvenArchetype, string> = {
  domestico_std:       'Domestico',
  elettrico_pizza:     'Elettrico pizza',
  gas_portatile:       'Gas portatile',
  legna_prof:          'Legna prof.',
  fornetto_conchiglia: 'Conchiglia',
};

const STONE_LABELS: Record<StoneMaterial, { label: string; desc: string }> = {
  acciaio:                { label: 'Acciaio',     desc: 'alta effusività' },
  cordierite_refrattaria: { label: 'Cordierite',  desc: 'media effusività' },
  biscotto:               { label: 'Biscotto',    desc: 'bassa effusività' },
};

const REASON_LABEL: Record<string, string> = {
  temp_deficit_evaporative:  'Forno troppo freddo per l\'idratazione',
  w_below_min_at_infornata:  'W residuo sotto la soglia di stesura',
  effusivity_burn_bottom:    'Rischio fondo bruciato',
  temp_excess_for_style:     'Temperatura eccessiva per lo stile',
};

const DEFAULT_PROFILE: OvenProfile = {
  archetipo: 'domestico_std',
  stone: 'cordierite_refrattaria',
  dualZone: false,
};

// ─── Stili inline ─────────────────────────────────────────────────────────────
const SECTION: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14,
};
const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 0', borderBottom: '1px solid var(--pm4-line)',
};
const LABEL_MONO: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pm4-tan)', letterSpacing: '0.05em',
};
const VALUE_MONO: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--pm4-flour)',
};
// ─── Toggle (switch a11y: role=switch, hit area ≥44px, track 48×28) ───────────
function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      aria-label={label}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 4,
        minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <span style={{
        position: 'relative', display: 'block', width: 48, height: 28, borderRadius: 14,
        transition: 'background 0.2s',
        background: value ? 'var(--accent-brand)' : 'rgba(255,255,255,0.16)',
      }}>
        <span style={{
          display: 'block', width: 22, height: 22, borderRadius: 11,
          background: '#fff', position: 'absolute', top: 3,
          left: value ? 23 : 3, transition: 'left 0.2s',
        }} />
      </span>
    </button>
  );
}

// ─── BakeView ─────────────────────────────────────────────────────────────────
export function BakeView() {
  const { state, dispatch } = useApp();
  const session = state.activeSession;
  const ts = state.tickState;

  const [profile, setProfile] = useState<OvenProfile>(() =>
    (session?.ovenProfile as OvenProfile | undefined) ?? DEFAULT_PROFILE,
  );
  // Accordion diagnostica: chiuso di default (la guida primaria è il CONSIGLIATO)
  const [detailsOpen, setDetailsOpen] = useState(false);

  // ── Persistenza (pattern identico a setTempAmbient) ──────────────────────
  function saveProfile(p: OvenProfile) {
    setProfile(p);
    if (!session) return;
    dispatch({ type: 'SESSION_UPDATE', patch: { ovenProfile: p } });
    db.sessions.update(session.id, { ovenProfile: p }).catch(() => {});
  }

  function patch(update: Partial<OvenProfile>) {
    saveProfile({ ...profile, ...update });
  }

  // ── W proiettato a targetBakeAt ───────────────────────────────────────────
  const { W_proj, ovenTempEstimate, validation } = useMemo(() => {
    if (!session || !ts) return { W_proj: null, ovenTempEstimate: null, validation: null };

    const pH = computeCurrentPH(
      session.initialPH ?? 5.8,
      ts.cumulativeAdu,
      session.agentType,
      (ts as any).labAdu ?? 0,
    ) as number;

    const wRes = computeDashboardEffectiveW(
      session as any, ts.cumulativeAdu, ts.tempDough, pH,
    ) as { W_initial: number; tCritHours: number; W_current: number };

    const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt ?? Date.now());
    const targetBake = session.targetBakeAt instanceof Date ? session.targetBakeAt : new Date((session.targetBakeAt as any) ?? Date.now() + 86_400_000);
    const elapsedH = Math.max(0, (Date.now() - startedAt.getTime()) / 3_600_000);
    const bakeElapsedH = Math.max(elapsedH, (targetBake.getTime() - startedAt.getTime()) / 3_600_000);

    const W_proj = hillW(wRes.W_initial, wRes.tCritHours, bakeElapsedH);

    const val: BakeValidationResult = validateBakeFeasibility({
      session: session as any,
      finalState: { W_current: W_proj },
      ovenProfile: profile,
    }) as BakeValidationResult;

    return { W_proj, ovenTempEstimate: val.ovenTempC, validation: val };
  }, [session, ts, profile]);

  // ── Guardia: nessuna sessione attiva ─────────────────────────────────────
  if (!session) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0a0806', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <span style={{ ...LABEL_MONO, fontSize: 13 }}>Avvia una sessione per configurare il forno.</span>
        <button
          onClick={() => dispatch({ type: 'NAV', view: 'home' })}
          className="pm4-btn pm4-btn-ghost"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, padding: '10px 20px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--pm4-line-strong)', color: 'var(--pm4-tan)', cursor: 'pointer' }}
        >
          ← Home
        </button>
      </div>
    );
  }

  const isConchiglia = profile.archetipo === 'fornetto_conchiglia';
  const knobLevel = profile.knobLevel ?? 3;

  // v2.4.21: cuore impasto proiettato a cottura — avviso se < 18°C (impasto freddo).
  const coreTempAtBake = ts ? (() => {
    const startedAt  = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt ?? Date.now());
    const targetBake = session.targetBakeAt instanceof Date ? session.targetBakeAt : new Date((session.targetBakeAt as any) ?? Date.now() + 86_400_000);
    const elapsedH   = Math.max(0, (Date.now() - startedAt.getTime()) / 3_600_000);
    const ambientTempC = ts.tempAmbient ?? session.tLaboratorio ?? 22;
    return projectCoreTempAtBakeC({
      timeline: session.thermalTimeline, nowElapsedH: elapsedH,
      bakeH: (targetBake.getTime() - startedAt.getTime()) / 3_600_000,
      currentDoughTempC: ts.tempDough ?? ambientTempC, ambientTempC, session: session as any,
    });
  })() : null;
  const coldAtBake = coreTempAtBake != null && coreTempAtBake < CORE_TEMP_AT_BAKE_MIN_C;

  return (
    <div style={{ minHeight: '100dvh', background: '#0a0806', paddingBottom: 80 }}>

      {/* ── Header ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'rgba(10,8,6,0.96)', backdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--pm4-line)',
        padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          onClick={() => dispatch({ type: 'NAV', view: 'dashboard' })}
          style={{ background: 'none', border: 'none', color: 'var(--pm4-tan)', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer', padding: 0 }}
        >
          ← Dashboard
        </button>
        <span style={{ ...LABEL_MONO, fontSize: 13 }}>CONFIGURAZIONE FORNO</span>
      </div>

      <div style={{ padding: '16px 16px 0' }}>

        {/* ── 1. FATTIBILE / NON FATTIBILE (badge grande) + advice ── */}
        {validation && (
          <div className="pm4-panel" style={{
            padding: '14px 14px', marginBottom: 12,
            borderLeft: `3px solid ${validation.feasible ? '#22c55e' : '#ef4444'}`,
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 800,
              letterSpacing: '0.06em', marginBottom: validation.feasible && validation.advice.length === 0 ? 0 : 8,
              color: validation.feasible ? '#22c55e' : '#ef4444',
            }}>
              {validation.feasible ? '✓ FATTIBILE' : '✗ NON FATTIBILE'}
            </div>
            {!validation.feasible && (
              <div style={{ ...LABEL_MONO, fontSize: 11, marginBottom: 8, color: '#ef4444' }}>
                {REASON_LABEL[validation.reason ?? ''] ?? validation.reason}
              </div>
            )}
            {validation.advice.map((line, i) => (
              <p key={i} style={{
                margin: '0 0 6px', fontFamily: 'var(--font-mono)', fontSize: 11,
                color: 'var(--pm4-tan)', lineHeight: 1.5,
              }}>
                {line}
              </p>
            ))}
          </div>
        )}

        {/* ── Avviso impasto freddo a cottura (v2.4.21) ── */}
        {coldAtBake && (
          <div className="pm4-panel" style={{
            padding: '12px 14px', marginBottom: 12,
            borderLeft: '3px solid #74b9ff',
            background: 'linear-gradient(90deg, rgba(116,185,255,0.10), transparent)',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 800, color: '#bcd9ff', marginBottom: 6, letterSpacing: '0.04em' }}>
              ❄ IMPASTO FREDDO
            </div>
            <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pm4-tan)', lineHeight: 1.5 }}>
              Cuore stimato a cottura ~{coreTempAtBake!.toFixed(1)}° (min {CORE_TEMP_AT_BAKE_MIN_C}°):
              {' '}{(CORE_TEMP_AT_BAKE_MIN_C - coreTempAtBake!).toFixed(1)}° sotto soglia. Rischio mollica
              gommosa e superficie scottata prima che il cuore arrivi a temperatura. Prolunga il
              tempering a TA prima di infornare.
            </p>
          </div>
        )}

        {/* ── 2. CONSIGLIATO (blocco primario, effusività attiva) ── */}
        {validation && (
          <div className="pm4-panel" style={{ padding: '13px 14px', marginBottom: 12, borderLeft: '3px solid var(--accent-brand)' }}>
            <div style={{ ...LABEL_MONO, marginBottom: 10, color: 'var(--accent-brand)' }}>CONSIGLIATO</div>
            <div className="pm4-cells" style={{ gridTemplateColumns: validation.recommendation.cieloC != null ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)' }}>
              <div className="pm4-cell">
                <div style={LABEL_MONO}>TEMPERATURA</div>
                <div style={VALUE_MONO}>{validation.recommendation.targetTempC}°C</div>
              </div>
              <div className="pm4-cell">
                <div style={LABEL_MONO}>TEMPO</div>
                <div style={VALUE_MONO}>{fmtMmSs(validation.recommendation.bakeTimeS)}</div>
              </div>
              {validation.recommendation.cieloC != null && (
                <div className="pm4-cell">
                  <div style={LABEL_MONO}>CIELO</div>
                  <div style={VALUE_MONO}>{validation.recommendation.cieloC}°C</div>
                </div>
              )}
              {validation.recommendation.plateaC != null && (
                <div className="pm4-cell">
                  <div style={LABEL_MONO}>PLATEA</div>
                  <div style={VALUE_MONO}>{validation.recommendation.plateaC}°C</div>
                </div>
              )}
            </div>
            <p style={{
              margin: '10px 0 0', fontFamily: 'var(--font-mono)', fontSize: 11,
              color: 'var(--pm4-tan)', lineHeight: 1.5,
            }}>
              {validation.recommendation.stoneNote}
            </p>
            <div style={{ ...LABEL_MONO, fontSize: 9, marginTop: 8, opacity: 0.55 }}>
              ⚠ Valori indicativi — validationStatus: hypothesis
            </div>
          </div>
        )}

        {/* ── Archetipo ── */}
        <div className="pm4-panel" style={{ padding: '13px 14px 14px', marginBottom: 12 }}>
          <div style={{ ...LABEL_MONO, marginBottom: 10 }}>ARCHETIPO</div>
          <SnapButtons<OvenArchetype>
            options={(Object.keys(OVEN_ARCHETYPES) as OvenArchetype[]).map(k => ({
              value: k,
              label: ARCHETYPE_LABELS[k],
              desc: `${OVEN_ARCHETYPES[k].tMaxC}°C max`,
            }))}
            value={profile.archetipo}
            onChange={v => patch({ archetipo: v, knobLevel: undefined })}
          />
        </div>

        {/* ── Piano cottura ── */}
        <div className="pm4-panel" style={{ padding: '13px 14px 14px', marginBottom: 12 }}>
          <div style={{ ...LABEL_MONO, marginBottom: 10 }}>PIANO COTTURA</div>
          <SnapButtons<StoneMaterial>
            options={(Object.keys(STONE_EFFUSIVITY) as StoneMaterial[]).map(k => ({
              value: k,
              label: STONE_LABELS[k].label,
              desc: STONE_LABELS[k].desc,
            }))}
            value={profile.stone}
            onChange={v => patch({ stone: v })}
          />
        </div>

        {/* ── Dual-zone + Knob + Pirometro ── */}
        <div className="pm4-panel" style={{ padding: '13px 14px', marginBottom: 12 }}>
          <div style={SECTION}>

            {/* Dual-zone */}
            {!isConchiglia && (
              <div style={ROW}>
                <span style={LABEL_MONO}>DOPPIA ZONA (CIELO/PLATEA)</span>
                <Toggle value={profile.dualZone} onChange={v => patch({ dualZone: v })} label="Doppia zona cielo/platea" />
              </div>
            )}

            {/* Knob conchiglia */}
            {isConchiglia && (
              <div>
                <div style={{ ...LABEL_MONO, marginBottom: 8 }}>
                  MANOPOLA · {KNOB_TEMP_MAP_SCALE5[knobLevel as keyof typeof KNOB_TEMP_MAP_SCALE5]}°C
                </div>
                <input
                  type="range" min={1} max={5} step={1}
                  value={knobLevel}
                  onChange={e => patch({ knobLevel: Number(e.target.value) })}
                  aria-label="Livello manopola fornetto"
                  aria-valuetext={`livello ${knobLevel}, ${KNOB_TEMP_MAP_SCALE5[knobLevel as keyof typeof KNOB_TEMP_MAP_SCALE5]} gradi`}
                  style={{ width: '100%', height: 22, borderRadius: 11, accentColor: 'var(--accent-brand)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', ...LABEL_MONO, fontSize: 10, marginTop: 4 }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <span key={n}>{KNOB_TEMP_MAP_SCALE5[n as keyof typeof KNOB_TEMP_MAP_SCALE5]}°</span>
                  ))}
                </div>
              </div>
            )}

            {/* Pirometro */}
            <div style={ROW}>
              <span style={LABEL_MONO}>PIROMETRO (MODDED)</span>
              <Toggle value={!!profile.is_modded} onChange={v => patch({ is_modded: v, measuredTmaxC: v ? (profile.measuredTmaxC ?? 300) : undefined })} label="Pirometro / forno modificato" />
            </div>
            {profile.is_modded && (
              <div>
                <div style={{ ...LABEL_MONO, marginBottom: 6 }}>T MISURATA (°C)</div>
                <input
                  type="number" min={100} max={600}
                  value={profile.measuredTmaxC ?? 300}
                  onChange={e => patch({ measuredTmaxC: Number(e.target.value) })}
                  aria-label="Temperatura misurata al pirometro (gradi C)"
                  style={{
                    width: '100%', minHeight: 44, padding: '9px 12px', background: 'rgba(255,255,255,0.06)',
                    border: '1px solid var(--pm4-line-strong)', borderRadius: 8,
                    color: 'var(--pm4-flour)', fontFamily: 'var(--font-mono)', fontSize: 14,
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── 3. Dettagli tecnici / arresti cinetici (accordion, chiuso) ── */}
        {validation && (
          <div className="pm4-panel" style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
            <button
              onClick={() => setDetailsOpen(o => !o)}
              aria-expanded={detailsOpen}
              style={{
                width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '13px 14px', background: 'none', border: 'none', cursor: 'pointer',
              }}
            >
              <span style={LABEL_MONO}>DETTAGLI TECNICI · ARRESTI CINETICI</span>
              <span style={{ ...LABEL_MONO, fontSize: 12 }}>{detailsOpen ? '▾' : '▸'}</span>
            </button>
            {detailsOpen && (
              <div style={{ padding: '0 14px 13px' }}>
                <div className="pm4-cells" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 10 }}>
                  <div className="pm4-cell">
                    <div style={LABEL_MONO}>T FORNO STIMATA</div>
                    <div style={VALUE_MONO}>
                      {ovenTempEstimate != null ? `${Math.round(ovenTempEstimate)}°C` : '—'}
                    </div>
                  </div>
                  <div className="pm4-cell">
                    <div style={LABEL_MONO}>W A t_infornata</div>
                    <div style={VALUE_MONO}>
                      {W_proj != null ? Math.round(W_proj) : '—'}
                    </div>
                    {session.bakeTargetElapsedH != null && (
                      <div style={{ ...LABEL_MONO, fontSize: 9, marginTop: 2, opacity: 0.7 }}>
                        t = {session.bakeTargetElapsedH.toFixed(1)}h da inizio
                      </div>
                    )}
                  </div>
                </div>
                {[
                  { label: 'PROTEOLISI',    tC: validation.kineticArrest.proteolysisArrestC,  note: 'blocco enzimi proteolitici' },
                  { label: 'β-AMILASI',     tC: validation.kineticArrest.betaAmylaseArrestC,   note: 'disattivazione β-amilasi' },
                  { label: 'α-AMILASI',     tC: validation.kineticArrest.alphaAmylaseArrestC,  note: 'disattivazione α-amilasi' },
                  { label: 'GELATINIZZ.',   tC: validation.kineticArrest.gelatinizationRangeC[0], note: `range ${validation.kineticArrest.gelatinizationRangeC[0]}–${validation.kineticArrest.gelatinizationRangeC[1]}°C` },
                  { label: 'SET GLUTINE',   tC: validation.kineticArrest.glutenSetRangeC[0],   note: `range ${validation.kineticArrest.glutenSetRangeC[0]}–${validation.kineticArrest.glutenSetRangeC[1]}°C` },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid var(--pm4-line)' }}>
                    <span style={{ ...LABEL_MONO }}>{row.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--pm4-flour)' }}>
                      {row.tC}°C <span style={{ opacity: 0.5, fontSize: 10 }}>— {row.note}</span>
                    </span>
                  </div>
                ))}
                <div style={{ ...LABEL_MONO, fontSize: 9, marginTop: 8, opacity: 0.55 }}>
                  ⚠ Soglie indicative — validationStatus: hypothesis
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
