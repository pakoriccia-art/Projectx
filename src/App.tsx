/**
 * PizzaMatrix — Root App
 * Routing basato su AppContext (view state machine, no react-router)
 * Hooks globali: persistenza DB, notifiche Capacitor
 */
import { Component, type ReactNode } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { WizardView }          from './components/wizard/WizardView';
import { DashboardView }       from './components/dashboard/DashboardView';
import { HistoryView }         from './components/history/HistoryView';
import { RottaView }           from './components/rotta/RottaView';
import { ReverseScalingView }      from './components/tools/ReverseScalingView';
import { FermentationPlannerView } from './components/tools/FermentationPlannerView';
import { useSessionPersistence }     from './hooks/useSessionPersistence';
import { useCapacitorNotifications } from './hooks/useCapacitorNotifications';

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: string },
  { error: string | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e: Error) {
    return { error: e.message ?? String(e) };
  }
  componentDidCatch(e: Error) {
    console.error('[ErrorBoundary]', e);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100dvh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          padding: '24px', background: 'var(--bg-base)',
        }}>
          <div style={{ fontSize: '2rem' }}>⚠️</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--state-critical)' }}>
            Errore di rendering
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
            color: 'var(--text-muted)', textAlign: 'center', maxWidth: 340,
            background: 'rgba(214,48,49,0.1)', padding: '12px 16px',
            borderRadius: 8, border: '1px solid rgba(214,48,49,0.3)',
          }}>
            {this.state.error}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              background: 'var(--accent-brand)', color: '#0a0806',
              border: 'none', borderRadius: 8, padding: '12px 24px',
              fontFamily: 'var(--font-mono)', fontWeight: 700, cursor: 'pointer',
            }}
          >
            ← Torna alla home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Effetti globali (dentro AppProvider) ─────────────────────────────────────
function AppEffects() {
  useSessionPersistence();
  useCapacitorNotifications();
  return null;
}

// ─── Home Screen ──────────────────────────────────────────────────────────────
function HomeView() {
  const { dispatch } = useApp();
  return (
    <div style={{
      minHeight: '100dvh',
      padding: '0 var(--padding-h)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 24,
    }}>
      {/* Logo */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: '2.6rem',
          fontWeight: 900,
          color: 'var(--accent-brand)',
          letterSpacing: '-0.03em',
          lineHeight: 1,
        }}>
          PizzaMatrix
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.72rem',
          color: 'var(--text-muted)',
          letterSpacing: '0.12em',
          marginTop: 6,
        }}>
          ENGINE v2.4.0 · FERMENTATION SCIENCE
        </div>
      </div>

      {/* Tagline */}
      <div style={{
        fontFamily: 'var(--font-body)',
        fontSize: '0.9rem',
        color: 'var(--text-secondary)',
        textAlign: 'center',
        maxWidth: 280,
        lineHeight: 1.6,
      }}>
        Modello predittivo Gompertz · Hill W-decay · CTM×Arrhenius · pH dinamico
      </div>

      {/* CTAs */}
      <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          onClick={() => {
            dispatch({ type: 'WIZARD_RESET' });
            dispatch({ type: 'NAV', view: 'wizard' });
          }}
          style={{
            background: 'var(--accent-brand)',
            color: '#0a0806',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: '1rem',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          🍕 Nuovo impasto
        </button>

        <button
          onClick={() => dispatch({ type: 'NAV', view: 'history' })}
          style={{
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 'var(--radius-md)',
            padding: '13px 20px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.9rem',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          📋 Storico sessioni
        </button>

        <button
          onClick={() => dispatch({ type: 'NAV', view: 'planner' })}
          style={{
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 'var(--radius-md)',
            padding: '13px 20px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.9rem',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          🧪 Pianifica fermentazione
        </button>

        <button
          onClick={() => dispatch({ type: 'NAV', view: 'tools' })}
          style={{
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 'var(--radius-md)',
            padding: '13px 20px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.9rem',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          🔢 Reverse Scaling
        </button>

      </div>

      {/* Version badge */}
      <div style={{
        position: 'absolute',
        bottom: 'max(20px, env(safe-area-inset-bottom))',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.65rem',
        color: 'var(--text-muted)',
        letterSpacing: '0.08em',
      }}>
        v2.4.0 · Capacitor Android + Web
      </div>
    </div>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────
function AppRouter() {
  const { state } = useApp();
  switch (state.view) {
    case 'wizard':    return <ErrorBoundary><WizardView /></ErrorBoundary>;
    case 'dashboard': return <ErrorBoundary><DashboardView /></ErrorBoundary>;
    case 'rotta':     return <ErrorBoundary><RottaView /></ErrorBoundary>;
    case 'history':   return <ErrorBoundary><HistoryView /></ErrorBoundary>;
    case 'tools':   return <ErrorBoundary><ReverseScalingView /></ErrorBoundary>;
    case 'planner': return <ErrorBoundary><FermentationPlannerView /></ErrorBoundary>;
    default:        return <HomeView />;
  }
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AppProvider>
      <AppEffects />
      <AppRouter />
    </AppProvider>
  );
}
