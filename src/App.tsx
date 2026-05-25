/**
 * PizzaMatrix — Root App
 * Routing basato su AppContext (view state machine, no react-router)
 * Views: home → wizard → dashboard | history | rotta
 */
import { AppProvider, useApp } from './context/AppContext';
import { WizardView } from './components/wizard/WizardView';
import { DashboardView } from './components/dashboard/DashboardView';

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

      {/* CTA */}
      <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          onClick={() => {
            dispatch({ type: 'WIZARD_RESET' });
            dispatch({ type: 'NAV', view: 'wizard' });
          }}
          style={{
            ...{
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
            }
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

// ─── Rotta / Adjust Protocol placeholder ─────────────────────────────────────
function RottaView() {
  const { dispatch } = useApp();
  return (
    <div style={{
      minHeight: '100dvh', padding: '24px var(--padding-h)',
      display: 'flex', flexDirection: 'column', gap: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => dispatch({ type: 'NAV', view: 'dashboard' })} style={{
          background: 'none', border: 'none', color: 'var(--accent-brand)',
          fontFamily: 'var(--font-mono)', fontSize: '1rem', cursor: 'pointer',
        }}>←</button>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Aggiusta Rotta
        </h2>
      </div>
      <div style={{
        background: 'var(--bg-elevated)',
        borderRadius: 'var(--radius-lg)',
        padding: 20,
        fontFamily: 'var(--font-body)',
        color: 'var(--text-secondary)',
        fontSize: '0.88rem',
        lineHeight: 1.6,
      }}>
        <p style={{ margin: 0 }}>
          La funzionalità "Aggiusta Rotta" permette di modificare temperatura ambiente, fase e soglie
          in corsa. In arrivo nella prossima versione.
        </p>
        <div style={{ marginTop: 16, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Features in sviluppo:
        </div>
        <ul style={{ marginTop: 8, paddingLeft: 18, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          <li>Cambio temperatura ambiente con ricalcolo τ</li>
          <li>Slittamento target cottura</li>
          <li>Aggiunta freddo in corsa</li>
          <li>Override W e soglia maturazione</li>
        </ul>
      </div>
      <button
        onClick={() => dispatch({ type: 'NAV', view: 'dashboard' })}
        style={{
          background: 'var(--accent-brand)', color: '#0a0806',
          border: 'none', borderRadius: 'var(--radius-md)',
          padding: '13px 20px', fontFamily: 'var(--font-mono)',
          fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
        }}
      >
        ← Torna al dashboard
      </button>
    </div>
  );
}

// ─── History placeholder ──────────────────────────────────────────────────────
function HistoryView() {
  const { dispatch } = useApp();
  return (
    <div style={{
      minHeight: '100dvh', padding: '24px var(--padding-h)',
      display: 'flex', flexDirection: 'column', gap: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => dispatch({ type: 'NAV', view: 'home' })} style={{
          background: 'none', border: 'none', color: 'var(--accent-brand)',
          fontFamily: 'var(--font-mono)', fontSize: '1rem', cursor: 'pointer',
        }}>←</button>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Storico sessioni
        </h2>
      </div>
      <div style={{
        background: 'var(--bg-elevated)',
        borderRadius: 'var(--radius-lg)',
        padding: 24,
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.85rem',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>📋</div>
        Nessuna sessione completata ancora.
        <div style={{ marginTop: 8, fontSize: '0.72rem' }}>
          Le sessioni terminate vengono salvate su IndexedDB (Dexie v4)
        </div>
      </div>
      <button
        onClick={() => dispatch({ type: 'NAV', view: 'home' })}
        style={{
          background: 'transparent', color: 'var(--text-secondary)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 'var(--radius-md)',
          padding: '13px 20px', fontFamily: 'var(--font-mono)',
          fontSize: '0.9rem', cursor: 'pointer',
        }}
      >
        ← Home
      </button>
    </div>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────
function AppRouter() {
  const { state } = useApp();
  switch (state.view) {
    case 'wizard':    return <WizardView />;
    case 'dashboard': return <DashboardView />;
    case 'rotta':     return <RottaView />;
    case 'history':   return <HistoryView />;
    default:          return <HomeView />;
  }
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AppProvider>
      <AppRouter />
    </AppProvider>
  );
}
