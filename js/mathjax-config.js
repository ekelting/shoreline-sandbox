window.MathJax = {
  tex: { inlineMath: [['\\(', '\\)']], displayMath: [['\\[', '\\]']] },
  svg: { fontCache: 'global' },
  startup: {
    typeset: false,
    ready() { MathJax.startup.defaultReady(); if (window.__mjReady) window.__mjReady(); }
  }
};
