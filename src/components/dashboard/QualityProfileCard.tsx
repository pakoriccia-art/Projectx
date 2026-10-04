/**
 * PizzaMatrix — Profilo impasto (estensibilità · aromi · scioglievolezza)
 * Indici euristici 1–5 ora vs a cottura. Estratto dalla vecchia DashboardView
 * (rimossa): stesse formule; la proiezione a cottura usa buildPiecewiseData,
 * lo stesso builder del grafico V4. Vive dentro il Collapsible della dashboard,
 * quindi non porta un proprio pannello.
 */
import { useMemo } from 'react';
import { buildPiecewiseData } from './GompertzChartV4';

// ─── Quality Profile Card ─────────────────────────────────────────────────────
// Indici euristici: estensibilità, profilo aromatico, scioglievolezza
// Basati su parametri di sessione (P/L, W, idratazione, prefermenti, protocollo)

interface ProfileParams {
  pl: number; hyd: number; W_sci: number;
  prefs: any[]; proto: string; tcH: number;
  agentType: string; style: string; amylase: number;
}

/** Calcola i tre indici di profilo (ext, aroma, sci) a una data maturazione [0,1]. */
function computeProfileIndicesAt(
  m: number,
  { pl, hyd, W_sci, prefs, proto, tcH, agentType, style, amylase }: ProfileParams,
): { ext: number; aroma: number; sci: number } {
  const cm = Math.max(0, Math.min(1, m));

  // Estensibilità
  const plScore    = Math.max(0.5, Math.min(2.0, (1.2 - pl) / 0.35));
  const hydScore   = 0.5 + Math.max(0, Math.min(1.0, (hyd - 55) / 30));
  const flourContr = (plScore + hydScore) / 2;
  const ext = Math.max(1, Math.min(5, Math.round(3.0 * cm + flourContr)));

  // Aromi
  let prefContrib = 0;
  prefs.forEach((p: any) => {
    if (p.type === 'biga')           prefContrib += 1.2;
    else if (p.type === 'poolish')   prefContrib += 0.8;
    else if (p.type === 'riporto')   prefContrib += 0.9;
    else if (p.type === 'autolysis') prefContrib += 0.1;
  });
  const coldContrib = (proto === 'tc' || proto === 'tc_puntata' || proto === 'tc_appreto') && tcH > 8
    ? Math.min(1.0, tcH / 24) : 0;
  const sdContrib = agentType === 'sourdough_wheat' ? 0.8 : 0;
  const aroma = Math.max(1, Math.min(5,
    Math.round(1.0 + 2.0 * cm + prefContrib + coldContrib + sdContrib)));

  // Scioglievolezza (bell peak 87%)
  const sciMat  = Math.max(0, Math.min(1, 1 - Math.pow(cm - 0.87, 2) / 0.25));
  const hydBon  = Math.max(0, Math.min(0.8, (hyd - 55) / 50));
  const amylBon = Math.min(0.4, Math.max(0, (amylase - 1.0) * 0.4));
  const wBon    = Math.max(0, Math.min(0.3, (350 - W_sci) / 500));
  const styleSci: Record<string, number> = {
    napoletana: 0.3, contemporanea: 0.2, teglia: 0.0, pala: 0.1, nystyle: -0.2,
  };
  const sci = Math.max(1, Math.min(5,
    Math.round(1 + 3.0 * sciMat + hydBon + amylBon + wBon + (styleSci[style] ?? 0))));

  return { ext, aroma, sci };
}

/** Pallini a doppio livello: ● pieno = ora, ◐ anello semitrasparente = a cottura. */
function QualityOverlayDot({
  now, bake, color, label,
}: { now: number; bake: number; color: string; label: string }) {
  return (
    <div
      style={{ display: 'flex', gap: 3 }}
      title={`Ora ${now}/5 · A cottura ${bake}/5`}
      role="img"
      aria-label={`${label}: ora ${now} su 5, a cottura ${bake} su 5`}
    >
      {[1, 2, 3, 4, 5].map(i => {
        const isNow      = i <= now;
        const isOnlyBake = !isNow && i <= bake;
        return (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: '50%',
            background:   isNow ? color : 'transparent',
            border:       isOnlyBake
              ? `1.5px solid ${color}`
              : isNow
              ? 'none'
              : '1.5px solid var(--pm4-line-strong)',
            opacity:      isOnlyBake ? 0.55 : 1,
            boxSizing:    'border-box',
          }} />
        );
      })}
    </div>
  );
}

