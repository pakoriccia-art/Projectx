/**
 * PizzaMatrix — FermentationTimeline (Dashboard v4)
 * Timeline orizzontale delle fasi, derivata da session.thermalTimeline (fonte di verità).
 * Si aggiorna automaticamente quando Aggiusta Rotta rigenera la timeline.
 */
import { useMemo, useState, useEffect, useRef } from 'react';
import type React from 'react';
import type { PhaseSegment, Session } from '../../db/db';
import { buildInitialTimeline } from '../../db/db';
import {
  deriveCanonicalPhases, canonicalDisplayLabel, type CanonicalPhase,
} from '../../engine/canonicalPhases';
import { SEMAFORO_COLORS, type SemaforoState } from './SemaforoCard';
import { useReducedMotion, shakeElement } from '../ui';
import { haptics } from '../../lib/haptics';

export interface TimelinePhase {
  phaseType:    string;
  label:        string;
  absoluteTime: Date;
  isCompleted:  boolean;
  isCurrent:    boolean;
  isFuture:     boolean;
  isBake:       boolean;
  hoursFromNow: number;
}

/**
 * Mappa un PhaseSegment → label timeline (Bug #76).
 * L'ultimo proofing è la COTTURA; i proofing precedenti con durata > 0.1h
 * sono TEMPERING. Nessuna fase 'LIEVITAZIONE' (non esiste in PhaseSegment[]).
 */
export function buildTimelinePhases(
  timeline: PhaseSegment[] | undefined,
  session: Session,
  now: Date,
): TimelinePhase[] {
  const rawSegs = (timeline && timeline.length > 0)
    ? timeline
    : buildInitialTimeline(session as any);
  // Resilienza record Dexie corrotti: scarta segmenti null/non-oggetto o senza
  // phaseType valido — un solo segmento corrotto faceva crashare l'intera dashboard.
  const segs = (Array.isArray(rawSegs) ? rawSegs : []).filter(
    (s): s is PhaseSegment => !!s && typeof s.phaseType === 'string',
  );
  if (segs.length === 0) return [];

  const startMs = session.startedAt
    ? new Date(session.startedAt).getTime()
    : Date.now();
  const nowMs = now.getTime();

  const lastProofingIdx = segs.reduce(
    (acc, s, i) => (s.phaseType === 'proofing' ? i : acc), -1);

  const phases: TimelinePhase[] = [];
  segs.forEach((seg, i) => {
    let label: string;
    let isBake = false;
    switch (seg.phaseType) {
      case 'bulk_room':     label = 'PUNTATA · TA'; break;
      case 'bulk_fridge':   label = 'PUNTATA · TC'; break;
      case 'balled_room':   label = 'STAGLIO';      break;
      case 'balled_fridge': label = 'APPRETTO · TC'; break;
      case 'baking':        label = 'COTTURA'; isBake = true; break;
      case 'proofing': {
        const dur = (seg.endElapsedH ?? seg.startElapsedH) - seg.startElapsedH;
        if (i === lastProofingIdx) { label = 'COTTURA'; isBake = true; }
        else if (dur > 0.1)        { label = 'TEMPERING'; }
        else return; // proofing intermedio a durata nulla → non mostrare
        break;
      }
      default: label = seg.phaseType.toUpperCase();
    }
    const absMs = startMs + seg.startElapsedH * 3_600_000;
    phases.push({
      phaseType:    seg.phaseType,
      label,
      absoluteTime: new Date(absMs),
      isCompleted:  seg.status === 'completed',
      isCurrent:    seg.status === 'current',
      // Bug #94: usa margine 5min per evitare che la fase corrente risulti "futura"
      // di pochi secondi. Solo fasi con start > now + 5min sono tappabili.
      isFuture:     (absMs - nowMs) > 5 * 60 * 1000,
      isBake,
      hoursFromNow: (absMs - nowMs) / 3_600_000,
    });
  });

  return phases;
}

/** Orario del marker, col giorno quando non è oggi: 24h di frigo non sembrano 15 minuti. */
function formatAbsoluteTime(d: Date, nowMs = Date.now()): string {
  const t = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date(nowMs).toDateString()
    ? t : `${d.toLocaleDateString('it-IT', { weekday: 'short' })} ${t}`;
}

function formatCountdown(h: number): string {
  if (h <= 0) return 'ora';
  // minuti totali prima di dividere: niente più "3h60"
  const tot = Math.round(h * 60);
  if (tot < 60) return `${tot}min`;
  const hh = Math.floor(tot / 60);
  const mm = tot % 60;
  return mm > 0 ? `${hh}h${mm.toString().padStart(2, '0')}` : `${hh}h`;
}

