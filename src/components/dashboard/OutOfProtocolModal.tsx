/**
 * PizzaMatrix — OutOfProtocolModal (v2.4.19 PARTE A)
 *
 * Advisory + conferma per una fase fuori dal protocollo_preferito dello stile
 * (es. fase frigo in stile ta_only). Mai silenzioso, mai automatico.
 *   [Conferma fase TC] → inserisce la fase frigo in tutte e tre le viste.
 *   [Resta all-TA]     → timeline all-TA, grafico accorciato, overshoot onesto.
 * Default = non confermato: in assenza di scelta la fase NON esiste.
 */
import { useDialogFocus } from './useDialogFocus';

// Il codice di protocollo resta interno: all'utente si dice cosa significa.
const PROTOCOL_TEXT: Record<string, string> = {
  ta_only: 'solo temperatura ambiente',
  tc_only: 'solo frigo',
};
export function OutOfProtocolModal({
  styleLabel, ambientTempC, protocolLabel, onConfirm, onStayTA,
}: {
  styleLabel: string;
  ambientTempC: number;
  protocolLabel: string;     // es. "ta_only"
  onConfirm: () => void;     // [Conferma fase TC]
  onStayTA: () => void;      // [Resta all-TA]
}) {
  const ref = useDialogFocus<HTMLDivElement>();
  const protocolText = PROTOCOL_TEXT[protocolLabel] ?? protocolLabel.replace(/_/g, ' ');
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="pm-oop-title" aria-describedby="pm-oop-msg" style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'radial-gradient(120% 90% at 50% 0%, rgba(40,28,6,0.96), rgba(8,6,5,0.98))',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: 24,
    }}>
      <div aria-hidden="true" style={{ color: 'var(--state-cold)', fontSize: 44 }}>❄</div>
      <div id="pm-oop-title" style={{
        color: 'var(--pm4-ember)', fontSize: 16, fontWeight: 800,
        textAlign: 'center', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
      }}>
        FASE FUORI PROTOCOLLO
      </div>
      <div style={{
        color: 'var(--pm4-tan)', fontSize: 12, textAlign: 'center',
        fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', marginTop: -8,
      }}>
        {styleLabel} · di solito {protocolText}
      </div>
      <div id="pm-oop-msg" style={{ color: 'var(--pm4-tan)', fontSize: 13, textAlign: 'center', lineHeight: 1.6, maxWidth: 340 }}>
        Con queste durate a {ambientTempC.toFixed(0)}°C, restando tutto a temperatura
        ambiente la maturazione supera il target. Per evitarlo servirebbe una fase in frigo,
        che per la {styleLabel} non è la norma. Aggiungere una fase in frigo?
      </div>
      <button onClick={onConfirm} className="pm4-btn pm4-btn-warm" style={{
        background: 'linear-gradient(180deg, var(--state-cold), #2b6fb0)', color: '#fff', border: 'none',
        borderRadius: 9, padding: '14px 32px', fontSize: 14, fontWeight: 700,
        cursor: 'pointer', marginTop: 8, fontFamily: 'var(--font-mono)',
        boxShadow: '0 8px 22px -8px rgba(43,111,176,0.7)',
      }}>
        ❄ Aggiungi la fase in frigo
      </button>
      <button onClick={onStayTA} style={{
        background: 'none', border: '1px solid var(--pm4-line-strong)', color: 'var(--pm4-tan)',
        fontSize: 13, cursor: 'pointer', borderRadius: 9, minHeight: 44,
        padding: '10px 18px', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
      }}>
        Resta tutto a temperatura ambiente
      </button>
    </div>
  );
}