export function QualityProfileCard({ session, ts }: { session: any; ts: any }) {
  const pl      = session.effectivePl_initial ?? 0.65;
  const hyd     = session.hydration ?? 65;
  const W       = session.effectiveW_initial ?? 280;
  const W_sci   = session.effectiveW_current ?? W;
  const prefs: any[] = session.prefermenti ?? [];
  const proto   = session.apprettoProtocol ?? 'ta';
  const style   = session.style ?? 'napoletana';
  const tcH     = session.tcHours ?? 0;
  const amylase = session.effectiveAmylaseIndex ?? 1.0;
  const agentType = session.agentType ?? 'fresh_yeast';

  const profileParams: ProfileParams = { pl, hyd, W_sci, prefs, proto, tcH, agentType, style, amylase };

  // Maturazione attuale (two-clock) [0,1]
  const mNow = Math.max(0, Math.min(1, (ts?.maturationPct ?? 0) / 100));

  // Ore dalla sessione al target cottura
  const targetBakeH = useMemo(() => {
    try {
      const t0    = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt ?? Date.now());
      const tBake = session.targetBakeAt instanceof Date
        ? session.targetBakeAt
        : (session.targetBakeAt ? new Date(session.targetBakeAt) : null);
      if (!tBake) return null;
      const h = (tBake.getTime() - t0.getTime()) / 3_600_000;
      return h > 0 ? parseFloat(h.toFixed(2)) : null;
    } catch { return null; }
  }, [session.startedAt, session.targetBakeAt]);

  // Maturazione proiettata al bake — usa buildMultiSegmentData (stessa funzione del grafico)
  const mAtBake = useMemo(() => {
    if (targetBakeH == null) return mNow;
    try {
      const tAmb = ts?.tempAmbient ?? session.tLaboratorio ?? 22;
      const { points } = buildPiecewiseData(
        session, tAmb, ts?.phase, ts?.elapsedH,
        ts?.cumulativeAdu, ts?.enzymaticAdu,
        session.thermalTimeline, targetBakeH,
      );
      const pt = points.find(p => p.h >= targetBakeH) ?? points[points.length - 1];
      return pt ? Math.max(mNow, Math.min(1, pt.matPct / 100)) : mNow;
    } catch { return mNow; }
  }, [session, ts?.tempAmbient, ts?.elapsedH, ts?.cumulativeAdu, ts?.enzymaticAdu, targetBakeH, mNow]);

  const nowIdx  = computeProfileIndicesAt(mNow,   profileParams);
  const bakeIdx = computeProfileIndicesAt(mAtBake, profileParams);

  // Scioglievolezza: segnala se a cottura è sotto il picco (mAtBake > 87%)
  const sciDeclines = bakeIdx.sci < nowIdx.sci;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pm4-umber)' }}>
          ● ora · ◐ a cottura
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          { label: 'Estensibilità',   now: nowIdx.ext,   bake: bakeIdx.ext,   color: 'var(--pm4-flour)' },
          { label: 'Aromi',           now: nowIdx.aroma, bake: bakeIdx.aroma, color: 'var(--pm4-ember-lo)'           },
          { label: 'Scioglievolezza', now: nowIdx.sci,   bake: bakeIdx.sci,   color: 'var(--pm4-ember)'              },
        ].map(({ label, now, bake, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--pm4-tan)' }}>
              {label}
            </span>
            <QualityOverlayDot now={now} bake={bake} color={color} label={label} />
          </div>
        ))}
      </div>
      {sciDeclines && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pm4-ember-lo)', marginTop: 10 }}>
          ⚠ Scioglievolezza in calo a cottura — considera anticipo servizio
        </div>
      )}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--pm4-umber)', marginTop: 6 }}>
        Stima euristica · varia con protocollo, farine e prefermenti
      </div>
    </div>
  );
}
