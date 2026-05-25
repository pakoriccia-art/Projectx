import React from 'react';

// Placeholder — verrà sostituito con il Router + Wizard + Dashboard
// quando verranno implementati i componenti v2.3.2/v2.4.0

export default function App() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100dvh',
      padding: '22px 18px',
      gap: '12px'
    }}>
      <h1 style={{
        fontFamily: 'var(--font-display)',
        fontSize: '2rem',
        color: 'var(--accent-brand)',
        letterSpacing: '-0.02em'
      }}>
        PizzaMatrix
      </h1>
      <p style={{
        fontFamily: 'var(--font-body)',
        fontSize: '0.9rem',
        color: 'var(--text-secondary)',
        textAlign: 'center'
      }}>
        Engine v2.4.0 caricato · Capacitor Android ready
      </p>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        background: 'var(--bg-elevated)',
        padding: '10px 16px',
        borderRadius: 'var(--radius-md)',
        marginTop: '8px'
      }}>
        Wizard + Dashboard in sviluppo
      </div>
    </div>
  );
}
