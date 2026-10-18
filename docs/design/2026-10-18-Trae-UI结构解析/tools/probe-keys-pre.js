() => {
  window.__kd = [];
  document.addEventListener('keydown', e => window.__kd.push({
    key: e.key, code: e.code, kc: e.keyCode,
    ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
    trusted: e.isTrusted,
    on: (typeof e.target?.className === 'string' ? e.target.className : e.target?.tagName || '').slice(0, 46),
  }), true);
  return 'listener installed; activeEl=' + (document.activeElement ? (document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0, 30)) : 'none')
    + '; hasFocus=' + document.hasFocus()
    + '; visibility=' + document.visibilityState;
}
