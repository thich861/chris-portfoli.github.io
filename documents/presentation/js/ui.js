/* ============================================================
   UI — page-load wipe + screenshot lightbox.
   (Header inversion and reveals are owned by the Deck now;
   the FAQ accordion is gone — takeaways are a static slide.)
   ============================================================ */
(function () {
  'use strict';

  window.UI = {

    /* ---- page-load wipe: ink panel slides up and reveals slide 1 ---- */
    wipe(reduced) {
      const w = document.getElementById('wipe');
      if (!w) return;
      if (reduced) { w.remove(); return; }
      gsap.to(w, {
        yPercent: -100, duration: .9, ease: 'power3.inOut', delay: .15,
        onComplete: () => w.remove()
      });
    },

    /* ---- first-slide intro reveal ---- */
    intro(reduced) {
      if (reduced) return;
      const els = document.querySelectorAll('.slide.is-active [data-reveal]');
      gsap.fromTo(els, { autoAlpha: 0, y: 24 },
        { autoAlpha: 1, y: 0, duration: .9, ease: 'power3.out', stagger: .1, delay: .55 });
    },

    /* ---- screenshot lightbox (Esc or click closes) ---- */
    lightbox() {
      const lb = document.getElementById('lightbox');
      const img = lb.querySelector('img');
      document.querySelectorAll('.shot img').forEach(s => {
        s.parentElement.addEventListener('click', () => {
          img.src = s.src;
          lb.classList.add('open');
        });
      });
      lb.addEventListener('click', () => lb.classList.remove('open'));
      addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.remove('open'); });
    }
  };
})();
