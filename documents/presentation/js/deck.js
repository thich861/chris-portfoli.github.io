/* ============================================================
   Deck — the presentation engine, journey edition.

   Flow:
   Title (wide) → Click → Zoom in to track start → Click →
   Red line moves to Stop 1, marker appears → Click →
   Marker expands into content → Click →
   Content shrinks back to marker → Click →
   Line moves to next stop… repeat for 5 stops →
   Wide shot Q&A

   Transitions:
   - scene → scene: camera flies, marker shows/hides
   - scene → surface: surface morphs from marker position
   - surface → scene: surface shrinks back to marker
   ============================================================ */
(function () {
  'use strict';

  let slides = [], cur = 0, busy = false, reduced = false, markerRevealTimer = null;
  const marker = document.getElementById('topicMarker');
  const tmNum = document.getElementById('tmNum');
  const tmTitle = document.getElementById('tmTitle');
  const tmDesc = document.getElementById('tmDesc');

  const markerData = {
    1: { num: '01', title: 'What is Our Specialization?', desc: 'Defining the specialization and why it matters.' },
    2: { num: '02', title: 'Two Layers & Technical Deep Dive', desc: 'VM vs hypervisor, modes, and the 3-2-1 rule.' },
    3: { num: '03', title: 'Proxmox vs VMware', desc: 'Head-to-head comparison and the verdict.' },
    4: { num: '04', title: 'Live Demo & Problem-Solving', desc: 'Backup, restore, and the NFS fix.' },
    5: { num: '05', title: 'Takeaways & Q&A', desc: 'Five things to remember.' }
  };

  function updateMarker(dataIdx) {
    const d = markerData[dataIdx];
    if (!d) { marker.classList.remove('visible'); return; }
    tmNum.textContent = d.num;
    tmTitle.textContent = d.title;
    tmDesc.textContent = d.desc;
  }

  function clearMarkerReveal() {
    if (markerRevealTimer) {
      clearTimeout(markerRevealTimer);
      markerRevealTimer = null;
    }
  }

  function hideMarker() {
    marker.classList.remove('visible');
  }

  function revealMarker(slide) {
    updateMarker(slide.dataset.marker);
    Scene3D.positionMarker(parseFloat(slide.dataset.fly) || 0);
    requestAnimationFrame(() => {
      if (slides[cur] === slide) marker.classList.add('visible');
    });
  }

  function sceneDuration(slide) {
    if (!slide || slide.dataset.fly == null) return 0;
    return parseFloat(slide.dataset.dur || 2.4);
  }

  function scheduleMarkerReveal(slide, instant) {
    if (!slide.dataset.marker) return;
    hideMarker();

    const delay = (reduced || instant) ? 0 : sceneDuration(slide) * 1000;
    markerRevealTimer = setTimeout(() => {
      markerRevealTimer = null;
      if (slides[cur] === slide) revealMarker(slide);
    }, delay);
  }

  function applyScene(slide, instant) {
    const isScene = slide.dataset.theme === 'scene';
    Scene3D.setActive(isScene);
    if (slide.dataset.fly != null) {
      const p = parseFloat(slide.dataset.fly);
      const z = slide.dataset.zoom != null ? parseFloat(slide.dataset.zoom) : 1;
      if (reduced || instant) Scene3D.setProgress(p, z);
      else Scene3D.flyTo(p, parseFloat(slide.dataset.dur || 2.4), z);
    }
    /* tell scene3d which marker to track (null = none) */
    if (slide.dataset.marker != null) {
      Scene3D.setMarkerTarget(parseFloat(slide.dataset.fly) || 0);
    } else {
      Scene3D.setMarkerTarget(null);
    }
  }

  function show(i, instant) {
    if (i < 0 || i >= slides.length || (i === cur && !instant)) return;
    const out = slides[cur], inn = slides[i];
    cur = i;

    document.getElementById('siteHeader').classList.toggle('is-inverted', inn.dataset.theme === 'dark');
    /* On an open step-content slide, strip the UI down to just the Next +
       Fullscreen buttons (see body.content-open in main.css). Restored on
       any scene/marker slide. */
    document.body.classList.toggle('content-open', inn.dataset.theme === 'surface');
    document.body.classList.toggle('qa-open', inn.id === 's-qa');

    /* Hide 3D scene behind the overview slide — the journey starts after it */
    const sceneEl = document.getElementById('scene');
    const topicMarkersEl = document.getElementById('topicMarkers');
    if (sceneEl) sceneEl.style.opacity = (inn.id === 's-overview') ? '0' : '';
    if (topicMarkersEl) topicMarkersEl.style.opacity = (inn.id === 's-overview') ? '0' : '';

    document.getElementById('deckCounter').textContent =
      String(i + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
    document.getElementById('deckBar').style.width = ((i + 1) / slides.length * 100) + '%';

    /* marker visibility */
    clearMarkerReveal();
    const outMarker = out.dataset.marker;
    const innMarker = inn.dataset.marker;
    const isShrinkTransition = (out.dataset.theme === 'surface' && inn.dataset.theme === 'scene' && inn.dataset.marker);
    if (outMarker || !innMarker || (innMarker && !isShrinkTransition)) hideMarker();

    /* special transitions */
    const outIsScene = out.dataset.theme === 'scene';
    const innIsScene = inn.dataset.theme === 'scene';
    const outIsSurface = out.dataset.theme === 'surface';
    const innIsSurface = inn.dataset.theme === 'surface';
    const outHasMarker = !!out.dataset.marker;
    const innHasMarker = !!inn.dataset.marker;

    /* scene → surface (expand from marker) */
    if (outIsScene && innIsSurface && outHasMarker) {
      applyScene(inn, instant);
      const markerPos = Scene3D.getScreenPosition(parseFloat(out.dataset.fly) || 0);
      if (!reduced && !instant && markerPos && window.gsap) {
        /* position the incoming surface at the marker location */
        gsap.set(inn, { zIndex: 10, autoAlpha: 1 });
        inn.classList.add('is-active', 'slide-morphing');
        gsap.fromTo(inn,
          { top: markerPos.y - 60, left: markerPos.x - 120, width: 240, height: 120, borderRadius: 20, autoAlpha: 0 },
          { top: 0, left: 0, width: '100vw', height: '100vh', borderRadius: 0, autoAlpha: 1, duration: 0.6, ease: 'power2.inOut',
            onComplete() { inn.classList.remove('slide-morphing'); inn.style.width = ''; inn.style.height = ''; inn.style.top = ''; inn.style.left = ''; inn.style.borderRadius = ''; } }
        );
        /* reveal inner content */
        const els = inn.querySelectorAll('[data-reveal]');
        if (els.length) gsap.fromTo(els, { autoAlpha: 0, y: 14 },
          { autoAlpha: 1, y: 0, duration: .5, ease: 'power3.out', stagger: .06, delay: .35 });
        out.classList.remove('is-active');
        busy = true; setTimeout(() => busy = false, 900);
        return;
      }
    }

    /* surface → scene (shrink to marker) */
    if (outIsSurface && innIsScene && innHasMarker) {
      applyScene(inn, true); /* instant scene placement */
      const markerPos = Scene3D.getScreenPosition(parseFloat(inn.dataset.fly) || 0);
      if (!reduced && !instant && markerPos && window.gsap) {
        gsap.to(out, {
          top: markerPos.y - 60, left: markerPos.x - 120, width: 240, height: 120, borderRadius: 20, autoAlpha: 0,
          duration: 0.55, ease: 'power2.inOut',
          onComplete() {
            out.classList.remove('is-active');
            out.style.width = ''; out.style.height = ''; out.style.top = ''; out.style.left = ''; out.style.borderRadius = '';
            inn.classList.add('is-active');
            revealMarker(inn);
          }
        });
        busy = true; setTimeout(() => busy = false, 900);
        return;
      }
    }

    applyScene(inn, instant);
    if (innMarker && !isShrinkTransition) scheduleMarkerReveal(inn, instant);

    if (reduced || instant) {
      slides.forEach((s, k) => s.classList.toggle('is-active', k === i));
      return;
    }
    busy = true;
    const sceneMarkerWait = (innIsScene && innHasMarker)
      ? sceneDuration(inn) * 1000 + 250
      : 750;
    setTimeout(() => busy = false, Math.max(750, sceneMarkerWait));

    gsap.killTweensOf([out, inn]);
    slides.forEach(s => {
      if (s !== out && s !== inn && s.classList.contains('is-active')) {
        gsap.killTweensOf(s);
        s.classList.remove('is-active');
        gsap.set(s, { clearProps: 'all' });
      }
    });
    gsap.set(out, { clearProps: 'opacity,visibility,zIndex' });

    const inOpaque = inn.dataset.theme !== 'scene';
    const outOpaque = out.dataset.theme !== 'scene';
    const drop = () => { out.classList.remove('is-active'); gsap.set(out, { clearProps: 'all' }); };
    inn.classList.add('is-active');

    if (inOpaque) {
      gsap.set(inn, { zIndex: 3 });
      gsap.fromTo(inn, { autoAlpha: 0 },
        { autoAlpha: 1, duration: .5, ease: 'power2.out',
          onComplete() { drop(); gsap.set(inn, { clearProps: 'zIndex' }); } });
    } else if (outOpaque) {
      gsap.set(inn, { autoAlpha: 1 });
      gsap.to(out, { autoAlpha: 0, duration: .6, ease: 'power2.inOut', onComplete: drop });
    } else {
      gsap.to(out, { autoAlpha: 0, duration: .3, ease: 'power2.in', onComplete: drop });
      gsap.fromTo(inn, { autoAlpha: 0 }, { autoAlpha: 1, duration: .45, ease: 'power2.out', delay: .12 });
    }

    const els = inn.querySelectorAll('[data-reveal]');
    if (els.length) gsap.fromTo(els, { autoAlpha: 0, y: 22 },
      { autoAlpha: 1, y: 0, duration: .7, ease: 'power3.out', stagger: .07, delay: .25 });
  }

  function nextIndex(d) {
    let next = cur + d;
    if (d > 0 && next >= slides.length) return 0;
    const currentSlide = slides[cur];
    const nextSlide = slides[next];
    if (d > 0 && currentSlide && nextSlide &&
        /^s-flight\d+$/.test(currentSlide.id) && /^s-stop\d+$/.test(nextSlide.id)) {
      next += d;
    }
    /* going backward from a content slide: skip the empty stop marker
       so the panel shrinks and the redline retreats in fewer clicks. */
    if (d < 0 && currentSlide && nextSlide &&
        /^s-content\d+$/.test(currentSlide.id) && /^s-stop\d+$/.test(nextSlide.id)) {
      next += d;
    }
    return next;
  }

  function step(d) { if (!busy) show(nextIndex(d)); }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  window.Deck = {
    init(opts) {
      reduced = !!(opts && opts.reducedMotion);
      slides = gsap.utils.toArray('.slide');
      slides.forEach((s, k) => s.classList.toggle('is-active', k === 0));
      document.getElementById('deckCounter').textContent =
        '01 / ' + String(slides.length).padStart(2, '0');
      document.getElementById('deckBar').style.width = (1 / slides.length * 100) + '%';

      addEventListener('keydown', e => {
        if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); step(1); }
        else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); step(-1); }
        else if (e.key === 'Home') show(0);
        else if (e.key === 'End') show(slides.length - 1);
        else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      });

      document.getElementById('deckPrev').addEventListener('click', () => step(-1));
      document.getElementById('deckNext').addEventListener('click', () => step(1));
      document.getElementById('deckFs').addEventListener('click', toggleFullscreen);

      /* --- jump-to-slide: click counter → type number → hit Enter --- */
      const counter = document.getElementById('deckCounter');
      const jumpInput = document.getElementById('deckJump');
      if (counter && jumpInput) {
        counter.addEventListener('click', () => {
          counter.style.display = 'none';
          jumpInput.classList.add('active');
          jumpInput.value = '';
          jumpInput.focus();
        });

        function closeJump(cancel) {
          jumpInput.classList.remove('active');
          counter.style.display = '';
          if (!cancel) counter.textContent = String(cur + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
        }

        jumpInput.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            const n = parseInt(jumpInput.value, 10);
            if (!isNaN(n) && n >= 1 && n <= slides.length) {
              show(n - 1);
              closeJump(false);
            } else {
              closeJump(true);
            }
          } else if (e.key === 'Escape') {
            closeJump(true);
          }
        });

        jumpInput.addEventListener('blur', () => closeJump(true));
      }

      let wheelLock = 0;
      addEventListener('wheel', e => {
        const now = Date.now();
        if (now - wheelLock < 900 || Math.abs(e.deltaY) < 24) return;

        /* On surface (content) slides, let the wheel scroll the content inside
           .slide-wrap instead of navigating to the next slide. */
        const current = slides[cur];
        if (current && current.dataset.theme === 'surface') {
          const wrap = current.querySelector('.slide-wrap');
          if (wrap && wrap.scrollHeight > wrap.clientHeight) {
            return; /* scroll naturally, don't jump slides */
          }
        }

        wheelLock = now;
        step(e.deltaY > 0 ? 1 : -1);
      }, { passive: true });

      let ty = null;
      addEventListener('touchstart', e => ty = e.touches[0].clientY, { passive: true });
      addEventListener('touchend', e => {
        if (ty === null) return;
        const dy = ty - e.changedTouches[0].clientY;
        if (Math.abs(dy) > 50) step(dy > 0 ? 1 : -1);
        ty = null;
      }, { passive: true });

      document.querySelectorAll('[data-goto]').forEach(a => {
        a.addEventListener('click', e => {
          e.preventDefault();
          const id = a.dataset.goto;
          const idx = slides.findIndex(s => s.id === id);
          if (idx >= 0) show(idx);
        });
      });

      applyScene(slides[0], true);
    },
    goTo(i) { show(i); }
  };
})();
