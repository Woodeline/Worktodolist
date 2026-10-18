() => {
  const qi = document.querySelector('.quick-input-widget');
  const vis = el => {
    if (!el) return 'absent';
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display + '/' + s.visibility + '/' + (s.opacity) + ' box=' + Math.round(r.width) + 'x' + Math.round(r.height);
  };
  return {
    keyEventsSeen: (window.__kd || []).slice(-8),
    keyEventCount: (window.__kd || []).length,
    quickInput: vis(qi),
    paletteInput: vis(document.querySelector('.quick-input-box .monaco-inputbox')),
    activeEl: document.activeElement
      ? document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0, 40)
      : 'none',
    hasFocus: document.hasFocus(),
    visibility: document.visibilityState,
  };
}
