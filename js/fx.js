/* GloryXI fx — tilt/pointer parallax driving --px / --py (-1..1).
   Pure graphics layer: no game logic, no DOM mutations.
   Phone: deviceorientation (iOS asks permission on first touch).
   Desktop: pointer position. Reduced-motion users get a static page. */

(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const root = document.documentElement;
  let tx = 0, ty = 0;   // target
  let cx = 0, cy = 0;   // current (eased)
  let raf = 0;

  function tick() {
    cx += (tx - cx) * 0.13;
    cy += (ty - cy) * 0.13;
    root.style.setProperty('--px', cx.toFixed(3));
    root.style.setProperty('--py', cy.toFixed(3));
    raf = (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001)
      ? requestAnimationFrame(tick) : 0;
  }
  function aim(x, y) {
    tx = Math.max(-1, Math.min(1, x));
    ty = Math.max(-1, Math.min(1, y));
    if (!raf) raf = requestAnimationFrame(tick);
  }

  // desktop: the world leans toward the pointer
  addEventListener('pointermove', e => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    aim((e.clientX / innerWidth - 0.5) * 2, (e.clientY / innerHeight - 0.5) * 2);
  }, { passive: true });

  // phone: the world moves with the device
  const NEUTRAL_BETA = 40;  // comfortable holding angle, not flat on a table
  function onOrient(e) {
    if (e.gamma == null || e.beta == null) return;
    aim(e.gamma / 28, (e.beta - NEUTRAL_BETA) / 28);
  }
  function armGyro() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS: must be called from a user gesture; denial = quiet fallback
      DeviceOrientationEvent.requestPermission()
        .then(s => { if (s === 'granted') addEventListener('deviceorientation', onOrient, { passive: true }); })
        .catch(() => {});
    } else {
      addEventListener('deviceorientation', onOrient, { passive: true });
    }
  }
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    addEventListener('touchend', armGyro, { once: true, passive: true });
  } else {
    armGyro();
  }

  // idle drift — when nobody moves for a while, the world breathes on its own
  let lastInput = 0;
  const origAim = aim;
  const markInput = () => { lastInput = performance.now(); };
  addEventListener('pointermove', markInput, { passive: true });
  addEventListener('touchstart', markInput, { passive: true });
  setInterval(() => {
    if (performance.now() - lastInput < 4000) return;
    const t = performance.now() / 1000;
    origAim(Math.sin(t * 0.21) * 0.5, Math.cos(t * 0.13) * 0.38);
  }, 250);

  // counter pop — replay .count-pop whenever the XI counter text changes
  const popOnChange = id => {
    const el = document.getElementById(id);
    if (!el) return;
    new MutationObserver(() => {
      el.classList.remove('count-pop');
      void el.offsetWidth;            // restart the animation
      el.classList.add('count-pop');
    }).observe(el, { childList: true, characterData: true, subtree: true });
  };
  addEventListener('DOMContentLoaded', () => {
    popOnChange('board-count');
    popOnChange('board-count-2');
  });
  if (document.readyState !== 'loading') {
    popOnChange('board-count');
    popOnChange('board-count-2');
  }
})();
