/* ============================================================
   Scene3D — full-viewport Three.js isometric miniature world,
   presentation edition.

   The world IS the project: a miniature virtualization
   infrastructure. A glowing red→indigo line (the backup) runs
   from a detailed hypervisor rack to a destination rack:
     zone 1 · the hypervisor — HP01/HP03 racks + VM cubes
     zone 2 · the archive   — tape library + strapped crates
     zone 3 · the transfer  — switch gate, router mast, fans
     zone 4 · the NAS       — drive-bay chassis + RAID towers

   Presentation API (driven by the Deck, not by scrolling):
     Scene3D.init(canvas, { static: bool })   -> bool
     Scene3D.flyTo(p, duration)               cinematic camera flight
     Scene3D.setCheckpoint(i)                 -1 none · 0..3 vignettes
     Scene3D.setActive(on)                    pause rendering behind
                                              opaque slides
     Scene3D.setProgress(p)                   instant jump (no tween)
   ============================================================ */
(function () {
  'use strict';

  const COL = {
    bg:      0xD0E1EB,   /* --bg-scene                        */
    ground:  0xD0E1EB,
    bodyA:   0xF3F7FA,   /* hardware tints, near-white        */
    bodyB:   0xE8EFF5,
    bodyC:   0xDDE7EF,
    dark:    0xC2D2DF,   /* darker volumes: slats, bays, ports*/
    led:     0x3932DC,   /* status LEDs — indigo accent       */
    head:    0xFF3A2F,   /* path head — red                   */
    tail:    0x3932DC    /* path tail — indigo (--accent-glow)*/
  };

  let renderer, scene, camera, sun;
  let pathCurve, pathUniforms, headGlow;
  const fans = [];                /* spinning cooling-fan rotors    */
  const leds = [];                /* blinking status LEDs           */
  const vms  = [];                /* bobbing VM cubes               */
  const vignettes = [];           /* per-checkpoint scene playlets  */
  const beacons = [];             /* journey stop beacons           */
  let activeVignette = -1;
  let markerTarget = null;        /* fly value for visible marker   */
  const cam = { p: 0, z: 1.6 };   /* journey position + zoom factor
                                     (1 = checkpoint close-up,
                                      1.6 = wide establishing shot) */
  let isStatic = false, running = false, renderActive = true;

  /* ----------------------------------------------------------
     primitive builders
     ---------------------------------------------------------- */
  function mat(color) {
    return new THREE.MeshStandardMaterial({ color, roughness: .85, metalness: 0 });
  }
  function box(w, h, d, x, z, color, ry, y) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, (y != null ? y : h / 2), z);
    if (ry) m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  /* blinking status LED (small emissive-looking dot) */
  function led(x, y, z, phase) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(.07, 8, 8),
      new THREE.MeshBasicMaterial({ color: COL.led, transparent: true })
    );
    m.position.set(x, y, z);
    scene.add(m);
    leds.push({ m, phase: phase || Math.random() * 6 });
    return m;
  }

  /* ---------- hardware builders ---------- */

  /* ============================================================
     HERO SERVER RACK — the detailed cabinet that anchors the two
     ends of the backup line (the hypervisor, and the destination).
     Plinth, frame posts, stacked rack units with drive bays /
     vent grilles / switch ports, per-unit status LEDs, cable
     bundle, top cap with fan grilles. Front faces +z.
     ============================================================ */
  function heroRack(x, z, opts) {
    opts = opts || {};
    const h = opts.h || 8, W = 3, D = 3;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = opts.ry || 0;
    scene.add(g);
    const add = m => { m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    const M = (w, hh, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat(c));

    /* plinth + body shell */
    const plinth = add(M(W + .3, .35, D + .3, COL.dark));
    plinth.position.y = .175;
    const shell = add(M(W, h, D, COL.bodyB));
    shell.position.y = .35 + h / 2;

    /* four corner posts */
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(s => {
      const p = add(M(.22, h + .15, .22, COL.dark));
      p.position.set(s[0] * (W / 2 - .11), .35 + (h + .15) / 2, s[1] * (D / 2 - .11));
    });

    /* top cap with two fan grilles */
    const cap = add(M(W + .2, .22, D + .2, COL.bodyA));
    cap.position.y = .35 + h + .11;
    [[-.7, -.55], [.7, .35]].forEach(f => {
      const grille = add(new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .1, 16), mat(COL.dark)));
      grille.position.set(f[0], .35 + h + .27, f[1]);
      const hub = add(new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, .12, 10), mat(COL.bodyC)));
      hub.position.set(f[0], .35 + h + .29, f[1]);
    });

    /* side vent strips (+x face) */
    for (let v = 0; v < 3; v++) {
      const strip = add(M(.06, h * .42, .4, COL.dark));
      strip.position.set(W / 2 + .03, .35 + h * .42, -.7 + v * .7);
    }

    /* stacked rack units on the front (+z) face */
    const unitH = .62, gap = .14;
    const n = Math.floor((h - .6) / (unitH + gap));
    for (let i = 0; i < n; i++) {
      const y = .35 + .42 + i * (unitH + gap) + unitH / 2;
      const tint = [COL.bodyA, COL.bodyC, COL.bodyA, COL.bodyB][i % 4];
      const unit = add(M(W - .55, unitH, .18, tint));
      unit.position.set(0, y, D / 2 + .03);

      if (i % 3 === 0) {
        /* storage unit: five drive bays */
        for (let b = 0; b < 5; b++) {
          const bay = add(M(.3, .34, .07, COL.dark));
          bay.position.set(-.95 + b * .48, y - .04, D / 2 + .14);
        }
      } else if (i % 3 === 1) {
        /* compute unit: horizontal vent grille */
        for (let v = 0; v < 3; v++) {
          const slat = add(M(W - 1.1, .055, .06, COL.dark));
          slat.position.set(-.12, y - .17 + v * .17, D / 2 + .14);
        }
      } else {
        /* network unit: a row of ports */
        for (let p2 = 0; p2 < 6; p2++) {
          const port = add(M(.15, .15, .06, COL.dark));
          port.position.set(-.88 + p2 * .3, y - .02, D / 2 + .14);
        }
      }
      /* per-unit status LED */
      const lm = new THREE.Mesh(
        new THREE.SphereGeometry(.06, 8, 8),
        new THREE.MeshBasicMaterial({ color: COL.led, transparent: true })
      );
      lm.position.set(W / 2 - .42, y + .14, D / 2 + .16);
      g.add(lm);
      leds.push({ m: lm, phase: i * 1.3 + x });
    }

    /* cable bundle running down the front-left edge */
    for (let cb = 0; cb < 3; cb++) {
      const cable = add(new THREE.Mesh(
        new THREE.CylinderGeometry(.045, .045, h - .4, 6), mat(COL.dark)));
      cable.position.set(-(W / 2) + .16 + cb * .12, .35 + (h - .4) / 2, D / 2 + .1);
    }
    return g;
  }

  /* filler server rack: tall cabinet + rack-unit slats + front LEDs */
  function rack(x, z, h) {
    box(2.4, h, 2.4, x, z, COL.bodyA);
    for (let yy = .9; yy < h - .3; yy += .9) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(2.5, .1, 2.5), mat(COL.dark));
      s.position.set(x, yy, z);
      scene.add(s);
    }
    led(x + 1.28, h - .55, z + .6, x);
    led(x + 1.28, h - .95, z + .2, x + 2);
  }

  /* VM cube: small white die that gently bobs beside its host */
  function vmCube(x, z, s, phase) {
    const m = box(s, s, s, x, z, COL.bodyB, .25, .55 + s / 2);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(s * 1.04, s * .14, s * 1.04), mat(COL.dark));
    edge.position.set(x, .55 + s * .5, z);
    edge.rotation.y = .25;
    scene.add(edge);
    vms.push({ g: [m, edge], baseY: [m.position.y, edge.position.y], phase: phase || 0 });
  }

  /* NAS chassis: wide unit with drive bays + LED row.
     `sink` lowers the whole unit into the ground (its hidden lower part is
     clipped by the floor) so it reads shorter without losing its detail. */
  function nasUnit(x, z, w, h, d, sink) {
    sink = sink || 0;
    box(w, h, d, x, z, COL.bodyA, 0, h / 2 - sink);
    const bays = 6, bw = (w - 1.6) / bays;
    for (let i = 0; i < bays; i++) {
      const bay = new THREE.Mesh(new THREE.BoxGeometry(bw * .72, h * .42, .22), mat(COL.dark));
      bay.position.set(x - w / 2 + .9 + i * bw + bw / 2, h * .42 - sink, z + d / 2 + .08);
      scene.add(bay);
      if (i % 2 === 0) led(x - w / 2 + .9 + i * bw + bw / 2, h * .78 - sink, z + d / 2 + .12, i);
    }
  }

  /* network switch tower: cabinet + port grid */
  function switchTower(x, z, h) {
    box(1.5, h, 1.5, x, z, COL.bodyA);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(.16, .16, .06), mat(COL.dark));
      p.position.set(x - .45 + c * .3, h - .7 - r * .42, z + .78);
      scene.add(p);
    }
    led(x + .55, h - .35, z + .78, x);
  }

  /* archive box: crate with two darker straps = the .vma archive */
  function archiveBox(x, z, s, ry) {
    box(s, s, s, x, z, COL.bodyB, ry);
    [.32, .68].forEach(f => {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(s * 1.04, s * .12, s * 1.04), mat(COL.dark));
      strap.position.set(x, s * f, z);
      strap.rotation.y = ry || 0;
      scene.add(strap);
    });
  }
  function archiveYard(x, z, n) {
    for (let i = 0; i < n; i++) {
      const s = .75 + (i % 3) * .2;
      archiveBox(x + (i % 3) * 1.25 - 1.2, z + Math.floor(i / 3) * 1.3, s, (i * .4) % .8);
    }
  }

  /* tape library: long unit with cartridge slots */
  function tapeLibrary(x, z, w, h, d, ry) {
    box(w, h, d, x, z, COL.bodyA, ry);
    for (let i = 0; i < 7; i++) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(.6, h * .5, .18), mat(i % 2 ? COL.dark : COL.bodyC));
      const t = -w / 2 + .9 + i * ((w - 1.8) / 6);
      slot.position.set(
        x + Math.cos(ry || 0) * t,
        h * .5,
        z - Math.sin(ry || 0) * t + Math.cos(ry || 0) * (d / 2 + .07)
      );
      slot.rotation.y = ry || 0;
      scene.add(slot);
    }
    led(x + w / 2 - .4, h - .25, z + d / 2 + .1, x);
  }

  /* RAID platter tower: stacked disk platters */
  function diskTower(x, z, n, s) {
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(.62 * s, .62 * s, .16 * s, 18), mat(i % 2 ? COL.bodyB : COL.bodyA));
      p.position.set(x, .1 + i * .26 * s, z);
      p.castShadow = p.receiveShadow = true;
      scene.add(p);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.3 * s, .3 * s, .1 * s, 14), mat(COL.dark));
    cap.position.set(x, .1 + n * .26 * s, z);
    scene.add(cap);
  }

  /* cooling fan unit: housing + spinning rotor */
  function fanUnit(x, z) {
    box(2, 2.2, .8, x, z, COL.bodyA, Math.PI / 4);
    const dir = Math.PI / 4;
    const fx = x + Math.sin(dir) * .45, fz = z + Math.cos(dir) * .45;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.72, .09, 8, 24), mat(COL.dark));
    ring.position.set(fx, 1.18, fz);
    ring.rotation.y = dir;
    scene.add(ring);
    const rotor = new THREE.Group();
    rotor.position.set(fx, 1.18, fz);
    rotor.rotation.y = dir;
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(.16, 1.16, .05), mat(COL.bodyC));
      const arm = new THREE.Group();
      arm.rotation.z = i * Math.PI * 2 / 3;
      blade.position.y = .35;
      arm.add(blade);
      rotor.add(arm);
    }
    scene.add(rotor);
    fans.push(rotor);
  }

  /* router mast: flat unit + antenna pole + signal rings */
  function routerMast(x, z) {
    box(3.2, 1.1, 2.2, x, z, COL.bodyA, .12);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, 3.4, 8), mat(COL.bodyA));
    pole.position.set(x, 1.1 + 1.7, z);
    pole.castShadow = true;
    scene.add(pole);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(.16, 10, 10), mat(COL.dark));
    tip.position.set(x, 4.7, z);
    scene.add(tip);
    [.55, .95].forEach((r, i) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, .035, 6, 26),
        new THREE.MeshBasicMaterial({ color: COL.led, transparent: true, opacity: .35 - i * .12 })
      );
      ring.position.set(x, 4.7, z);
      ring.rotation.x = Math.PI / 2;
      scene.add(ring);
    });
    led(x, 1.18, z + 1.18, x);
  }

  /* UPS / PDU filler box */
  function upsBox(x, z, w, h, d, ry) {
    box(w, h, d, x, z, COL.bodyC, ry);
    led(x + w / 2 * .6, h + .12, z + d / 2 * .6, x + z);
  }

  /* tiny sysadmin figure */
  function person(x, z) {
    const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(.09, .11, .42, 8), mat(COL.dark));
    bodyM.position.set(x, .21, z);
    bodyM.castShadow = true;
    scene.add(bodyM);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.1, 8, 8), mat(COL.bodyA));
    head.position.set(x, .5, z);
    scene.add(head);
  }

  /* ----------------------------------------------------------
     the glowing energy path (the backup itself)
     ---------------------------------------------------------- */
  function buildPath() {
    /* born inside a server unit of the start rack, drops to the
       floor, crosses the world, rises into the destination rack */
    pathCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-7.75, 2.1, 2.55),   /* out of HP01's front unit */
      new THREE.Vector3(-7.6,  .22, 3.4),    /* cable drop to the floor  */
      new THREE.Vector3( 0,  .22, -2),
      new THREE.Vector3( 9,  .22,  4),
      new THREE.Vector3(19,  .22, -3),
      new THREE.Vector3(28,  .22,  3),
      new THREE.Vector3(38,  .22, -2),
      new THREE.Vector3(47,  .22,  4),
      new THREE.Vector3(55,  .5,  1.5),     /* stay on the camera (+z) side */
      new THREE.Vector3(62.5, .4,  4.6),    /* floor, in FRONT of the dest rack */
      new THREE.Vector3(66.6, 2.5, 3.6)     /* rise UP into the rack's front server unit */
    ]);
    pathUniforms = {
      uProgress: { value: 0 },
      uTime:     { value: 0 },
      uHead:     { value: new THREE.Color(COL.head) },
      uTail:     { value: new THREE.Color(COL.tail) }
    };
    const vert = `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
    const frag = `
      uniform float uProgress; uniform float uTime;
      uniform vec3 uHead; uniform vec3 uTail;
      varying vec2 vUv;
      void main(){
        /* reveal: visible behind the head only */
        float a = 1.0 - smoothstep(uProgress - 0.012, uProgress + 0.004, vUv.x);
        if (a < 0.01) discard;
        /* gradient slides forward: red at the head, indigo behind */
        vec3 col = mix(uTail, uHead, smoothstep(uProgress - 0.38, uProgress, vUv.x));
        /* traveling pulse */
        float pulse = 0.80 + 0.30 * sin(vUv.x * 110.0 - uTime * 5.0);
        gl_FragColor = vec4(col * pulse, a);
      }`;
    /* The backup line is OCCLUDED by the 3D hardware (depthTest:true): it
       hides where it passes behind a rack/box, like a real conduit. (It
       used to force-draw on top — depthTest:false — which is why it showed
       through objects. depthWrite stays false so the transparent glow still
       blends correctly.) */
    const core = new THREE.Mesh(
      new THREE.TubeGeometry(pathCurve, 320, .14, 10),
      new THREE.ShaderMaterial({ uniforms: pathUniforms, vertexShader: vert,
        fragmentShader: frag, transparent: true, depthWrite: false, depthTest: true })
    );
    core.renderOrder = 1;
    scene.add(core);
    const halo = new THREE.Mesh(
      new THREE.TubeGeometry(pathCurve, 320, .42, 10),
      new THREE.ShaderMaterial({ uniforms: pathUniforms, vertexShader: vert,
        fragmentShader: frag.replace('vec4(col * pulse, a)', 'vec4(col * pulse, a * 0.16)'),
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending })
    );
    halo.renderOrder = 0;
    scene.add(halo);
    headGlow = new THREE.Mesh(
      new THREE.SphereGeometry(.3, 16, 16),
      new THREE.MeshBasicMaterial({ color: COL.head, transparent: true, opacity: .95, depthTest: true })
    );
    headGlow.renderOrder = 2;
    scene.add(headGlow);
  }

  /* ----------------------------------------------------------
     world layout — four infrastructure zones along the path
     ---------------------------------------------------------- */
  function buildWorld() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 300), mat(COL.ground));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    /* zone 1 · the hypervisor — the hero rack is the block the
       backup line starts from */
    heroRack(-8, 1.1, { h: 8, ry: .18 });   /* HP01 — the hypervisor   */
    rack(-11.4, .9, 5.6);              /* row neighbour of the hero    */
    rack(-5, -4, 6.5);                 /* HP03 + filler cabinets       */
    rack(-2, -6.5, 5.2);
    rack(-8.5, -6, 4.2);
    vmCube(-5.5, 2.6, .75, 1.2);       /* the VMs living on the cluster */
    vmCube(-3.2, -1.2, .9, 0);
    vmCube(-1.6, -.4, .7, 2.1);
    vmCube(-4.6, -.2, .6, 4.2);
    upsBox(-8, 6, 3.4, 1.3, 2.4, .1);
    diskTower(2, 7, 5, 1);
    fanUnit(-10, -10); fanUnit(-6.5, -12);
    person(-3.4, -2.4); person(-.8, 5.6);

    /* zone 2 · the archive — vzdump output */
    archiveYard(18, -7, 6);
    archiveYard(24, 6, 5);
    tapeLibrary(21, 9.5, 8, 2.4, 3, -.08);
    diskTower(14.5, 6, 4, .9);
    upsBox(27.5, -6, 2.4, 1.1, 2, .3);
    archiveBox(26, 0, 1.15, .3);       /* landing crate for vignette 02 */
    person(19.4, -4.6);

    /* zone 3 · the transfer gate — NFS to the NAS */
    switchTower(38, -5.4, 5.4);
    switchTower(38,  2.2, 5.4);
    const tray = box(1.1, .5, 8.6, 38, -1.6, COL.bodyA);
    tray.position.y = 5.1;
    fanUnit(33, 9); fanUnit(36.5, 11.5); fanUnit(40, 9.4);
    routerMast(45, -9);
    person(38.6, -.4);

    /* zone 4 · the NAS district — the destination rack the line
       arrives at (nudged +x so it frames stop 5 instead of looming
       directly over the marker) */
    heroRack(67, 2, { h: 8, ry: -.15 });
    rack(60.9, -4, 5);
    nasUnit(57, 9, 11, 3.4, 5.5, 1.0);   /* moved back + sunk so the stop4→5 redline clears it */
    rack(61, -7, 4.4);
    diskTower(52, -6, 6, 1.1);
    diskTower(54.5, -7.5, 4, .9);
    archiveBox(70, 4.4, 1.4, .2);      /* the config tar crate (clear of the moved rack) */
    fanUnit(69, -8);
    upsBox(50, 9.5, 3, 1.2, 2.2, -.2);
    person(56.2, 3); person(58.8, 2.4);

    /* loose scatter for depth */
    upsBox(12, -12, 4, 1.2, 3, .2);
    diskTower(30, -13, 3, 1);
    upsBox(48, 12, 3.4, 1.5, 3, -.15);
  }

  /* ----------------------------------------------------------
     JOURNEY STOP BEACONS — 3D objects at each presentation stop
     ---------------------------------------------------------- */
  function buildStopBeacons() {
    const stopConfigs = [
      { t: 0.18, type: 'vm' },        /* stop 1: forward a touch so the panel clears the start rack */
      { t: 0.35, type: 'layers' },
      { t: 0.54, type: 'vs' },        /* stop 3: earlier, clear of the switch-gate bridge */
      { t: 0.74, type: 'console' },   /* stop 4: clear of the NAS block */
      { t: 1.00, type: 'flag' }       /* stop 5: final rack entry, like the line start */
    ];

    stopConfigs.forEach(cfg => {
      const pos = pathCurve.getPointAt(cfg.t);
      const g = new THREE.Group();
      g.position.set(pos.x, 0, pos.z);
      scene.add(g);

      /* glowing vertical pole */
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(.04, .04, 1.5, 8),
        new THREE.MeshBasicMaterial({ color: COL.led, transparent: true, opacity: .6 })
      );
      pole.position.y = 0.75;
      g.add(pole);

      /* rotating ring at top */
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(.3, .03, 8, 24),
        new THREE.MeshBasicMaterial({ color: COL.led, transparent: true, opacity: .55 })
      );
      ring.position.y = 1.55;
      ring.rotation.x = Math.PI / 2;
      g.add(ring);

      /* glow sphere around ring */
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(.42, 16, 16),
        new THREE.MeshBasicMaterial({ color: COL.led, transparent: true, opacity: .12 })
      );
      glow.position.y = 1.55;
      g.add(glow);

      /* thematic icon at top */
      if (cfg.type === 'vm') {
        const cube = new THREE.Mesh(new THREE.BoxGeometry(.3, .3, .3), mat(COL.bodyA));
        cube.position.y = 1.95;
        g.add(cube);
      } else if (cfg.type === 'layers') {
        [0, .16].forEach((yOff, i) => {
          const layer = new THREE.Mesh(
            new THREE.BoxGeometry(.45, .06, .45),
            mat([COL.bodyA, COL.bodyC][i])
          );
          layer.position.y = 1.85 + yOff;
          g.add(layer);
        });
      } else if (cfg.type === 'vs') {
        const c1 = new THREE.Mesh(new THREE.BoxGeometry(.18, .18, .18), mat(COL.led));
        c1.position.set(-.12, 1.9, 0);
        g.add(c1);
        const c2 = new THREE.Mesh(new THREE.BoxGeometry(.18, .18, .18), mat(COL.head));
        c2.position.set(.12, 1.9, 0);
        g.add(c2);
      } else if (cfg.type === 'console') {
        const screen = new THREE.Mesh(new THREE.BoxGeometry(.35, .25, .05), mat(COL.dark));
        screen.position.y = 1.9;
        g.add(screen);
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(.28, .18),
          new THREE.MeshBasicMaterial({ color: COL.led })
        );
        face.position.set(0, 1.9, .03);
        g.add(face);
      } else if (cfg.type === 'flag') {
        const fp = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .35, 6), mat(COL.dark));
        fp.position.y = 2.05;
        g.add(fp);
        const flag = new THREE.Mesh(new THREE.BoxGeometry(.22, .14, .02), mat(COL.led));
        flag.position.set(.11, 2.15, 0);
        g.add(flag);
      }

      /* the beacon's ACTUAL top — highest point of all its meshes, measured
         at full scale BEFORE we shrink it for the reveal (group sits on the
         floor at y=0, so box max-Y is the world top the panel anchors to) */
      const topY = new THREE.Box3().setFromObject(g).max.y;

      /* start HIDDEN — a beacon only appears once the red line has
         arrived at its stop (see tickBeacons / snapBeacons). Render
         the marker over the hardware so it is visible at every stop,
         including stop 5 where the destination rack sat in front. */
      g.visible = false;
      g.scale.setScalar(0.0001);
      g.traverse(o => {
        if (o.isMesh && o.material) {
          o.material.transparent = true;
          o.material.depthTest = false;
          o.renderOrder = 20;
        }
      });
      beacons.push({ group: g, ring: ring, glow: glow, t: cfg.t, appear: 0, type: cfg.type, topY: topY });
    });
  }

  /* ---------- beacon reveal-on-arrival ----------
     appear (0..1) drives a scale-up + fade; the beacon's target is 1
     once the red line head (cam.p) has reached the beacon's stop. */
  function applyBeaconState(b, a) {
    b.appear = a;
    b.group.visible = a > 0.001;
    b.group.scale.setScalar(0.0001 + a);
  }
  function tickBeacons(dt, tm) {
    beacons.forEach((b, i) => {
      const aim = cam.p >= b.t - 0.002 ? 1 : 0;            /* line arrived? */
      applyBeaconState(b, b.appear + (aim - b.appear) * Math.min(1, dt * 6));
      if (b.appear > 0.01) {
        b.ring.rotation.z += dt * (0.6 + i * 0.15);
        b.glow.material.opacity = (0.08 + 0.06 * Math.sin(tm * 2.2 + i * 1.3)) * b.appear;
        b.glow.scale.setScalar(0.9 + 0.15 * Math.sin(tm * 1.8 + i));
      }
    });
  }
  function snapBeacons() {                                  /* static / instant jumps */
    beacons.forEach(b => applyBeaconState(b, cam.p >= b.t - 0.002 ? 1 : 0));
  }

  /* ----------------------------------------------------------
     CHECKPOINT VIGNETTES — each one acts out what the slide is
     talking about. A vignette = { group, update(tm) }; only the
     active checkpoint's group is visible.
     ---------------------------------------------------------- */
  function basic(color, opacity) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
  }

  function buildVignettes() {
    /* --- 01 · "It starts at the VM" — a ghost snapshot copy
           lifts out of a VM cube, with an expanding scan ring --- */
    (function () {
      const g = new THREE.Group(); scene.add(g);
      const ghost = new THREE.Mesh(new THREE.BoxGeometry(.95, .95, .95), basic(COL.led, .35));
      ghost.position.set(-3.2, 2.2, -1.2);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, .045, 8, 36), basic(COL.led, .5));
      ring.position.set(-3.2, .55, -1.2);
      ring.rotation.x = Math.PI / 2;
      g.add(ghost, ring);
      vignettes.push({
        group: g,
        update(tm) {
          ghost.rotation.y = tm * .9;
          ghost.position.y = 2.2 + Math.sin(tm * 1.6) * .18;
          const c = (tm % 2.2) / 2.2;              /* scan ring cycle */
          ring.scale.setScalar(.4 + c * 2.2);
          ring.material.opacity = .55 * (1 - c);
        }
      });
    })();

    /* --- 02 · "Packed into one archive" — a big ghost box
           compresses down into the strapped crate below --- */
    (function () {
      const g = new THREE.Group(); scene.add(g);
      const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), basic(COL.led, .35));
      g.add(ghost);
      const CX = 26, CZ = 0;                       /* over the landing crate */
      vignettes.push({
        group: g,
        update(tm) {
          const c = (tm % 2.6) / 2.6;              /* compression cycle */
          const s = 2.3 - 1.35 * Math.min(1, c * 1.25);
          ghost.scale.setScalar(s);
          ghost.position.set(CX, 3.1 - 1.55 * c, CZ);
          ghost.rotation.y = .3 + c * .5;
          ghost.material.opacity = c < .82 ? .34 : .34 * (1 - (c - .82) / .18);
        }
      });
    })();

    /* --- 03 · "Moved away from the host" — extra data packets
           stream along the line through the switch gate --- */
    (function () {
      const g = new THREE.Group(); scene.add(g);
      const packets = [];
      for (let k = 0; k < 3; k++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(.17, 10, 10), basic(COL.led, .85));
        g.add(p); packets.push(p);
      }
      vignettes.push({
        group: g,
        update(tm) {
          packets.forEach((p, k) => {
            const tt = (tm * .16 + k * .33) % 1;
            const pos = pathCurve.getPointAt(.47 + tt * .15);
            p.position.set(pos.x, pos.y + .05, pos.z);
            p.material.opacity = .9 * Math.sin(Math.PI * tt);
          });
        }
      });
    })();

    /* --- 04 · "The host needs a backup too" — config sheets arc
           from the destination rack into the tar crate --- */
    (function () {
      const g = new THREE.Group(); scene.add(g);
      const sheets = [];
      for (let k = 0; k < 3; k++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(.66, .06, .5), basic(COL.led, .8));
        g.add(s); sheets.push(s);
      }
      const A = new THREE.Vector3(66.8, 6.6, 3.0); /* moved rack upper unit */
      const B = new THREE.Vector3(70, 1.1, 4.4);   /* the tar crate         */
      vignettes.push({
        group: g,
        update(tm) {
          sheets.forEach((s, k) => {
            const tt = (tm * .3 + k * .33) % 1;
            s.position.lerpVectors(A, B, tt);
            s.position.y += Math.sin(tt * Math.PI) * 1.0;
            s.rotation.set(tt * 1.2, tt * 2.4, 0);
            s.material.opacity = .85 * Math.sin(Math.PI * Math.min(1, tt * 1.15));
          });
        }
      });
    })();

    vignettes.forEach(v => { v.group.visible = false; });
  }

  /* ----------------------------------------------------------
     camera — fixed isometric offset, target slides along path
     ---------------------------------------------------------- */
  const ISO_DIR = new THREE.Vector3(1, 1.05, 1).normalize();
  /* One rule for every step panel: project the beacon's ACTUAL top (its
     bounding-box max-Y, measured per stop in buildStopBeacons) to screen
     space, then sit the panel's BOTTOM edge a fixed gap above that point,
     centred horizontally on the beacon. Left/right are clamped to the
     viewport; the TOP is never clamped, so the panel always sits exactly
     above its beacon wherever that beacon projects. */
  const PANEL_GAP = 72;   /* px between the panel BOTTOM edge and the beacon top */

  /* world-Y of the top of the beacon standing at stop `t` */
  function beaconTopY(t) {
    const b = beacons.find(bc => Math.abs(bc.t - t) < 0.01);
    return b ? b.topY : 2.1;
  }

  function positionMarkerElement(marker, target) {
    if (!marker || !pathCurve || !camera) return;
    const t = Math.min(Math.max(target, 0), 1);
    const p = pathCurve.getPointAt(t);
    /* project the real top of THIS stop's beacon to screen space */
    const vec = new THREE.Vector3(p.x, beaconTopY(t), p.z).project(camera);
    if (vec.z >= 1) return;                       /* behind the camera */
    const sx = (vec.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-vec.y * 0.5 + 0.5) * window.innerHeight;
    const pad = 16;
    const mw = marker.offsetWidth || 360, mh = marker.offsetHeight || 90;
    /* centre horizontally on the beacon; clamp ONLY left/right to the viewport */
    let mLeft = sx - mw / 2;
    mLeft = Math.max(pad, Math.min(mLeft, window.innerWidth - mw - pad));
    /* panel BOTTOM sits PANEL_GAP px above the projected beacon top — no top clamp */
    const mTop = sy - mh - PANEL_GAP;
    marker.style.left = mLeft + 'px';
    marker.style.top  = mTop + 'px';
    /* connector line height = real gap from the panel bottom down to the beacon top */
    marker.style.setProperty('--connector', Math.max(0, Math.round(sy - (mTop + mh))) + 'px');
  }

  /* Lift the camera's look-target near stops 1 (t≈0.18) and 4 (t≈0.74),
     where the beacon stands by a tall rack. Raising the look point tilts
     the view up so the map sits lower on screen there, which drops the
     beacon — and the panel placed above it — clear of the fixed VIRCL
     header. Smoothly blended (cosine bump) so flights stay seamless, and
     zero at the other stops so they are unchanged. */
  function cameraLookLift(t) {
    const bump = c => { const d = Math.abs(t - c); return d < 0.10 ? Math.cos(d / 0.10 * Math.PI / 2) : 0; };
    return 2.0 * Math.max(bump(0.18), bump(0.74));
  }

  function placeCamera(p) {
    const t = Math.min(Math.max(p, 0), 1);
    const target = pathCurve.getPointAt(t);
    const dist = (30 - 7 * t) * cam.z;             /* zoom 1 = close, >1 = wide */
    camera.position.copy(target).addScaledVector(ISO_DIR, dist);
    const look = pathCurve.getPointAt(Math.min(1, t + .04));
    camera.lookAt(look.x, cameraLookLift(t), look.z);
    camera.updateMatrixWorld();
    sun.position.set(target.x + 14, 26, target.z + 8);
    sun.target.position.set(target.x, 0, target.z);
    sun.target.updateMatrixWorld();
    pathUniforms.uProgress.value = t;
    headGlow.position.copy(pathCurve.getPointAt(t));
    headGlow.visible = t > .002;
  }

  /* ----------------------------------------------------------
     render loop — fans spin, LEDs blink, VM cubes bob,
     the active vignette plays
     ---------------------------------------------------------- */
  const clock = (typeof THREE !== 'undefined') ? new THREE.Clock() : null;
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    if (document.hidden || !renderActive) return;
    const dt = clock.getDelta();
    const tm = clock.elapsedTime;
    pathUniforms.uTime.value = tm;
    fans.forEach((f, i) => {
      f.children.forEach(arm => { arm.rotation.z += dt * (2.2 + i * .3); });
    });
    leds.forEach(l => { l.m.material.opacity = .35 + .65 * (0.5 + 0.5 * Math.sin(tm * 2.6 + l.phase)); });
    vms.forEach(v => {
      const off = Math.sin(tm * 1.4 + v.phase) * .12;
      v.g.forEach((m, k) => { m.position.y = v.baseY[k] + off; });
    });
    if (activeVignette >= 0 && vignettes[activeVignette]) vignettes[activeVignette].update(tm);
    /* reveal each stop beacon only once the line has reached it */
    tickBeacons(dt, tm);
    placeCamera(cam.p);
    /* update marker DOM position — ONLY while the panel is actually
       shown. During a hide/show navigation it stays frozen so it fades
       and scales in place instead of sliding toward a clamped corner. */
    if (markerTarget != null) {
      const marker = document.getElementById('topicMarker');
      if (marker && pathCurve && marker.classList.contains('visible')) {
        positionMarkerElement(marker, markerTarget);
      }
    }
    renderer.render(scene, camera);
  }

  /* ----------------------------------------------------------
     public API
     ---------------------------------------------------------- */
  window.Scene3D = {
    init(canvas, opts) {
      opts = opts || {};
      isStatic = !!opts.static;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      } catch (e) { return false; }
      if (!renderer.getContext()) return false;

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setClearColor(COL.bg);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      scene = new THREE.Scene();
      scene.fog = new THREE.Fog(COL.bg, 48, 105);

      camera = new THREE.PerspectiveCamera(27, window.innerWidth / window.innerHeight, .1, 400);

      scene.add(new THREE.AmbientLight(0xffffff, 1.55));
      sun = new THREE.DirectionalLight(0xffffff, 2.0);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -34;  sun.shadow.camera.right = 34;
      sun.shadow.camera.top  =  34;  sun.shadow.camera.bottom = -34;
      sun.shadow.camera.far  = 90;
      sun.shadow.bias = -0.0004;
      scene.add(sun); scene.add(sun.target);

      buildWorld();
      buildPath();
      buildStopBeacons();
      buildVignettes();
      placeCamera(0);

      window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (isStatic) renderer.render(scene, camera);
      });

      if (isStatic) {
        placeCamera(opts.staticAt != null ? opts.staticAt : 0);
        renderer.render(scene, camera);
      } else {
        running = true;
        requestAnimationFrame(frame);
      }
      return true;
    },

    /* cinematic flight to a journey position (the "video" feel) */
    flyTo(p, duration, zoom) {
      if (isStatic || !window.gsap) { this.setProgress(p, zoom); return; }
      gsap.killTweensOf(cam);
      gsap.to(cam, { p, z: zoom == null ? 1 : zoom,
        duration: duration || 2.4, ease: 'power2.inOut' });
    },

    /* show the playlet for checkpoint i (-1 = none) */
    setCheckpoint(i) {
      activeVignette = i;
      vignettes.forEach((v, k) => {
        v.group.visible = k === i;
        if (k === i && isStatic) v.update(1.1);   /* frozen mid-pose */
      });
      if (isStatic && renderer) renderer.render(scene, camera);
    },

    /* pause rendering while an opaque slide covers the canvas */
    setActive(on) {
      renderActive = on;
      if (on && clock) clock.getDelta();          /* swallow paused time */
    },

    /* instant jump, no tween (reduced motion / mobile) */
    setProgress(p, zoom) {
      if (window.gsap) gsap.killTweensOf(cam);
      cam.p = p;
      if (zoom != null) cam.z = zoom;
      placeCamera(p);   // always place camera immediately
      snapBeacons();    // reveal/hide beacons to match the new position
      if (isStatic && renderer) renderer.render(scene, camera);
    },

    /* get screen position of a point on the path */
    getScreenPosition(p) {
      if (!camera || !pathCurve) return null;
      const t = Math.min(Math.max(p, 0), 1);
      const pos = pathCurve.getPointAt(t);
      pos.y += 2.5;
      const vec = pos.clone();
      vec.project(camera);
      return {
        x: (vec.x * 0.5 + 0.5) * window.innerWidth,
        y: (-vec.y * 0.5 + 0.5) * window.innerHeight
      };
    },

    /* set which marker is active for real-time tracking */
    setMarkerTarget(fly) {
      markerTarget = fly != null ? parseFloat(fly) : null;
    },

    /* place the marker immediately before reveal, avoiding a one-frame jump */
    positionMarker(fly) {
      markerTarget = fly != null ? parseFloat(fly) : null;
      const marker = document.getElementById('topicMarker');
      if (markerTarget != null) positionMarkerElement(marker, markerTarget);
    }
  };
})();
