/**
 * PizzaMatrix — il focus non finisce mai sul <body>.
 *
 * Molti comandi smontano se stessi (Annulla che scade, conferme che si chiudono,
 * modali, cambi di vista). Quando l'elemento che aveva il focus sparisce, il
 * focus va sul punto di ripiego della vista ([data-focus-fallback]) o sul suo h1.
 * Le azioni che sanno dove mandarlo lo fanno da sé: questo è solo il paracadute.
 */

export function focusFallback(root: ParentNode = document): HTMLElement | null {
  const el = root.querySelector<HTMLElement>('[data-focus-fallback]') ?? root.querySelector<HTMLElement>('main h1, h1');
  if (!el) return null;
  if (!el.hasAttribute('tabindex') && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.tabIndex = -1;
  el.focus({ preventScroll: true });
  return el;
}

const lost = () => !document.activeElement || document.activeElement === document.body;

/** Da chiamare una volta all'avvio: ritorna la funzione che lo spegne. */
export function installFocusRescue(): () => void {
  let last: Element | null = null;
  const onFocusIn = (e: FocusEvent) => { last = e.target as Element; };
  document.addEventListener('focusin', onFocusIn);
  const obs = new MutationObserver(() => {
    if (!(last && !last.isConnected && lost())) return;
    last = focusFallback();
    // vista caricata in differita: il suo titolo arriva dopo
    if (!last) setTimeout(() => { if (lost()) last = focusFallback(); }, 400);
  });
  obs.observe(document.body, { childList: true, subtree: true });
  return () => { document.removeEventListener('focusin', onFocusIn); obs.disconnect(); };
}
