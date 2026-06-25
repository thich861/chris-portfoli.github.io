/* ============================================================
   main — boot order, presentation edition.
   1. detect reduced-motion
   2. Three.js scene (full on desktop; static frame on mobile /
      reduced motion; hidden if WebGL unavailable)
   3. Deck (slides, keys, camera flights)
   4. UI: wipe, intro reveal, lightbox
   No Lenis, no ScrollTrigger — nothing scrolls any more.
   ============================================================ */
(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) document.body.classList.add('no-motion');

  /* ---- 3D scene ---- */
  const boot3D = () => {
    /* a hidden/zero-size viewport would bake in a 0×0 canvas and a
       wrong mobile decision — wait for a real one */
    if (!window.innerWidth || !window.innerHeight) {
      window.addEventListener('resize', boot3D, { once: true });
      return;
    }
    const mobile = window.innerWidth < 768;
    const canvas = document.getElementById('scene');
    const ok = (typeof THREE !== 'undefined') &&
      Scene3D.init(canvas, { static: reduced || mobile, staticAt: 0 });
    if (!ok) document.body.classList.add('no-webgl');
  };
  boot3D();   /* the deck needs the scene right away for slide 1 */

  /* ---- presentation deck + chrome ---- */
  Deck.init({ reducedMotion: reduced });
  UI.lightbox();
  UI.wipe(reduced);
  UI.intro(reduced);
})();