// v2.4.20: marker derivato da una fase CANONICA (single source of truth).
function CanonicalMarker({ phase, nowMs, currentSemaforoState, isCurrent, overdue, enterable, onTransition, onLockedTap, displayMs, done, subline }: {
  phase: CanonicalPhase; nowMs: number; currentSemaforoState: SemaforoState;
  /** Orario mostrato: il segmento pianificato reale (o la previsione per la cottura). */
  displayMs: number;
  /** Fase conclusa per un evento registrato (es. COTTURA dopo "Ho infornato"). */
  done?: boolean;
  /** Riga piccola sotto l'orario (es. "piano 03:50"). */
  subline?: string;
  /** Una sola fase è "corrente" a schermo (la prima), anche se più fasi canoniche condividono il segmento. */
  isCurrent: boolean;
  /** Fase pianificata il cui orario è arrivato: resta toccabile e lo dice. */
  overdue: boolean;
  /**
   * Il suo segmento è ancora pianificato anche se la fase canonica risulta già
   * "in corso" (es. APPRETTO TC durante il riposo dello staglio): si può entrare
   * prima dell'orario previsto, con la solita conferma.
   */
  enterable?: boolean;
  onTransition?: (phaseType: string, label: string) => void;
  onLockedTap?: () => void;
}) {
  const isCompleted  = phase.state === 'past' || !!done;
  const hoursFromNow = (displayMs - nowMs) / 3_600_000;
  // "in ritardo" solo dopo 5 minuti: prima è semplicemente "ora".
  const lateMin      = (nowMs - displayMs) / 60_000;

  const dotColor = SEMAFORO_COLORS[currentSemaforoState];

  const showBadge = overdue || (phase.tappable && hoursFromNow > 0 && hoursFromNow <= 4);
  // Bug #94 / v2.4.20: la tappabilità a monte vale per le fasi oltre now+5min; in più
  // la fase in ritardo resta toccabile, altrimenti lo staglio mancato non si registra più.
  const canTransition = (phase.tappable || overdue || !!enterable) && !!onTransition;
  // Una fase è "bloccata" se è passata/corrente (non tappabile) ma comunque toccabile
  // dall'utente che si aspetta una reazione. WP-5(A): feedback senza dispatch.
  const isLocked = !canTransition && !done && !phase.isBake && (isCompleted || isCurrent);

  const reduced = useReducedMotion();
  const markerRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);

  // WP-5(A): tap su fase bloccata → shake/flash + haptics + messaggio, NESSUN dispatch.
  // La guardia di transizione resta intatta: questo ramo non chiama mai onTransition.
  const handleLockedTap = () => {
    if (reduced) { setFlash(true); setTimeout(() => setFlash(false), 220); }
    else         { shakeElement(markerRef.current); }
    haptics('Light');
    onLockedTap?.();
  };

  const pipBase: React.CSSProperties = {
    width: isCurrent ? 15 : 11,
    height: isCurrent ? 15 : 11,
    borderRadius: phase.isBake ? 2 : '50%',
    transform: phase.isBake ? 'rotate(45deg)' : 'none',
  };
  // Il verde è riservato a "pronto": le fasi fatte sono in terra d'ombra.
  const pipStyle: React.CSSProperties = isCurrent
    ? { ...pipBase, background: dotColor, boxShadow: `0 0 0 3px ${dotColor}40`, ['--pip-ring' as any]: `${dotColor}40` }
    : isCompleted
      ? { ...pipBase, background: 'var(--pm4-umber)' }
      : overdue
        ? { ...pipBase, background: 'var(--pm4-panel-hi)', boxShadow: '0 0 0 2px var(--pm4-ember)' }
        : { ...pipBase, background: 'var(--pm4-panel-hi)', boxShadow: '0 0 0 2px var(--pm4-line-strong)' };

  // Il tap su una fase futura NON cambia fase: chiede conferma al parent
  // (un tap accidentale con le mani infarinate non deve bruciare ore di puntata).
  const activate = canTransition
    ? () => onTransition!(phase.transitionTo, canonicalDisplayLabel(phase))
    : (isLocked ? handleLockedTap : undefined);

  return (
    <div
      ref={markerRef}
      onClick={activate}
      onKeyDown={activate ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } } : undefined}
      tabIndex={activate ? 0 : undefined}
      className={canTransition ? 'pm4-tap' : undefined}
      role={canTransition || isLocked ? 'button' : undefined}
      aria-label={isLocked
        ? `${canonicalDisplayLabel(phase)} — fase bloccata, il tempo va solo avanti`
        : canTransition
          ? `${overdue ? 'In ritardo: ' : ''}passa a ${canonicalDisplayLabel(phase)} ora (chiede conferma)`
          : undefined}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 5, minWidth: 56,
        cursor: canTransition ? 'pointer' : (isLocked ? 'not-allowed' : 'default'),
        borderRadius: 8,
        outline: flash ? '1px solid var(--pm4-ember-lo)' : 'none',
        transition: 'outline 0.1s',
      }}
    >
      {/* Lucchetto sulle fasi consolidate (affordance visiva prima del tap) */}
      {isLocked && isCompleted && !phase.isBake && (
        <div aria-hidden="true" style={{
          position: 'absolute', top: 18, right: 4, fontSize: 11,
        }}>🔒</div>
      )}
      {/* Affordance tap (brace) sui marker toccabili */}
      {canTransition && (
        <div aria-hidden="true" style={{
          position: 'absolute', top: 18, right: 6,
          width: 7, height: 7, borderRadius: '50%',
          background: 'var(--pm4-ember)',
        }} />
      )}
      {showBadge ? (
        <div style={{
          background: 'rgba(255,140,50,0.12)', border: '1px solid rgba(255,140,50,0.45)', borderRadius: 5,
          padding: '1px 5px', color: overdue ? 'var(--pm4-ember)' : 'var(--pm4-ember-lo)', fontSize: 11, letterSpacing: '0.02em',
          marginBottom: 2, whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontWeight: overdue ? 700 : 400,
        }}>
          {overdue ? (lateMin >= 5 ? 'in ritardo' : 'ora') : `tra ${formatCountdown(hoursFromNow)}`}
        </div>
      ) : (
        <div style={{ height: 19 }} />
      )}

      <div className={isCurrent ? 'pm4-pip-cur' : (canTransition ? 'pm4-pip-tap' : undefined)} style={pipStyle} />

      <div style={{
        color: isCurrent ? 'var(--pm4-ember-lo)' : overdue ? 'var(--pm4-ember)' : 'var(--pm4-tan)',
        fontSize: 11, textAlign: 'center', letterSpacing: '0.04em', textTransform: 'uppercase',
        lineHeight: 1.25, fontFamily: 'var(--font-mono)', maxWidth: 60,
      }}>
        {/* nome e ambiente su due righe volute: "· TA" non va più a capo da solo */}
        {phase.label}
        {phase.env && <><br /><span style={{ color: 'var(--pm4-umber)' }}>{phase.env}</span></>}
      </div>

      <div style={{
        color: isCompleted ? 'var(--pm4-umber)' : 'var(--pm4-tan)',
        fontSize: 11, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
      }}>
        {formatAbsoluteTime(new Date(displayMs), nowMs)}
      </div>
      {subline && (
        <div style={{ color: 'var(--pm4-umber)', fontSize: 11, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          {subline}
        </div>
      )}
    </div>
  );
}

export function FermentationTimeline({
  session, currentSemaforoState, onPhaseTransition, dueTransition, bakeForecastMs, bakedAtMs,
}: {
  session: Session; currentSemaforoState: SemaforoState;
  onPhaseTransition?: (phaseType: string, label: string) => void;
  /** phaseType del prossimo segmento pianificato già arrivato all'orario (se c'è). */
  dueTransition?: string | null;
  /** Orario di cottura previsto (stesso del blocco centrale): la COTTURA mostra questo. */
  bakeForecastMs?: number | null;
  /** Infornata registrata: COTTURA fatta, con l'orario reale. */
  bakedAtMs?: number | null;
}) {
  // now è locale — non causa re-render del parent ogni secondo
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);
  // Messaggio sul tap di una fase bloccata: sotto la strip, così lo scroll
  // orizzontale non lo taglia.
  const [lockedMsg, setLockedMsg] = useState(false);
  const lockedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (lockedTimer.current) clearTimeout(lockedTimer.current); }, []);
  const showLocked = () => {
    setLockedMsg(true);
    if (lockedTimer.current) clearTimeout(lockedTimer.current);
    lockedTimer.current = setTimeout(() => setLockedMsg(false), 2600);
  };

  const startedAtMs = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  const nowMs       = now.getTime();
  const temperingH  = (session as any).temperingH as number | undefined;

  // v2.4.20: fasi CANONICHE dalla timeline effettiva (stessa sorgente di chip header
  // e stringa header grafico). Sempre PUNTATA→STAGLIO→APPRETTO→COTTURA (+TEMPERING),
  // anche con segmenti a durata ~0. Fallback alla timeline iniziale se assente.
  const phases = useMemo(
    () => {
      const tl = (session.thermalTimeline && session.thermalTimeline.length > 0)
        ? session.thermalTimeline
        : buildInitialTimeline(session as any);
      return deriveCanonicalPhases(tl, startedAtMs, nowMs, { temperingH });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Re-calcola ogni minuto (countdown badge) + su cambio timeline o sessione
    [session.thermalTimeline, session.id, startedAtMs, temperingH, Math.floor(nowMs / 60_000)],
  );

  if (phases.length === 0) return null;

  // Orari reali dei segmenti pianificati: dopo uno staglio registrato la timeline
  // ripianifica, e la strip deve mostrare gli stessi orari della banda.
  const tlNow = (session.thermalTimeline && session.thermalTimeline.length > 0)
    ? session.thermalTimeline : buildInitialTimeline(session as any);
  // Inizio reale del segmento in cui si entra (fatto, in corso o pianificato):
  // dopo un "Fatto ora" l'appretto in frigo mostra quando è entrato in frigo.
  const plannedStart = new Map<string, number>();
  for (const sg of [...tlNow].filter(x => !!x).sort((a, b) => a.startElapsedH - b.startElapsedH)) {
    if (!plannedStart.has(sg.phaseType)) plannedStart.set(sg.phaseType, startedAtMs + sg.startElapsedH * 3_600_000);
  }
  const displayFor = (p: CanonicalPhase): number => {
    if (p.isBake) return bakedAtMs ?? bakeForecastMs ?? p.startMs;
    if (p.key !== 'puntata' && plannedStart.has(p.transitionTo)) return plannedStart.get(p.transitionTo)!;
    return p.startMs;
  };

  // Una sola fase corrente a schermo: la prima (la stessa del chip nell'header).
  // Dopo l'infornata non c'è più una fase corrente: tutto è fatto.
  const baked = bakedAtMs != null;
  const currentKey = baked ? undefined : phases.find(p => p.state === 'current')?.key;
  // La fase in ritardo è quella che porta al segmento pianificato già scaduto.
  // phaseType dei segmenti ancora pianificati (si possono anticipare con conferma)
  const plannedTypes = new Set(tlNow.filter(x => x && x.status === 'planned').map(x => x.phaseType));
  const overdueKey = dueTransition
    ? phases.find(p => p.key !== currentKey && !p.isBake && p.state !== 'past' && p.transitionTo === dueTransition)?.key
    : undefined;

  // Avanzamento reale lungo la strip: tempo trascorso sull'arco inizio → cottura.
  const firstMs = phases[0].startMs;
  const lastMs  = phases[phases.length - 1].startMs;
  const progressPct = baked ? 100 : lastMs > firstMs
    ? Math.max(0, Math.min(100, ((nowMs - firstMs) / (lastMs - firstMs)) * 100))
    : 0;

  // R7: con molte fasi la timeline scrolla in orizzontale; mostra un fade a destra
  // come affordance di scroll (euristica: ≥6 marker superano il viewport ~430px).
  const scrollable = phases.length >= 6;

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative', paddingTop: 16, paddingBottom: 8, overflowX: 'auto' }}>
        <div style={{ position: 'absolute', top: 42, left: 24, right: 24, height: 2, borderRadius: 2,
          background: `linear-gradient(90deg, var(--pm4-tan) 0%, var(--pm4-tan) ${progressPct}%, var(--pm4-line-strong) ${progressPct}%, var(--pm4-line-strong) 100%)` }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', gap: 10, minWidth: 'min-content' }}>
          {phases.map((phase) => (
            <CanonicalMarker
              key={phase.key}
              phase={phase}
              nowMs={nowMs}
              currentSemaforoState={currentSemaforoState}
              isCurrent={phase.key === currentKey}
              overdue={phase.key === overdueKey}
              enterable={phase.key !== currentKey && !phase.isBake && phase.key !== 'puntata' && plannedTypes.has(phase.transitionTo)}
              onTransition={onPhaseTransition}
              onLockedTap={showLocked}
              displayMs={displayFor(phase)}
              done={baked}
            />
          ))}
        </div>
      </div>
      {scrollable && (
        <div aria-hidden style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 28, pointerEvents: 'none',
          background: 'linear-gradient(90deg, transparent, var(--pm4-panel-lo))',
        }} />
      )}
      <div role="status" style={{
        minHeight: lockedMsg ? undefined : 0, color: 'var(--pm4-tan)', fontSize: 12,
        fontFamily: 'var(--font-mono)', textAlign: 'center', padding: lockedMsg ? '2px 0 6px' : 0,
      }}>
        {lockedMsg ? '🔒 Le fasi già iniziate sono bloccate: il tempo va solo avanti.' : ''}
      </div>
    </div>
  );
}
