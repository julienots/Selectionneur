/* =====================================================================================
   STADE 3D — moteur de rendu 3D du match en direct (v42)
   =====================================================================================
   Module autonome, chargé APRÈS three.min.js et AVANT le gros script du jeu (index.html).
   Il ne touche JAMAIS à la logique de match : il se contente de LIRE l'objet match `m`
   (m.pos.us / m.pos.them / m.pos.ball en pourcentages, m.us / m.them / m.minute, m.usOrder,
   m.opp, m.weather, m.ctx) à chaque image et d'en faire une mise en scène 3D réaliste.

   API publique (window.Stade3D) :
     Stade3D.supported()          -> bool (three.js chargé + WebGL disponible)
     Stade3D.mount(container, m)  -> insère le canvas 3D dans `container` (le #pitchWrap du jeu)
     Stade3D.onGoal(m, side, idx) -> déclenche la célébration (appelé par flashResult du jeu)
     Stade3D.onEvent(m, kind)     -> petits événements visuels ("post", "save", "foul", "whistle")
     Stade3D.isEnabled()/setEnabled(bool) -> préférence 3D/2D (localStorage "sel-view3d")

   Repère : terrain 105 x 68 m, axe X = longueur (x% du jeu), axe Z = largeur (y% du jeu),
   Y = hauteur. Nos joueurs attaquent vers +X (comme le moteur 2D : goalX = 95 pour "us").
   Un SEUL WebGLRenderer est créé pour toute la session (les navigateurs mobiles limitent le
   nombre de contextes WebGL) : à chaque reconstruction de l'écran live par render(), on
   déplace simplement le même canvas dans le nouveau #pitchWrap.
   ===================================================================================== */
(function(){
  "use strict";
  const T = window.THREE;
  const S = window.Stade3D = {};

  const L = 105, W = 68, HL = L/2, HW = W/2;
  const GOAL_W = 7.32, GOAL_H = 2.44, GOAL_D = 2.2;
  const PREF_KEY = "sel-view3d";

  // ---------------------------------------------------------------- utilitaires
  const clamp = (v,a,b)=> v<a?a:(v>b?b:v);
  const lerp = (a,b,t)=> a+(b-a)*t;
  const rnd = (a,b)=> a+Math.random()*(b-a);
  const damp = (k,dt)=> 1-Math.exp(-k*dt);
  function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  // `state` est un `let` global du script principal : accessible par son nom, pas via window.
  function gstate(){ try{ return (typeof state!=="undefined") ? state : null; }catch(e){ return null; } }
  function clubName(){ const st = gstate(); return (st && st.club && st.club.name) || "Club"; }
  const toX = x=> (x/100-0.5)*L;
  const toZ = y=> (y/100-0.5)*W;

  let webglOK = null;
  S.supported = function(){
    if(!T) return false;
    if(webglOK!==null) return webglOK;
    try{
      const c = document.createElement("canvas");
      webglOK = !!(c.getContext("webgl2") || c.getContext("webgl"));
    }catch(e){ webglOK = false; }
    return webglOK;
  };
  S.isEnabled = function(){
    try{ const v = localStorage.getItem(PREF_KEY); return v===null ? true : v==="1"; }catch(e){ return true; }
  };
  S.setEnabled = function(on){ try{ localStorage.setItem(PREF_KEY, on?"1":"0"); }catch(e){} };
  // v45 : préférences d'affichage (localStorage, hors sauvegarde de partie)
  function pref(k, d){ try{ const v = localStorage.getItem(k); return v===null ? d : v; }catch(e){ return d; } }
  function setPref(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
  S.QUALITIES = {eco:"Économie", normal:"Normale", ultra:"Ultra"};
  S.getQuality = ()=> { const q = pref("sel-q3d", "normal"); return S.QUALITIES[q] ? q : "normal"; };
  S.setQuality = (q)=>{ setPref("sel-q3d", q); applyQuality(); };
  S.getDefaultCam = ()=> pref("sel-cam", "TV");
  S.setDefaultCam = (c)=>{ setPref("sel-cam", c); const i = CAM_MODES.indexOf(c); if(i>=0) camMode = i; };
  S.tickerOn = ()=> pref("sel-ticker", "1") === "1";
  S.setTicker = (on)=> setPref("sel-ticker", on ? "1" : "0");

  // ---------------------------------------------------------------- maillots
  // Couleurs [maillot, short, chaussettes, numéro] ; "alt" = tenue extérieure si conflit.
  const KITS = {
    "France":["#1b2f6b","#f4f4f4","#c8102e","#ffffff"],
    "Norvège":["#c8102e","#f4f4f4","#1b2f6b","#ffffff"],
    "Portugal":["#a50f24","#0d5c2e","#a50f24","#e8c35a"],
    "Écosse":["#16224a","#f4f4f4","#16224a","#ffffff"],
    "Brésil":["#f7d417","#1b4fa0","#f4f4f4","#0d5c2e"],
    "Sénégal":["#f4f4f4","#f4f4f4","#f4f4f4","#0d7a3e"],
    "Japon":["#16285e","#f4f4f4","#16285e","#ffffff"],
    "Croatie":["#f4f4f4","#f4f4f4","#1b2f8a","#c8102e", "check"],
    "Maroc":["#b5121b","#0d6b3a","#b5121b","#ffffff"],
    "Argentine":["#8cc8ec","#16224a","#f4f4f4","#16224a","stripes"],
    "Allemagne":["#f4f4f4","#111111","#f4f4f4","#111111"],
    "Angleterre":["#f4f4f4","#16224a","#f4f4f4","#16224a"],
    "Espagne":["#c60b1e","#16224a","#16224a","#f4c400"],
    "Pays-Bas":["#f36c21","#f36c21","#f36c21","#16224a"],
    "Italie":["#1f5fbf","#f4f4f4","#1f5fbf","#ffffff"],
    "Belgique":["#c8102e","#c8102e","#c8102e","#f4c400"],
    "Uruguay":["#6fb7e8","#111111","#111111","#111111"],
    "Nigéria":["#0d8a4e","#0d8a4e","#0d8a4e","#ffffff"],
    "Ghana":["#f4f4f4","#f4f4f4","#f4f4f4","#111111"],
    "Corée du Sud":["#d2122e","#111111","#d2122e","#ffffff"],
    "États-Unis":["#f4f4f4","#16224a","#f4f4f4","#16224a"],
    "Mexique":["#0d6b3a","#f4f4f4","#c8102e","#ffffff"],
    "Suisse":["#d52b1e","#f4f4f4","#d52b1e","#ffffff"],
    "Pologne":["#f4f4f4","#dc143c","#f4f4f4","#dc143c"],
    "Danemark":["#c8102e","#f4f4f4","#c8102e","#ffffff"],
    "Serbie":["#c6363c","#0c4076","#f4f4f4","#ffffff"],
    "Colombie":["#fcd116","#16224a","#f4f4f4","#16224a"],
    "Équateur":["#ffdd00","#034ea2","#ffdd00","#034ea2"],
    "Canada":["#d52b1e","#d52b1e","#d52b1e","#ffffff"],
    "Australie":["#ffcd00","#00843d","#ffcd00","#00843d"],
    "Égypte":["#c8102e","#f4f4f4","#111111","#ffffff"],
  };
  const ALT_KIT = ["#f4f4f4","#f4f4f4","#f4f4f4","#16224a"];
  function colorDist(a,b){ const ca=new T.Color(a), cb=new T.Color(b); return Math.abs(ca.r-cb.r)+Math.abs(ca.g-cb.g)+Math.abs(ca.b-cb.b); }
  function kitFor(name, isClubHome){
    if(KITS[name]) return KITS[name];
    // Équipe inconnue (adversaires de club...) : tenue déterministe dérivée du nom.
    const h = hashStr(name||"?");
    const hue = (h%360)/360, sat = 0.55+((h>>>9)%30)/100, l = 0.32+((h>>>15)%25)/100;
    const shirt = "#"+new T.Color().setHSL(hue,sat,l).getHexString();
    const shorts = ((h>>>4)&1) ? "#f4f4f4" : "#151515";
    return [shirt, shorts, shirt, "#ffffff"];
  }
  function teamKits(m){
    const club = m.ctx==="club";
    let home = club ? clubKit() : KITS.France.slice();
    let away = kitFor(m.opp).slice();
    if(colorDist(home[0], away[0]) < 0.55) away = (colorDist(home[0], ALT_KIT[0])<0.55) ? ["#111111","#111111","#111111","#f4c400"] : ALT_KIT.slice();
    return {us:home, them:away};
  }
  function clubKit(){
    const name = clubName();
    const h = hashStr(name);
    const hue = (h%360)/360;
    return ["#"+new T.Color().setHSL(hue,0.65,0.38).getHexString(), "#f4f4f4", "#"+new T.Color().setHSL(hue,0.65,0.30).getHexString(), "#ffffff", ((h>>>3)%3===0)?"stripes":null];
  }

  // ---------------------------------------------------------------- textures procédurales
  function canvasTex(w,h,draw,opts){
    const c = document.createElement("canvas"); c.width=w; c.height=h;
    const g = c.getContext("2d"); draw(g,w,h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    if(opts && opts.repeat){ t.wrapS = t.wrapT = T.RepeatWrapping; }
    t.anisotropy = 8;
    t.userData.canvas = c; t.userData.ctx = g;
    return t;
  }

  // Pelouse : bandes de tonte, grain, usure dans les surfaces de but et lignes peintes.
  function makePitchTexture(){
    const MX = 7, MZ = 6;                          // marges herbe autour des lignes (m)
    const TW = L+2*MX, TH = W+2*MZ;
    const scale = 2048/TW;
    return {tex: canvasTex(2048, Math.round(TH*scale), (g,w,h)=>{
      const P = (m)=> m*scale;
      // base
      g.fillStyle = "#2f6b2a"; g.fillRect(0,0,w,h);
      // bandes de tonte (18 bandes sur la longueur, plus 2 sens de tonte)
      const nb = 18, bw = P(L)/nb;
      for(let i=-2;i<nb+2;i++){
        g.fillStyle = (i%2===0) ? "rgba(255,255,255,0.055)" : "rgba(0,0,0,0.075)";
        g.fillRect(P(MX)+i*bw, 0, bw, h);
      }
      // grain : milliers de touffes de couleurs légèrement différentes
      for(let i=0;i<70000;i++){
        const x=Math.random()*w, y=Math.random()*h, r=Math.random();
        g.fillStyle = r<0.5 ? `rgba(20,60,15,${0.12+Math.random()*0.12})` : `rgba(140,190,90,${0.05+Math.random()*0.08})`;
        g.fillRect(x,y,1+Math.random()*1.6,1+Math.random()*1.6);
      }
      // usure : zones plus pâles devant les buts et au rond central
      const wear = (cx,cy,rx,ry,a)=>{
        const gr = g.createRadialGradient(cx,cy,0,cx,cy,Math.max(rx,ry));
        gr.addColorStop(0,`rgba(150,140,80,${a})`); gr.addColorStop(1,"rgba(150,140,80,0)");
        g.save(); g.translate(cx,cy); g.scale(rx/Math.max(rx,ry), ry/Math.max(rx,ry)); g.translate(-cx,-cy);
        g.fillStyle=gr; g.beginPath(); g.arc(cx,cy,Math.max(rx,ry),0,Math.PI*2); g.fill(); g.restore();
      };
      wear(P(MX+3), P(MZ+W/2), P(5), P(6), 0.28);
      wear(P(MX+L-3), P(MZ+W/2), P(5), P(6), 0.28);
      wear(P(MX+L/2), P(MZ+W/2), P(7), P(7), 0.10);
      // lignes
      g.strokeStyle = "rgba(245,248,240,0.92)"; g.fillStyle = "rgba(245,248,240,0.92)";
      g.lineWidth = Math.max(2, P(0.12));
      const X = (m)=> P(MX+m), Z = (m)=> P(MZ+m);
      g.strokeRect(X(0),Z(0),P(L),P(W));
      g.beginPath(); g.moveTo(X(L/2),Z(0)); g.lineTo(X(L/2),Z(W)); g.stroke();
      g.beginPath(); g.arc(X(L/2),Z(W/2),P(9.15),0,Math.PI*2); g.stroke();
      const spot=(x,z,r)=>{ g.beginPath(); g.arc(X(x),Z(z),P(r),0,Math.PI*2); g.fill(); };
      spot(L/2,W/2,0.22);
      [[0,1],[L,-1]].forEach(([x0,d])=>{
        const pa = 40.32, ga = 18.32;
        g.strokeRect(Math.min(X(x0),X(x0+d*16.5)), Z(W/2-pa/2), P(16.5), P(pa));
        g.strokeRect(Math.min(X(x0),X(x0+d*5.5)), Z(W/2-ga/2), P(5.5), P(ga));
        spot(x0+d*11, W/2, 0.2);
        const a = Math.acos(5.5/9.15);
        g.beginPath();
        if(d>0) g.arc(X(x0+11),Z(W/2),P(9.15),-a,a); else g.arc(X(x0-11),Z(W/2),P(9.15),Math.PI-a,Math.PI+a);
        g.stroke();
      });
      [[0,0,0],[L,0,Math.PI/2],[L,W,Math.PI],[0,W,-Math.PI/2]].forEach(([x,z,s])=>{
        g.beginPath(); g.arc(X(x),Z(z),P(1),s,s+Math.PI/2); g.stroke();
      });
    }), TW, TH};
  }

  function makeAdTexture(teamA, teamB){
    return canvasTex(2048, 64, (g,w,h)=>{
      const ads = [
        ["#0b1a3a","#ffffff","SÉLECTIONNEUR"],["#d4af37","#1a1200","COUPE DU MONDE"],["#c8102e","#ffffff","ALLEZ "+teamA.toUpperCase()],
        ["#111","#7CFC00","FOOT LIVE 3D"],["#ffffff","#1b2f6b","BALLON D'OR"],["#1b4332","#f4f7f5","STADE 3D"],
        ["#f36c21","#111","SUPPORTERS "+teamB.toUpperCase()],["#16224a","#d4af37","FAIR-PLAY"],
      ];
      const segW = w/ads.length;
      ads.forEach(([bg,fg,txt],i)=>{
        g.fillStyle=bg; g.fillRect(i*segW,0,segW,h);
        g.fillStyle=fg; g.font="bold 38px 'Bebas Neue', 'Barlow Condensed', sans-serif"; g.textAlign="center"; g.textBaseline="middle";
        g.fillText(txt, i*segW+segW/2, h/2+2, segW-20);
        g.fillStyle="rgba(255,255,255,0.08)"; for(let y=0;y<h;y+=3) g.fillRect(i*segW,y,segW,1); // trame LED
      });
    }, {repeat:true});
  }

  function makeNetTexture(){
    return canvasTex(256,256,(g,w,h)=>{
      g.clearRect(0,0,w,h);
      g.strokeStyle="rgba(255,255,255,0.95)"; g.lineWidth=2.2;
      const n=12, s=w/n;
      for(let i=0;i<=n;i++){
        g.beginPath(); g.moveTo(i*s,0); g.lineTo(i*s,h); g.stroke();
        g.beginPath(); g.moveTo(0,i*s); g.lineTo(w,i*s); g.stroke();
      }
    }, {repeat:true});
  }

  function makeGlowTexture(){
    return canvasTex(128,128,(g,w,h)=>{
      const gr=g.createRadialGradient(64,64,0,64,64,64);
      gr.addColorStop(0,"rgba(255,255,245,1)"); gr.addColorStop(0.15,"rgba(255,250,220,0.85)");
      gr.addColorStop(0.45,"rgba(255,240,190,0.18)"); gr.addColorStop(1,"rgba(255,240,190,0)");
      g.fillStyle=gr; g.fillRect(0,0,w,h);
    });
  }

  function makeBlobTexture(){
    const t = canvasTex(64,64,(g,w,h)=>{
      const gr=g.createRadialGradient(32,32,0,32,32,32);
      gr.addColorStop(0,"rgba(0,0,0,0.85)"); gr.addColorStop(0.55,"rgba(0,0,0,0.35)"); gr.addColorStop(1,"rgba(0,0,0,0)");
      g.fillStyle=gr; g.fillRect(0,0,w,h);
    });
    t.colorSpace = T.NoColorSpace;
    return t;
  }

  // Atlas de silhouettes de spectateurs : canaux R = maillot, G = peau, B = cheveux/pantalon.
  // Le shader teinte chaque canal par instance -> des milliers de supporters tous différents.
  function makeCrowdAtlas(){
    const t = canvasTex(512,128,(g,w,h)=>{
      g.clearRect(0,0,w,h);
      const cw = 64;
      for(let row=0; row<2; row++){
        for(let v=0; v<8; v++){
          const ox = v*cw, oy=row*64, cx = ox+cw/2;
          const big = v%3===0, slim = v%3===1;
          const sw = big?44:(slim?34:39);
          // corps (maillot)
          g.fillStyle="rgb(255,0,0)";
          g.beginPath(); g.moveTo(cx-sw/2, oy+64); g.lineTo(cx-sw/2+3, oy+30); g.quadraticCurveTo(cx, oy+22, cx+sw/2-3, oy+30); g.lineTo(cx+sw/2, oy+64); g.fill();
          // bras levés (ligne 2) : célébration
          if(row===1){
            g.strokeStyle="rgb(255,0,0)"; g.lineWidth=7; g.lineCap="round";
            g.beginPath(); g.moveTo(cx-sw/2+5, oy+34); g.lineTo(cx-sw/2-4, oy+8); g.stroke();
            g.beginPath(); g.moveTo(cx+sw/2-5, oy+34); g.lineTo(cx+sw/2+4, oy+8); g.stroke();
            g.fillStyle="rgb(0,255,0)";
            g.beginPath(); g.arc(cx-sw/2-4, oy+7, 4, 0, Math.PI*2); g.fill();
            g.beginPath(); g.arc(cx+sw/2+4, oy+7, 4, 0, Math.PI*2); g.fill();
          }
          // cou + tête (peau)
          g.fillStyle="rgb(0,255,0)";
          g.fillRect(cx-4, oy+22, 8, 8);
          g.beginPath(); g.ellipse(cx, oy+15, 9, 11, 0, 0, Math.PI*2); g.fill();
          // cheveux / bonnet / casquette
          g.fillStyle="rgb(0,0,255)";
          if(v%4===0){ g.beginPath(); g.ellipse(cx, oy+9, 10, 7, 0, Math.PI, 0); g.fill(); g.fillRect(cx-10,oy+8,20,3); }
          else if(v%4===1){ g.beginPath(); g.ellipse(cx, oy+10, 9.5, 7.5, 0, Math.PI, 0); g.fill(); }
          else if(v%4===2){ g.beginPath(); g.ellipse(cx, oy+12, 10, 10, 0, Math.PI*1.05, -0.05); g.fill(); g.fillRect(cx-10,oy+12,4,12); g.fillRect(cx+6,oy+12,4,12); }
          // écharpe (ligne 1, une variante sur deux)
          if(row===0 && v%2===0){ g.fillStyle="rgb(255,0,255)"; g.fillRect(cx-sw/2+4, oy+29, sw-8, 5); }
        }
      }
    });
    t.colorSpace = T.NoColorSpace;
    t.anisotropy = 4;
    return t;
  }

  // Dos du maillot : NOM (vrai joueur) au-dessus du numéro, comme sur les vraies tenues
  function makeNumberTexture(num, fg, bg, name){
    return canvasTex(256,256,(g,w,h)=>{
      g.fillStyle=bg; g.fillRect(0,0,w,h);
      g.fillStyle=fg; g.textAlign="center"; g.textBaseline="middle";
      if(name){
        g.font="bold 40px 'Barlow Condensed', 'Bebas Neue', sans-serif";
        g.fillText(name.toUpperCase(), w/2, 38, w-16);
      }
      g.font="bold 168px 'Bebas Neue', 'Barlow Condensed', sans-serif";
      g.fillText(String(num), w/2, name ? 158 : 136);
    });
  }
  function backName(full){ const parts = String(full||"").trim().split(/\s+/); return parts.length>1 ? parts.slice(1).join(" ") : parts[0]||""; }

  function makeShirtTexture(kit){
    // Maillot avec motif (rayures / damier) + légère texture tissu
    return canvasTex(128,128,(g,w,h)=>{
      g.fillStyle=kit[0]; g.fillRect(0,0,w,h);
      if(kit[4]==="stripes"){ g.fillStyle="#f4f4f4"; for(let x=0;x<w;x+=32) g.fillRect(x+16,0,16,h); }
      if(kit[4]==="check"){ g.fillStyle="#c8102e"; for(let y=0;y<h;y+=16) for(let x=0;x<w;x+=16) if(((x+y)/16)%2===0) g.fillRect(x,y,16,16); }
      for(let y=0;y<h;y+=2){ g.fillStyle=`rgba(0,0,0,${y%4?0.035:0.06})`; g.fillRect(0,y,w,1); }
      g.fillStyle="rgba(255,255,255,0.12)"; g.fillRect(0,0,w,6);
    });
  }

  // ---------------------------------------------------------------- géométrie de l'enceinte
  // Rectangle arrondi échantillonné avec un nombre FIXE de points par segment, pour que tous
  // les rangs de tribune aient la même topologie (=> une seule grande géométrie par niveau).
  function roundedRectSamples(hx, hz, r, ns, nc){
    const pts = [];
    const corners = [[hx-r, hz-r, 0],[ -(hx-r), hz-r, Math.PI/2],[-(hx-r), -(hz-r), Math.PI],[hx-r, -(hz-r), Math.PI*1.5]];
    const straights = [
      [[hx, -(hz-r)],[hx, hz-r]], [[hx-r, hz],[-(hx-r), hz]], [[-hx, hz-r],[-hx, -(hz-r)]], [[-(hx-r), -hz],[hx-r, -hz]]
    ];
    for(let s=0;s<4;s++){
      const [a,b] = straights[s];
      const n = (s%2===0) ? ns[1] : ns[0];   // côtés courts (le long de Z) / côtés longs (le long de X)
      const nrm = [[1,0],[0,1],[-1,0],[0,-1]][s];
      for(let i=0;i<n;i++){ const t=i/n; pts.push({x:lerp(a[0],b[0],t), z:lerp(a[1],b[1],t), nx:nrm[0], nz:nrm[1]}); }
      const [cx,cz,a0] = corners[s];
      for(let i=0;i<nc;i++){ const a=a0+(i/nc)*Math.PI/2; pts.push({x:cx+Math.cos(a)*r, z:cz+Math.sin(a)*r, nx:Math.cos(a), nz:Math.sin(a)}); }
    }
    return pts;
  }

  // Surface "balayée" : pour chaque point de la courbe de base, un profil (d = recul, h = hauteur)
  function sweepGeometry(base, profile){
    const nP = profile.length, nB = base.length;
    const pos = new Float32Array(nB*nP*3), uv = new Float32Array(nB*nP*2);
    for(let i=0;i<nB;i++){
      const b = base[i];
      for(let j=0;j<nP;j++){
        const [d,h] = profile[j];
        const k = (i*nP+j);
        pos[k*3] = b.x + b.nx*d; pos[k*3+1] = h; pos[k*3+2] = b.z + b.nz*d;
        uv[k*2] = i/nB*40; uv[k*2+1] = j/nP;
      }
    }
    const idx = [];
    for(let i=0;i<nB;i++){
      const i2 = (i+1)%nB;
      for(let j=0;j<nP-1;j++){
        if(profile[j+1][2]==="gap") continue;
        const a=i*nP+j, b=i2*nP+j, c=i2*nP+j+1, d=i*nP+j+1;
        idx.push(a,d,b, b,d,c);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(pos,3));
    g.setAttribute("uv", new T.BufferAttribute(uv,2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---------------------------------------------------------------- scène
  let renderer=null, scene=null, camera=null, clock=null;
  let world = null;     // objets persistants (stade)
  let teams = null;     // joueurs du match courant
  let cur = null;       // {m, container, hud...}
  let rafId = 0, running = false;
  let camMode = 0;
  const CAM_MODES = ["TV", "Proche", "Tactique", "Tribune", "Drone"];
  let fsOn = false;

  function applyQuality(){
    if(!renderer) return;
    const q = S.getQuality(), lowEnd = (navigator.hardwareConcurrency||4) <= 4;
    const pr = q==="eco" ? 1 : q==="ultra" ? 2 : (lowEnd ? 1.25 : 1.75);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, pr));
    const shadows = q !== "eco";
    if(renderer.shadowMap.enabled !== shadows){
      renderer.shadowMap.enabled = shadows;
      scene.traverse(o=>{ if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(mm=> mm.needsUpdate = true); } });
    }
    if(world && world.key){ const sz = q==="ultra" ? 4096 : 2048; if(world.key.shadow.mapSize.x !== sz){ world.key.shadow.mapSize.set(sz,sz); if(world.key.shadow.map){ world.key.shadow.map.dispose(); world.key.shadow.map = null; } } }
    if(world && world.crowd) world.crowd.count = q==="eco" ? Math.floor(world.crowdN*0.55) : world.crowdN;
    lastW = 0;
  }
  function initRenderer(){
    renderer = new T.WebGLRenderer({antialias:true, powerPreference:"high-performance", alpha:false});
    const lowEnd = (navigator.hardwareConcurrency||4) <= 4;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, lowEnd?1.25:1.75));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.className = "s3d-canvas";
    renderer.domElement.addEventListener("webglcontextlost", (e)=>{ e.preventDefault(); webglOK=false; S.setEnabled(false); if(window.render) try{ window.render(); }catch(_){} });
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(30, 1.6, 0.5, 900);
    clock = new T.Clock();
    buildWorld();
    { const i = CAM_MODES.indexOf(S.getDefaultCam()); if(i>=0) camMode = i; }
    applyQuality();
  }

  function buildWorld(){
    world = {};
    scene.background = new T.Color(0x070b18);
    scene.fog = new T.Fog(0x0a0f22, 180, 520);

    // Ciel : dôme dégradé + étoiles
    const skyGeo = new T.SphereGeometry(600, 32, 16);
    const skyMat = new T.ShaderMaterial({
      side:T.BackSide, depthWrite:false, fog:false,
      uniforms:{ top:{value:new T.Color(0x02040c)}, bottom:{value:new T.Color(0x1a2448)}, day:{value:0} },
      vertexShader:"varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader:"uniform vec3 top; uniform vec3 bottom; uniform float day; varying vec3 vP; float h(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,45.164)))*43758.5453);} void main(){ float t=clamp(vP.y*1.6,0.0,1.0); vec3 c=mix(bottom,top,pow(t,0.6)); vec3 q=floor(vP*300.0); float s=step(0.9965,h(q))*(1.0-day)*t; gl_FragColor=vec4(c+vec3(s),1.0); }"
    });
    world.sky = new T.Mesh(skyGeo, skyMat); scene.add(world.sky);

    // Lumières : hémisphère + "projecteurs" (une directionnelle avec ombres + 2 d'appoint)
    world.hemi = new T.HemisphereLight(0xbcd2ff, 0x1d3a1a, 0.55); scene.add(world.hemi);
    const key = new T.DirectionalLight(0xfff4e0, 2.1);
    key.position.set(-40, 90, 55); key.castShadow = true;
    key.shadow.mapSize.set(2048,2048);
    const sc = key.shadow.camera; sc.left=-62; sc.right=62; sc.top=45; sc.bottom=-45; sc.near=20; sc.far=220;
    key.shadow.bias = -0.0006; key.shadow.normalBias = 0.03;
    scene.add(key); world.key = key;
    const fill1 = new T.DirectionalLight(0xdfe8ff, 0.7); fill1.position.set(60, 70, -50); scene.add(fill1);
    const fill2 = new T.DirectionalLight(0xffffff, 0.35); fill2.position.set(0, 50, -80); scene.add(fill2);
    world.fills = [fill1, fill2];

    // Pelouse
    const pt = makePitchTexture();
    world.pitchTex = pt.tex;
    const pitch = new T.Mesh(new T.PlaneGeometry(pt.TW, pt.TH), new T.MeshStandardMaterial({map:pt.tex, roughness:0.92, metalness:0}));
    pitch.rotation.x = -Math.PI/2; pitch.receiveShadow = true; scene.add(pitch);
    world.pitch = pitch;
    // Pourtour (piste / béton)
    const apron = new T.Mesh(new T.PlaneGeometry(220, 170), new T.MeshStandardMaterial({color:0x22332a, roughness:1}));
    apron.rotation.x = -Math.PI/2; apron.position.y = -0.02; apron.receiveShadow = true; scene.add(apron);

    // Panneaux publicitaires LED
    world.adTex = makeAdTexture("France","Visiteurs");
    const adMat = new T.MeshStandardMaterial({map:world.adTex, emissive:0xffffff, emissiveMap:world.adTex, emissiveIntensity:0.85, roughness:0.5});
    const adBack = new T.MeshStandardMaterial({color:0x111111, roughness:0.8});
    const mkBoard = (len, x, z, ry)=>{
      const mesh = new T.Mesh(new T.BoxGeometry(len, 0.9, 0.15), [adBack,adBack,adBack,adBack,adMat,adBack]);
      mesh.position.set(x, 0.45, z); mesh.rotation.y = ry; mesh.castShadow = true; scene.add(mesh);
      // L'UV de la face avant couvre toute la texture : on la répète selon la longueur
      const uv = mesh.geometry.attributes.uv;
      for(let i=16;i<20;i++) uv.setX(i, uv.getX(i)*len/40);
      uv.needsUpdate = true;
    };
    mkBoard(L+6, 0, HW+4.2, Math.PI);
    mkBoard(L+6, 0, -HW-4.2, 0);
    mkBoard(W+8, -HL-5.2, 0, Math.PI/2);
    mkBoard(W+8, HL+5.2, 0, -Math.PI/2);

    // Tribunes (2 anneaux) façon grand stade, en bol continu aux coins arrondis
    const concrete = new T.MeshStandardMaterial({color:0x6c7078, roughness:0.95, side:T.DoubleSide});
    const seatsMat = new T.MeshStandardMaterial({color:0x1d3f8f, roughness:0.75, side:T.DoubleSide});
    const base = roundedRectSamples(HL+9, HW+9, 9, [56,36], 10);
    const lower = [], LR = 22, LD = 0.82, LH = 0.42;
    for(let r=0;r<LR;r++){ const d=r*LD, h=1.3+r*LH; lower.push([d,h],[d+LD,h],[d+LD,h+LH]); }
    const lowGeo = sweepGeometry(base, [[0,0]].concat(lower));
    const lowMesh = new T.Mesh(lowGeo, seatsMat); lowMesh.receiveShadow = true; scene.add(lowMesh);
    const lowTop = 1.3+LR*LH, lowEnd = LR*LD;
    // Coursive VIP vitrée entre les deux anneaux
    const vipTex = canvasTex(512,64,(g,w,h)=>{ g.fillStyle="#0c1222"; g.fillRect(0,0,w,h); for(let x=0;x<w;x+=16){ g.fillStyle=Math.random()<0.75?`rgba(255,${200+Math.random()*40|0},${140+Math.random()*60|0},${0.55+Math.random()*0.4})`:"rgba(30,40,60,1)"; g.fillRect(x+2,14,12,34);} g.fillStyle="#d4af37"; g.fillRect(0,h-6,w,3); }, {repeat:true});
    vipTex.repeat.set(1,1);
    const vipGeo = sweepGeometry(base, [[lowEnd,lowTop],[lowEnd,lowTop+4.2]]);
    const vipMat = new T.MeshStandardMaterial({map:vipTex, emissive:0xffffff, emissiveMap:vipTex, emissiveIntensity:0.9, roughness:0.3});
    scene.add(new T.Mesh(vipGeo, vipMat));
    // anneau LED (bandeau lumineux défilant)
    world.ringTex = canvasTex(1024,32,(g,w,h)=>{ const grd=g.createLinearGradient(0,0,w,0); grd.addColorStop(0,"#1b2f6b"); grd.addColorStop(0.5,"#d4af37"); grd.addColorStop(1,"#1b2f6b"); g.fillStyle=grd; g.fillRect(0,0,w,h); g.fillStyle="#fff"; g.font="bold 22px 'Bebas Neue',sans-serif"; g.textBaseline="middle"; for(let x=0;x<w;x+=256) g.fillText("★ SÉLECTIONNEUR ★ ALLEZ ! ", x+8, h/2+1); }, {repeat:true});
    const ringGeo = sweepGeometry(base, [[lowEnd-0.05,lowTop+4.2],[lowEnd-0.05,lowTop+5.0]]);
    scene.add(new T.Mesh(ringGeo, new T.MeshBasicMaterial({map:world.ringTex, fog:false})));
    // Anneau supérieur, plus raide
    const UD0 = lowEnd+1.5, UH0 = lowTop+5.4, UR = 20, UD = 0.85, UHr = 0.62;
    const upper = [[UD0, UH0-0.4]];
    for(let r=0;r<UR;r++){ const d=UD0+r*UD, h=UH0+r*UHr; upper.push([d,h],[d+UD,h],[d+UD,h+UHr]); }
    const upTop = UH0+UR*UHr, upEnd = UD0+UR*UD;
    upper.push([upEnd, upTop+3.5]);
    const upMesh = new T.Mesh(sweepGeometry(base, upper), seatsMat); upMesh.receiveShadow = true; scene.add(upMesh);
    // Mur extérieur
    scene.add(new T.Mesh(sweepGeometry(base, [[upEnd, upTop+3.5],[upEnd+0.4, upTop+3.5],[upEnd+3, 0]]), concrete));
    // Toit translucide
    const roofMat = new T.MeshStandardMaterial({color:0xd8dde6, roughness:0.6, metalness:0.2, side:T.DoubleSide, transparent:true, opacity:0.92});
    const roofY = upTop+8;
    const roof = new T.Mesh(sweepGeometry(base, [[upEnd+1, upTop+3.5],[upEnd-6, roofY],[3, roofY+1.2]]), roofMat);
    scene.add(roof);
    // Bord intérieur du toit : rampe de projecteurs
    const glowTex = makeGlowTexture();
    world.glowTex = glowTex;
    const lampsGeo = new T.BoxGeometry(2.2, 0.5, 0.5);
    const lampMat = new T.MeshBasicMaterial({color:0xfffbea});
    const lampIdx = [];
    for(let i=0;i<base.length;i+=4) lampIdx.push(i);
    const lamps = new T.InstancedMesh(lampsGeo, lampMat, lampIdx.length);
    const dummy = new T.Object3D();
    world.flares = [];
    lampIdx.forEach((bi,k)=>{
      const b = base[bi];
      dummy.position.set(b.x+b.nx*3.2, roofY+0.9, b.z+b.nz*3.2);
      dummy.rotation.set(0, Math.atan2(b.nx, b.nz), 0);
      dummy.updateMatrix(); lamps.setMatrixAt(k, dummy.matrix);
      if(k%2===0){
        const sp = new T.Sprite(new T.SpriteMaterial({map:glowTex, color:0xfff3d0, blending:T.AdditiveBlending, depthWrite:false, transparent:true, fog:false}));
        sp.position.copy(dummy.position); sp.position.y -= 0.3; sp.scale.set(9,9,1);
        scene.add(sp); world.flares.push(sp);
      }
    });
    scene.add(lamps);

    // Supporters (instanciés, shader maison)
    buildCrowd(base, lower, upper);
    // ---- v49 : vie autour du terrain ----
    buildSideline(base, lower, lowTop, roofY);


    // Écrans géants derrière les buts
    world.screens = [];
    [-1,1].forEach(side=>{
      const tex = canvasTex(512,192,()=>{});
      const scr = new T.Mesh(new T.PlaneGeometry(22, 8.2), new T.MeshBasicMaterial({map:tex, fog:false}));
      scr.position.set(side*(HL+9+upEnd-6), roofY-4.6, 0);
      scr.rotation.y = side>0 ? -Math.PI/2 : Math.PI/2;
      scene.add(scr);
      const frame = new T.Mesh(new T.BoxGeometry(0.6, 9, 23), new T.MeshStandardMaterial({color:0x111111}));
      frame.position.copy(scr.position); frame.position.x += side*0.4; scene.add(frame);
      world.screens.push(tex);
    });

    // Buts
    world.netTex = makeNetTexture();
    world.goals = [buildGoal(-1), buildGoal(1)];

    // Drapeaux de corner
    world.flags = [];
    [[-HL,-HW],[HL,-HW],[HL,HW],[-HL,HW]].forEach(([x,z])=>{
      const pole = new T.Mesh(new T.CylinderGeometry(0.025,0.025,1.6,6), new T.MeshStandardMaterial({color:0xf2f2f2}));
      pole.position.set(x,0.8,z); pole.castShadow = true; scene.add(pole);
      const flag = new T.Mesh(new T.PlaneGeometry(0.45,0.32), new T.MeshStandardMaterial({color:0xf5d000, side:T.DoubleSide, emissive:0x332a00}));
      flag.geometry.translate(0.225,0,0);
      flag.position.set(x,1.42,z); scene.add(flag); world.flags.push(flag);
    });

    // Bancs de touche abrités
    const dugMat = new T.MeshStandardMaterial({color:0x99aacc, transparent:true, opacity:0.35, roughness:0.1, metalness:0.3, side:T.DoubleSide});
    const benchMat = new T.MeshStandardMaterial({color:0x1d2633});
    [-9, 9].forEach(x=>{
      const shell = new T.Mesh(new T.CylinderGeometry(1.4,1.4,7,16,1,true,0,Math.PI), dugMat);
      shell.rotation.z = Math.PI/2; shell.rotation.y = Math.PI; shell.position.set(x, 0.9, HW+6.4);
      scene.add(shell);
      const bench = new T.Mesh(new T.BoxGeometry(6.6,0.5,0.6), benchMat);
      bench.position.set(x, 0.25, HW+6.8); scene.add(bench);
    });
    // Zone technique (pointillés) côté banc France
    const tz = new T.Mesh(new T.PlaneGeometry(12, 0.08), new T.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.7}));
    tz.rotation.x = -Math.PI/2; tz.position.set(-9, 0.02, HW+1.5); scene.add(tz);

    // Ballon
    const ballTex = canvasTex(256,128,(g,w,h)=>{
      g.fillStyle="#f6f6f6"; g.fillRect(0,0,w,h);
      g.fillStyle="#141414";
      for(let i=0;i<12;i++){ const x=(i%6)*w/6+((i/6|0)%2)*w/12, y=(i<6?0.3:0.72)*h; g.beginPath(); for(let k=0;k<5;k++){ const a=k/5*Math.PI*2-Math.PI/2; g.lineTo(x+Math.cos(a)*13, y+Math.sin(a)*13*0.9);} g.closePath(); g.fill(); }
      g.strokeStyle="rgba(0,0,0,0.25)"; g.lineWidth=1.2; for(let i=0;i<12;i++){ g.beginPath(); g.moveTo(i*w/12,0); g.lineTo(i*w/12+10,h); g.stroke(); }
    });
    const ball = new T.Mesh(new T.SphereGeometry(0.11, 20, 14), new T.MeshStandardMaterial({map:ballTex, roughness:0.45}));
    ball.castShadow = true; scene.add(ball);
    world.ball = ball;

    // Ombres "multi-projecteurs" (4 ombres douces par joueur, signature des matchs de nuit)
    world.blobTex = makeBlobTexture();
    const blobMat = new T.MeshBasicMaterial({map:world.blobTex, transparent:true, depthWrite:false, opacity:0.32, color:0x000000});
    const blobGeo = new T.PlaneGeometry(1,1); blobGeo.rotateX(-Math.PI/2);
    world.blobs = new T.InstancedMesh(blobGeo, blobMat, 30*4);
    world.blobs.frustumCulled = false;
    world.blobs.renderOrder = 1;
    scene.add(world.blobs);

    // Météo (pluie / neige)
    const N = 2600;
    const wpos = new Float32Array(N*3);
    for(let i=0;i<N;i++){ wpos[i*3]=rnd(-70,70); wpos[i*3+1]=rnd(0,45); wpos[i*3+2]=rnd(-50,50); }
    const wg = new T.BufferGeometry(); wg.setAttribute("position", new T.BufferAttribute(wpos,3));
    world.weather = new T.Points(wg, new T.PointsMaterial({color:0xcfe0ff, size:0.12, transparent:true, opacity:0.55, depthWrite:false}));
    world.weather.visible = false; world.weather.frustumCulled = false;
    scene.add(world.weather);

    // Confettis / papelitos (célébrations)
    const CN = 700;
    const cpos = new Float32Array(CN*3), ccol = new Float32Array(CN*3);
    const cg = new T.BufferGeometry(); cg.setAttribute("position", new T.BufferAttribute(cpos,3)); cg.setAttribute("color", new T.BufferAttribute(ccol,3));
    world.confetti = new T.Points(cg, new T.PointsMaterial({size:0.32, vertexColors:true, transparent:true, opacity:0.95, depthWrite:false}));
    world.confetti.visible = false; world.confetti.frustumCulled = false; world.confettiVel = new Float32Array(CN*3);
    scene.add(world.confetti);

    world.excite = 0.3; world.goalPulse = 0;
    // anneau "joueur au ballon" (façon FIFA) sous le porteur
    const markGeo = new T.RingGeometry(0.55, 0.72, 32); markGeo.rotateX(-Math.PI/2);
    world.ring = new T.Mesh(markGeo, new T.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.85, depthWrite:false}));
    world.ring.renderOrder = 2; world.ring.visible = false; scene.add(world.ring);
  }


  function buildSideline(base, lower, lowTop, roofY){
    const dummy = new T.Object3D();
    // Photographes accroupis derrière les buts (corps, tête, appareil à téléobjectif) + flashs
    const PH = 18;
    const bodyM = new T.InstancedMesh(new T.BoxGeometry(0.45, 0.7, 0.4), new T.MeshStandardMaterial({color:0x22252c, roughness:0.9}), PH);
    const headM = new T.InstancedMesh(new T.SphereGeometry(0.13, 10, 8), new T.MeshStandardMaterial({color:0xc68863, roughness:0.7}), PH);
    const camM = new T.InstancedMesh(new T.CylinderGeometry(0.07, 0.09, 0.42, 10).rotateX(Math.PI/2), new T.MeshStandardMaterial({color:0x0c0c0c, roughness:0.4, metalness:0.3}), PH);
    world.flashes = [];
    for(let i=0;i<PH;i++){
      const side = i < PH/2 ? -1 : 1, k = i % (PH/2);
      const z = (k - (PH/2-1)/2) * 2.6 + (Math.abs(k-4) < 1 ? 6 : 0);
      const x = side*(HL+3.6), ry = side > 0 ? -Math.PI/2 : Math.PI/2;
      dummy.position.set(x, 0.35, z); dummy.rotation.set(0, ry, 0); dummy.updateMatrix(); bodyM.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 0.82, z); dummy.updateMatrix(); headM.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x - side*0.32, 0.8, z); dummy.updateMatrix(); camM.setMatrixAt(i, dummy.matrix);
      const fl = new T.Sprite(new T.SpriteMaterial({map:world.glowTex || makeGlowTexture(), color:0xffffff, blending:T.AdditiveBlending, depthWrite:false, transparent:true, opacity:0}));
      fl.position.set(x - side*0.55, 0.82, z); fl.scale.set(1.6,1.6,1); scene.add(fl);
      world.flashes.push({sp:fl, side, t:0});
    }
    [bodyM, headM, camM].forEach(mm=>{ mm.castShadow = true; scene.add(mm); });
    // Stewards en chasuble orange, assis face au public le long de la piste
    const ST = 16;
    const stB = new T.InstancedMesh(new T.BoxGeometry(0.45, 0.55, 0.32), new T.MeshStandardMaterial({color:0xff7a1a, roughness:0.6, emissive:0x331400}), ST);
    const stH = new T.InstancedMesh(new T.SphereGeometry(0.12, 10, 8), new T.MeshStandardMaterial({color:0x9a6643, roughness:0.7}), ST);
    for(let i=0;i<ST;i++){
      const side = i % 2 ? 1 : -1, x = -HL + 8 + (i>>1)*((L-16)/7);
      const z = side*(HW+7.6);
      dummy.position.set(x, 0.45, z); dummy.rotation.set(0, side>0 ? 0 : Math.PI, 0); dummy.updateMatrix(); stB.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 0.85, z); dummy.updateMatrix(); stH.setMatrixAt(i, dummy.matrix);
    }
    scene.add(stB); scene.add(stH);
    // Drapeaux agités dans les tribunes (couleurs repeintes à chaque match, cf. paintFlags)
    const FL = 140;
    const fg = new T.PlaneGeometry(1.3, 0.85, 4, 1); fg.translate(0.65, 0, 0);
    world.crowdFlags = new T.InstancedMesh(fg, new T.MeshStandardMaterial({side:T.DoubleSide, roughness:0.8}), FL);
    world.crowdFlags.instanceColor = new T.InstancedBufferAttribute(new Float32Array(FL*3), 3);
    world.flagSpots = [];
    for(let i=0;i<FL;i++){
      const b = base[(Math.random()*base.length)|0], row = (Math.random()*20)|0;
      const d = row*0.82 + 0.4, h = 1.3 + row*0.42 + 1.4;
      world.flagSpots.push({x:b.x + b.nx*d, y:h, z:b.z + b.nz*d, ry:Math.atan2(-b.nx, -b.nz) + Math.PI/2, ph:Math.random()*6, sp:2 + Math.random()*2});
    }
    world.crowdFlags.frustumCulled = false; scene.add(world.crowdFlags);
    // Banderoles sur le devant de l'anneau inférieur
    world.banners = [];
    const bannerSpots = [[0, 1], [-30, 1], [30, 1], [0, -1], [-30, -1], [30, -1]];
    bannerSpots.forEach(([x, side], i)=>{
      const tex = canvasTex(1024, 96, ()=>{});
      const mesh = new T.Mesh(new T.PlaneGeometry(16, 1.5), new T.MeshStandardMaterial({map:tex, roughness:0.85, emissive:0x111111}));
      mesh.position.set(x, 1.35 + 0.42*2, side*(HW+9+0.85*2 - 0.05)); mesh.rotation.y = side>0 ? Math.PI : 0;
      scene.add(mesh); world.banners.push(tex);
    });
    // Faisceaux des projecteurs (cônes additifs visibles de nuit)
    world.beams = [];
    const beamMat = new T.MeshBasicMaterial({color:0xfff2d0, transparent:true, opacity:0.035, blending:T.AdditiveBlending, depthWrite:false, side:T.DoubleSide, fog:false});
    [[-HL-12,-HW-14],[HL+12,-HW-14],[HL+12,HW+14],[-HL-12,HW+14],[0,-HW-20],[0,HW+20]].forEach(([x,z])=>{
      const len = 52, cone = new T.Mesh(new T.ConeGeometry(16, len, 24, 1, true), beamMat);
      cone.geometry.translate(0, -len/2, 0);
      cone.position.set(x, roofY+1, z);
      cone.lookAt(x*0.35, 0, z*0.35); cone.rotateX(-Math.PI/2);
      scene.add(cone); world.beams.push(cone);
    });
  }
  function paintSideline(kUs, kThem, usName, oppName){
    const cU = [new T.Color(kUs[0]), new T.Color(kUs[1]), new T.Color(kUs[2])], cT = [new T.Color(kThem[0]), new T.Color(kThem[1])];
    for(let i=0;i<world.crowdFlags.count;i++){
      const c = Math.random() < 0.72 ? cU[(Math.random()*3)|0] : cT[(Math.random()*2)|0];
      world.crowdFlags.setColorAt(i, c);
    }
    world.crowdFlags.instanceColor.needsUpdate = true;
    const texts = [`ALLEZ ${usName.toUpperCase()} !`, `FIERS D'ÊTRE ${usName.toUpperCase()}`, `ICI C'EST CHEZ NOUS`, `${oppName.toUpperCase()} ON VOUS ATTEND`, `PLUS QU'UN MATCH`, `ENSEMBLE JUSQU'AU BOUT`];
    world.banners.forEach((tex, i)=>{
      const g = tex.userData.ctx, w = 1024, h = 96;
      const bg = i===3 ? kThem[0] : (i%2 ? "#ffffff" : kUs[0]), fgc = i===3 ? kThem[3]||"#fff" : (i%2 ? kUs[0] : "#ffffff");
      g.fillStyle = bg; g.fillRect(0,0,w,h);
      g.fillStyle = kUs[2]; g.fillRect(0,0,w,8); g.fillRect(0,h-8,w,8);
      g.fillStyle = fgc; g.font = "bold 66px 'Bebas Neue', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(texts[i % texts.length], w/2, h/2+3, w-40);
      tex.needsUpdate = true;
    });
  }
  function updateSideline(t, dt){
    // drapeaux qui flottent
    const d = _dummy;
    world.flagSpots.forEach((f,i)=>{
      d.position.set(f.x, f.y + Math.max(0, Math.sin(t*f.sp*0.5 + f.ph))*0.25*world.excite, f.z);
      d.rotation.set(Math.sin(t*f.sp + f.ph)*0.35, f.ry + Math.sin(t*f.sp*0.7 + f.ph)*0.5, 0);
      d.updateMatrix(); world.crowdFlags.setMatrixAt(i, d.matrix);
    });
    world.crowdFlags.instanceMatrix.needsUpdate = true;
    // flashs des photographes : plus nombreux quand le ballon approche de leur but
    const bx = world.ball.position.x;
    world.flashes.forEach(f=>{
      if(f.t > 0){ f.t -= dt; f.sp.material.opacity = Math.max(0, f.t/0.12); return; }
      const near = clamp((bx*f.side - 20)/30, 0, 1);
      if(Math.random() < dt*(0.15 + near*2.2 + world.goalPulse*6)){ f.t = 0.12; f.sp.material.opacity = 1; }
    });
  }

  function buildGoal(side){
    const g = new T.Group();
    const postMat = new T.MeshStandardMaterial({color:0xffffff, roughness:0.35});
    const r = 0.06;
    const postGeo = new T.CylinderGeometry(r,r,GOAL_H,12);
    [-1,1].forEach(s=>{ const p=new T.Mesh(postGeo, postMat); p.position.set(0, GOAL_H/2, s*GOAL_W/2); p.castShadow=true; g.add(p); });
    const bar = new T.Mesh(new T.CylinderGeometry(r,r,GOAL_W+2*r,12), postMat); bar.rotation.x = Math.PI/2; bar.position.set(0,GOAL_H,0); bar.castShadow=true; g.add(bar);
    // filet
    const nm = new T.MeshStandardMaterial({map:world.netTex, alphaMap:null, transparent:true, side:T.DoubleSide, depthWrite:false, roughness:1, color:0xffffff});
    nm.alphaTest = 0.2;
    const back = new T.Mesh(new T.PlaneGeometry(GOAL_W, GOAL_H, 8, 4), nm);
    back.geometry.attributes.uv.array.forEach((v,i,a)=>{ a[i] = v*(i%2===0 ? 7 : 2.5); });
    back.rotation.y = Math.PI/2; back.position.set(side*GOAL_D, GOAL_H/2, 0); g.add(back);
    const top = new T.Mesh(new T.PlaneGeometry(GOAL_D, GOAL_W), nm); top.rotation.x = -Math.PI/2; top.position.set(side*GOAL_D/2, GOAL_H, 0); g.add(top);
    [-1,1].forEach(s=>{ const sd=new T.Mesh(new T.PlaneGeometry(GOAL_D, GOAL_H), nm); sd.position.set(side*GOAL_D/2, GOAL_H/2, s*GOAL_W/2); g.add(sd); });
    g.position.set(side*HL, 0, 0);
    scene.add(g);
    return {group:g, back, bulge:0, side};
  }

  // ---------------------------------------------------------------- foule
  function buildCrowd(base, lower, upper){
    const seats = [];
    const collect = (profile, tierShade)=>{
      // chaque rang = triplet [d,h],[d+LD,h],[d+LD,h+LH] -> on prend le milieu de la marche
      for(let p=0;p+2<profile.length;p+=3){
        const [d0,h0] = profile[p], [d1] = profile[p+1];
        if(typeof d0!=="number" || d1===undefined) continue;
        const dm = (d0+d1)/2;
        for(let i=0;i<base.length;i++){
          const b = base[i], nb = base[(i+1)%base.length];
          const segLen = Math.hypot((nb.x+nb.nx*dm)-(b.x+b.nx*dm), (nb.z+nb.nz*dm)-(b.z+b.nz*dm));
          const n = Math.max(1, Math.round(segLen/0.62));
          for(let k=0;k<n;k++){
            if(Math.random()<0.07) continue; // quelques sièges vides
            const t = k/n;
            const x = lerp(b.x+b.nx*dm, nb.x+nb.nx*dm, t) + rnd(-0.08,0.08);
            const z = lerp(b.z+b.nz*dm, nb.z+nb.nz*dm, t) + rnd(-0.08,0.08);
            seats.push({x, z, y:h0, nx:lerp(b.nx,nb.nx,t), nz:lerp(b.nz,nb.nz,t), shade:tierShade});
          }
        }
      }
    };
    collect(lower, 1.0);
    collect(upper.slice(1), 0.82);
    const N = seats.length;
    const geo = new T.PlaneGeometry(0.62, 0.62);
    geo.translate(0, 0.31, 0);
    const mat = new T.ShaderMaterial({
      uniforms:{ atlas:{value:world.crowdAtlas || (world.crowdAtlas = makeCrowdAtlas())}, time:{value:0}, excite:{value:0.3}, flash:{value:0}, light:{value:1.0} },
      transparent:false,
      vertexShader:`
        attribute vec4 aData;   // x: variante (0..7), y: phase, z: ombre de niveau, w: côté (1 = nos supporters)
        attribute vec3 aSkin; attribute vec3 aHair; attribute vec3 aShirt;
        uniform float time; uniform float excite;
        varying vec2 vUv; varying vec3 vSkin; varying vec3 vHair; varying vec3 vShirt; varying float vShade; varying float vSeed; varying float vRow;
        void main(){
          vUv = uv; vSkin=aSkin; vHair=aHair; vShirt=aShirt; vShade=aData.z; vSeed=aData.y;
          float ph = aData.y;
          // excitation : les supporters se lèvent et sautent, les autres bougent à peine
          float ex = excite * mix(0.55, 1.0, aData.w);
          float jump = max(0.0, sin(time*(6.0+fract(ph*7.0)*3.0)+ph*6.2831)) * ex * 0.38;
          float sway = sin(time*1.3+ph*12.0)*0.03;
          vRow = step(0.62, ex) * step(0.35, fract(ph*13.7));   // bras levés
          vec3 p = position;
          p.y += jump; p.x += sway;
          vec4 wp = modelMatrix * instanceMatrix * vec4(p,1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader:`
        uniform sampler2D atlas; uniform float time; uniform float flash; uniform float light;
        varying vec2 vUv; varying vec3 vSkin; varying vec3 vHair; varying vec3 vShirt; varying float vShade; varying float vSeed; varying float vRow;
        float h1(float n){ return fract(sin(n)*43758.5453); }
        void main(){
          float variant = floor(fract(vSeed*3.17)*8.0);
          vec2 uv = vec2((variant + vUv.x)/8.0, (1.0-vRow)*0.5 + vUv.y*0.5);
          vec4 t = texture2D(atlas, uv);
          if(t.a < 0.5) discard;
          float sc = min(t.r, t.b);                 // magenta = écharpe
          vec3 scarf = vec3(1.0) - vShirt*0.55;
          float tot = max(t.r + t.g + t.b - sc, 0.001);
          vec3 c = (vShirt*(t.r-sc) + vSkin*t.g + vHair*(t.b-sc) + scarf*sc) / tot;
          c *= vShade * light * (0.82 + 0.18*vUv.y);
          // flashs d'appareils photo pendant les temps forts
          float f = step(0.9965 - flash*0.012, h1(vSeed*91.7 + floor(time*9.0)));
          c = mix(c, vec3(1.6), f*flash);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    });
    const mesh = new T.InstancedMesh(geo, mat, N);
    mesh.frustumCulled = false;
    const aData = new Float32Array(N*4), aSkin = new Float32Array(N*3), aHair = new Float32Array(N*3), aShirt = new Float32Array(N*3);
    const dummy = new T.Object3D();
    const SKINS = [[0.96,0.80,0.69],[0.88,0.68,0.55],[0.76,0.57,0.42],[0.55,0.38,0.26],[0.36,0.24,0.16],[0.27,0.18,0.12]];
    const HAIRS = [[0.08,0.06,0.05],[0.2,0.13,0.07],[0.45,0.33,0.2],[0.75,0.65,0.4],[0.5,0.5,0.52],[0.1,0.1,0.12]];
    seats.forEach((s,i)=>{
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, Math.atan2(-s.nx, -s.nz), 0);
      const sc = rnd(0.9,1.12); dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      const home = Math.random() < 0.72 ? 1 : 0;   // ~72% de supporters à domicile
      aData.set([Math.floor(Math.random()*8), Math.random()*100, s.shade*rnd(0.85,1.05), home], i*4);
      aSkin.set(SKINS[(Math.random()*SKINS.length)|0], i*3);
      aHair.set(HAIRS[(Math.random()*HAIRS.length)|0], i*3);
    });
    geo.setAttribute("aData", new T.InstancedBufferAttribute(aData,4));
    geo.setAttribute("aSkin", new T.InstancedBufferAttribute(aSkin,3));
    geo.setAttribute("aHair", new T.InstancedBufferAttribute(aHair,3));
    geo.setAttribute("aShirt", new T.InstancedBufferAttribute(aShirt,3));
    scene.add(mesh);
    world.crowd = mesh; world.crowdN = N;
  }

  function paintCrowd(kUs, kThem){
    const attr = world.crowd.geometry.getAttribute("aShirt");
    const data = world.crowd.geometry.getAttribute("aData");
    const cU = [new T.Color(kUs[0]), new T.Color(kUs[1]), new T.Color(kUs[2])];
    const cT = [new T.Color(kThem[0]), new T.Color(kThem[1])];
    const neutral = [new T.Color(0x2b2f38), new T.Color(0x5a5f6a), new T.Color(0xd8d8d8), new T.Color(0x3a4a2a), new T.Color(0x6b2a2a)];
    for(let i=0;i<world.crowdN;i++){
      const home = data.getW(i) > 0.5;
      const r = Math.random();
      let c;
      if(home) c = r<0.62 ? cU[0] : r<0.78 ? cU[1] : r<0.86 ? cU[2] : neutral[(Math.random()*neutral.length)|0];
      else c = r<0.6 ? cT[0] : r<0.75 ? cT[1] : neutral[(Math.random()*neutral.length)|0];
      const v = rnd(0.82,1.08);
      attr.setXYZ(i, Math.min(1,c.r*v), Math.min(1,c.g*v), Math.min(1,c.b*v));
    }
    attr.needsUpdate = true;
  }

  // ---------------------------------------------------------------- joueurs (humanoïdes articulés)
  const SHARED = {};
  function sharedGeos(){
    if(SHARED.ok) return SHARED;
    // v49 : torse sculpté (taille fine, poitrine et épaules larges) au lieu d'une capsule
    const prof = [[0.001,-0.33],[0.15,-0.32],[0.165,-0.2],[0.175,-0.08],[0.2,0.06],[0.222,0.17],[0.226,0.24],[0.2,0.3],[0.14,0.34],[0.06,0.36],[0.001,0.365]]
      .map(([r,y])=> new T.Vector2(r, y));
    SHARED.torso = new T.LatheGeometry(prof, 16); SHARED.torso.scale(1.1, 1, 0.66); SHARED.torso.computeVertexNormals();
    SHARED.collar = new T.TorusGeometry(0.062, 0.016, 6, 14); SHARED.collar.rotateX(Math.PI/2);
    SHARED.delt = new T.SphereGeometry(0.075, 10, 8);
    SHARED.afro = new T.SphereGeometry(0.15, 12, 10); SHARED.afro.scale(1, 0.92, 1);
    SHARED.buzz = new T.SphereGeometry(0.119, 14, 8, 0, Math.PI*2, 0, Math.PI*0.5);
    SHARED.tail = new T.CapsuleGeometry(0.035, 0.12, 3, 6);
    SHARED.pelvis = new T.CapsuleGeometry(0.17, 0.1, 4, 10); SHARED.pelvis.scale(1.12,1,0.75);
    SHARED.head = new T.SphereGeometry(0.115, 16, 12); SHARED.head.scale(0.92,1.08,1);
    SHARED.hair = new T.SphereGeometry(0.122, 14, 8, 0, Math.PI*2, 0, Math.PI*0.55); SHARED.hair.scale(0.94,1.05,1.04);
    SHARED.neck = new T.CylinderGeometry(0.05,0.06,0.1,8);
    SHARED.upperArm = new T.CapsuleGeometry(0.058, 0.2, 3, 8); SHARED.upperArm.translate(0,-0.14,0);
    SHARED.foreArm = new T.CapsuleGeometry(0.048, 0.2, 3, 8); SHARED.foreArm.translate(0,-0.13,0);
    SHARED.thigh = new T.CapsuleGeometry(0.085, 0.3, 3, 8); SHARED.thigh.translate(0,-0.22,0);
    SHARED.shorts = new T.CylinderGeometry(0.105, 0.11, 0.2, 10); SHARED.shorts.translate(0,-0.09,0);
    SHARED.shin = new T.CapsuleGeometry(0.062, 0.32, 3, 8); SHARED.shin.translate(0,-0.21,0);
    SHARED.boot = new T.BoxGeometry(0.1, 0.07, 0.26); SHARED.boot.translate(0,-0.03,0.05);
    SHARED.glove = new T.SphereGeometry(0.06, 8, 6);
    SHARED.numPlane = new T.PlaneGeometry(0.27, 0.27);
    SHARED.hand = new T.SphereGeometry(0.045, 8, 6); SHARED.hand.scale(0.8,1.2,0.6);
    SHARED.ok = true;
    return SHARED;
  }
  const SKIN_TONES = [0xf1c7a5, 0xe0a982, 0xc68863, 0x9a6643, 0x6e4529, 0x4b2e1c];
  const HAIR_TONES = [0x16100c, 0x2b1a0f, 0x5a3b22, 0xb88a4a, 0x0d0d0d, 0x3b2a1a];
  const matCache = {};
  function mat(color, rough){ const k=color+"|"+(rough||0.7); return matCache[k] || (matCache[k] = new T.MeshStandardMaterial({color, roughness:rough||0.7})); }
  const numCache = {};
  function numMat(n, fg, bg, name){ const k=n+fg+bg+(name||""); if(!numCache[k]){ numCache[k] = new T.MeshStandardMaterial({map:makeNumberTexture(n,fg,bg,name), roughness:0.7, polygonOffset:true, polygonOffsetFactor:-2}); } return numCache[k]; }
  const shirtCache = {};
  function shirtMat(kit){ const k=kit.join("|"); if(!shirtCache[k]){ shirtCache[k] = new T.MeshStandardMaterial({map:makeShirtTexture(kit), roughness:0.72}); } return shirtCache[k]; }

  function makeHumanoid(opts){
    const G = sharedGeos();
    const shirt = opts.shirtMat || mat(opts.shirt);
    const shorts = mat(opts.shorts), socks = mat(opts.socks), skin = mat(opts.skin, 0.6), hair = mat(opts.hair, 0.9), boots = mat(opts.boot||0x111111, 0.4);
    const root = new T.Group();
    const body = new T.Group(); root.add(body);
    const hips = new T.Group(); hips.position.y = 0.98; body.add(hips);
    const pelvis = new T.Mesh(G.pelvis, shorts); pelvis.position.y = 0.02; hips.add(pelvis);
    const spine = new T.Group(); spine.position.y = 0.08; hips.add(spine);
    const torso = new T.Mesh(G.torso, shirt); torso.position.y = 0.24; spine.add(torso);
    const neck = new T.Mesh(G.neck, skin); neck.position.y = 0.53; spine.add(neck);
    const headG = new T.Group(); headG.position.y = 0.65; spine.add(headG);
    const head = new T.Mesh(G.head, skin); headG.add(head);
    // coiffures : courte, rasée, afro, crâne rasé, queue de cheval
    const hs = opts.hairStyle;
    if(hs === 0 || hs === undefined){ const h = new T.Mesh(G.hair, hair); h.position.y = 0.02; h.rotation.x = -0.25; headG.add(h); }
    else if(hs === 1){ const h = new T.Mesh(G.buzz, hair); h.position.y = 0.01; h.rotation.x = -0.15; headG.add(h); }
    else if(hs === 2){ const h = new T.Mesh(G.afro, hair); h.position.set(0, 0.06, -0.02); headG.add(h); }
    else if(hs === 4){ const h = new T.Mesh(G.hair, hair); h.position.y = 0.02; h.rotation.x = -0.25; headG.add(h);
      const tl = new T.Mesh(G.tail, hair); tl.position.set(0, -0.02, -0.13); tl.rotation.x = 0.5; headG.add(tl); }
    const col = new T.Mesh(G.collar, opts.collar ? mat(opts.collar) : shirt); col.position.y = 0.5; spine.add(col);
    if(opts.number!==undefined){
      const np = new T.Mesh(G.numPlane, numMat(opts.number, opts.numColor||"#ffffff", opts.shirt, opts.backName));
      np.position.set(0, 0.3, -0.136); np.rotation.y = Math.PI; spine.add(np);
    }
    const mkArm = (s)=>{
      const sh = new T.Group(); sh.position.set(s*0.26, 0.45, 0); spine.add(sh);
      const dl = new T.Mesh(G.delt, shirt); dl.position.y = -0.02; sh.add(dl);
      const ua = new T.Mesh(G.upperArm, opts.longSleeves ? shirt : shirt); sh.add(ua);
      const el = new T.Group(); el.position.y = -0.3; sh.add(el);
      const fa = new T.Mesh(G.foreArm, opts.longSleeves ? shirt : skin); el.add(fa);
      if(opts.gloves){ const gl = new T.Mesh(G.glove, mat(opts.gloves)); gl.position.y=-0.3; el.add(gl); }
      else { const hd = new T.Mesh(G.hand, skin); hd.position.y=-0.29; el.add(hd); }
      sh.rotation.z = s*0.12;
      return {sh, el};
    };
    const mkLeg = (s)=>{
      const hp = new T.Group(); hp.position.set(s*0.1, 0, 0); hips.add(hp);
      const sh = new T.Mesh(G.shorts, shorts); hp.add(sh);
      const th = new T.Mesh(G.thigh, skin); hp.add(th);
      const kn = new T.Group(); kn.position.y = -0.45; hp.add(kn);
      const sn = new T.Mesh(G.shin, socks); kn.add(sn);
      const ft = new T.Group(); ft.position.y = -0.47; kn.add(ft);
      const bt = new T.Mesh(G.boot, boots); ft.add(bt);
      return {hp, kn, ft};
    };
    const armL = mkArm(1), armR = mkArm(-1), legL = mkLeg(1), legR = mkLeg(-1);
    root.traverse(o=>{ if(o.isMesh){ o.castShadow = true; } });
    const sc = opts.scale || 1;
    root.scale.setScalar(sc);
    return {root, body, hips, spine, headG, armL, armR, legL, legR,
      phase:Math.random()*10, speed:0, pos:new T.Vector3(), vel:new T.Vector3(), tgt:new T.Vector3(), smoothTgt:new T.Vector3(),
      heading:0, kick:0, celebrate:0, dive:0, diveDir:0, jumpPh:Math.random()*6};
  }

  function poseHumanoid(h, dt, t){
    const sp = h.speed;
    const run = clamp(sp/7, 0, 1);
    const walk = clamp(sp/1.8, 0, 1);
    h.phase += dt * (2.2 + sp*1.45) * (h.backward ? -0.85 : 1);   // pas chassés / course arrière
    const ph = h.phase;
    const amp = (0.25*walk + 0.65*run) * (h.backward ? 0.7 : 1);
    const s1 = Math.sin(ph), s2 = Math.sin(ph+Math.PI);
    h.legL.hp.rotation.x = s1*amp;
    h.legR.hp.rotation.x = s2*amp;
    h.legL.kn.rotation.x = Math.max(0, -Math.cos(ph))*amp*1.6 + 0.05;
    h.legR.kn.rotation.x = Math.max(0, -Math.cos(ph+Math.PI))*amp*1.6 + 0.05;
    h.armL.sh.rotation.x = s2*amp*0.9; h.armR.sh.rotation.x = s1*amp*0.9;
    h.armL.el.rotation.x = -0.35-run*0.9; h.armR.el.rotation.x = -0.35-run*0.9;
    h.armL.sh.rotation.z = 0.12; h.armR.sh.rotation.z = -0.12;
    h.spine.rotation.x = 0.06 + run*0.2;
    h.body.position.y = Math.abs(Math.sin(ph))*0.06*(walk+run) + Math.sin(t*1.7+h.jumpPh)*0.004;
    h.body.rotation.z = 0; h.body.rotation.x = 0;
    h.body.position.x = 0;
    // frappe de balle
    if(h.kick>0){
      const A = h.kickAmp || 1;          // 0.28 = touche de conduite, 0.75 passe, 1.45 frappe
      const k = 1-h.kick; // 0 -> 1
      const sw = Math.sin(k*Math.PI);
      const leg = (A < 0.5 && (h.kickLeg = h.kickLeg || 1) < 0) ? h.legL : h.legR;
      leg.hp.rotation.x = lerp(leg.hp.rotation.x, (-0.4 + sw*-1.1 + (k<0.35 ? 0.9*(k/0.35) : 0))*A, Math.min(1, A*1.4));
      leg.kn.rotation.x = k<0.4 ? 1.1*A : 0.15;
      if(A > 0.6){ h.armL.sh.rotation.z = 0.12 + sw*0.9*A; h.armR.sh.rotation.z = -0.12 - sw*0.6*A; h.spine.rotation.x -= sw*0.25*(A-0.6); }
      h.kick = Math.max(0, h.kick - dt*(A < 0.5 ? 5.5 : 2.6));
      if(h.kick === 0 && A < 0.5) h.kickLeg = -(h.kickLeg||1);
    }
    // feinte / dribble : déhanché, passement, roulette
    if(h.feint){
      const f = h.feint; f.t += dt;
      const dur = f.kind==="roulette" ? 0.55 : 0.42;
      const u = Math.min(1, f.t/dur);
      if(f.kind === "roulette") h.body.rotation.y = u*Math.PI*2;
      else if(f.kind === "passement"){ h.body.rotation.z = Math.sin(u*Math.PI*2)*0.38*f.dir; h.legL.hp.rotation.z = Math.sin(u*Math.PI*2)*0.5; }
      else { h.body.rotation.z = Math.sin(u*Math.PI)*0.42*f.dir; h.body.position.x = Math.sin(u*Math.PI)*0.25*f.dir; }
      if(u >= 1){ h.feint = null; h.body.rotation.y = 0; h.legL.hp.rotation.z = 0; }
    }
    // saut (jeu de tête) et contrôle de la poitrine
    if(h.jump > 0){ const u = 1-h.jump; h.body.position.y += Math.sin(u*Math.PI)*0.55; h.spine.rotation.x += Math.sin(u*Math.PI*1.3)*0.5 - 0.15;
      h.armL.sh.rotation.z = 0.9; h.armR.sh.rotation.z = -0.9; h.jump = Math.max(0, h.jump - dt*1.6); }
    if(h.chest > 0){ h.spine.rotation.x -= Math.sin((1-h.chest)*Math.PI)*0.45; h.chest = Math.max(0, h.chest - dt*2.2); }
    // inclinaison dans les virages (vitesse angulaire) et regard qui suit le ballon
    h.body.rotation.z += clamp(-(h.turnRate||0)*0.06*clamp(sp/6,0,1), -0.3, 0.3);
    if(h.lookYaw !== undefined){ h.headG.rotation.y = lerp(h.headG.rotation.y, h.lookYaw, Math.min(1, dt*8)); h.headG.rotation.x = lerp(h.headG.rotation.x, h.lookPitch||0, Math.min(1, dt*6)); }
    // gardien "sur ses appuis" avant une frappe
    if(h.setT > 0){ h.body.position.y -= 0.12*Math.min(1,h.setT*3); h.spine.rotation.x += 0.35; h.legL.kn.rotation.x += 0.55; h.legR.kn.rotation.x += 0.55;
      h.legL.hp.rotation.x -= 0.3; h.legR.hp.rotation.x -= 0.3; h.armL.sh.rotation.z = 0.7; h.armR.sh.rotation.z = -0.7; h.setT = Math.max(0, h.setT - dt); }
    // à l'arrêt : léger balancement ; loin du ballon : mains sur les hanches
    if(sp < 0.3 && !h.isCoach && h.kick <= 0 && h.celebrate <= 0 && h.dive <= 0){
      h.body.rotation.z += Math.sin(t*0.9 + h.jumpPh)*0.025;
      if(h.restPose){ h.armL.sh.rotation.z = 0.5; h.armR.sh.rotation.z = -0.5; h.armL.el.rotation.x = -1.7; h.armR.el.rotation.x = -1.7; h.armL.sh.rotation.x = 0.35; h.armR.sh.rotation.x = 0.35; }
    }
    // défenseur éliminé : déséquilibre
    if(h.stun > 0){ h.body.rotation.x = -0.32*Math.min(1, h.stun); h.body.rotation.z += Math.sin(t*9)*0.08*h.stun; }
    // célébration : bras en l'air + sauts
    if(h.celebrate>0){
      const c = Math.min(1, h.celebrate);
      h.armL.sh.rotation.z = lerp(h.armL.sh.rotation.z, 2.6, c); h.armR.sh.rotation.z = lerp(h.armR.sh.rotation.z, -2.6, c);
      h.armL.sh.rotation.x *= (1-c); h.armR.sh.rotation.x *= (1-c);
      h.armL.el.rotation.x = lerp(h.armL.el.rotation.x, -0.2, c); h.armR.el.rotation.x = lerp(h.armR.el.rotation.x, -0.2, c);
      if(sp < 2.5) h.body.position.y += Math.max(0, Math.sin(t*7+h.jumpPh))*0.32*c;
      h.celebrate = Math.max(0, h.celebrate - dt*0.22);
    }
    // plongeon du gardien
    if(h.dive>0){
      const d = h.dive; // 1 -> 0
      const k = d>0.6 ? (1-d)/0.4 : 1;
      h.body.rotation.z = h.diveDir * 1.35 * k;
      h.body.position.y = 0.35*Math.sin(Math.min(1,k)*Math.PI*0.8) + (k>=1 ? -0.45*(1-d/0.6) : 0);
      h.body.position.x = h.diveDir * -0.6 * k;
      h.armL.sh.rotation.z = 2.8; h.armR.sh.rotation.z = -2.8;
      h.dive = Math.max(0, h.dive - dt*0.8);
    }
  }

  function buildTeams(m){
    if(teams){ teams.all.forEach(h=> scene.remove(h.root)); }
    const kits = teamKits(m);
    teams = {us:[], them:[], all:[], kits, ref:null, linesmen:[], coach:null};
    const oppNames = (typeof oppNamesFor === "function") ? oppNamesFor(m) : [];
    const mk = (side, i, kit, isGK)=>{
      const fullName = side==="us" ? ((m.usOrder && m.usOrder[i] && m.usOrder[i].nom) || "") : (oppNames[i] || "");
      const seed = hashStr((side==="us" ? ((m.usOrder&&m.usOrder[i]&&m.usOrder[i].nom)||("us"+i)) : (m.opp+i)));
      const gkKit = side==="us" ? ["#1f9d55","#111111","#1f9d55","#ffffff"] : ["#f2c200","#111111","#f2c200","#111111"];
      const k = isGK ? gkKit : kit;
      const h = makeHumanoid({
        shirt:k[0], shirtMat: isGK ? null : shirtMat(kit), shorts:k[1], socks:k[2], numColor:k[3],
        skin:SKIN_TONES[seed%SKIN_TONES.length], hair:HAIR_TONES[(seed>>>3)%HAIR_TONES.length], hairStyle:(seed>>>6)%5,
        boot:[0x111111,0xf4f4f4,0xff3d7f,0x38e1ff,0xd4ff00][(seed>>>9)%5],
        collar: k[3], number: isGK ? 1 : (i===0?1:i+1), backName: backName(fullName), gloves: isGK ? 0xf8f8f8 : null, longSleeves:isGK,
        scale: 0.94 + ((seed>>>12)%13)/100,
      });
      h.side = side; h.idx = i; h.isGK = isGK;
      scene.add(h.root); teams.all.push(h);
      return h;
    };
    for(let i=0;i<11;i++){ teams.us.push(mk("us", i, kits.us, i===0)); }
    for(let i=0;i<11;i++){ teams.them.push(mk("them", i, kits.them, i===0)); }
    const ref = makeHumanoid({shirt:"#e6ff1e", shorts:"#111111", socks:"#111111", skin:SKIN_TONES[1], hair:HAIR_TONES[4], scale:0.97});
    ref.isRef = true; scene.add(ref.root); teams.all.push(ref); teams.ref = ref;
    [-1,1].forEach(s=>{
      const ls = makeHumanoid({shirt:"#e6ff1e", shorts:"#111111", socks:"#111111", skin:SKIN_TONES[2], hair:HAIR_TONES[0]});
      ls.isLinesman = s; scene.add(ls.root); teams.all.push(ls); teams.linesmen.push(ls);
    });
    // Le sélectionneur (vous !) en costume dans la zone technique
    const coach = makeHumanoid({shirt:"#1a1f2b", shorts:"#1a1f2b", socks:"#1a1f2b", skin:SKIN_TONES[0], hair:HAIR_TONES[4], longSleeves:true, boot:0x0a0a0a});
    coach.isCoach = true; scene.add(coach.root); teams.all.push(coach); teams.coach = coach;
    paintCrowd(kits.us, kits.them);
    paintSideline(kits.us, kits.them, m.ctx==="club" ? clubName() : "les Bleus", String(m.opp||""));
    // remplaçants à l'échauffement (chasubles fluo) derrière la ligne de touche
    teams.subs = [];
    for(let k=0;k<3;k++){
      const sub = makeHumanoid({shirt:"#ff6a00", shorts:kits.us[1], socks:kits.us[2], skin:SKIN_TONES[(k*2+1)%SKIN_TONES.length], hair:HAIR_TONES[k], scale:0.98});
      sub.isSub = true; sub.subPh = k*1.7; scene.add(sub.root); teams.all.push(sub); teams.subs.push(sub);
      sub.pos.set(-20 + k*2, 0, HW+3.2); sub.tgt.copy(sub.pos); sub.smoothTgt.copy(sub.pos);
    }
    // positions initiales = positions courantes du match
    syncTargets(m, true);
    recInit();
  }

  // Lit m.pos (pourcentages du moteur 2D) et fixe les cibles 3D.
  function syncTargets(m, snap){
    if(!m.pos) return;
    if(m.showcase){
      // avant-match : alignement des deux équipes pour les hymnes, face à la tribune principale
      teams.us.forEach((h,i)=>{ h.tgt.set(-1.6 - (10-i)*1.05, 0, 4); });
      teams.them.forEach((h,i)=>{ h.tgt.set(1.6 + i*1.05, 0, 4); });
      teams.ref.tgt.set(0, 0, 4); teams.linesmen[0].tgt.set(-0.9,0,4.2); teams.linesmen[1].tgt.set(0.9,0,4.2);
      teams.coach.tgt.set(-9, 0, HW+2.2); teams.carrier = null;
      if(snap) teams.all.forEach(h=>{ h.pos.copy(h.tgt); h.smoothTgt.copy(h.tgt); });
      return;
    }
    const ball = m.pos.ball || {x:50,y:50};
    const bx = toX(ball.x), bz = toZ(ball.y);
    const set = (h, p)=>{
      if(!p) return;
      h.tgt.set(toX(p.x), 0, toZ(p.y));
      if(snap){ h.pos.copy(h.tgt); h.smoothTgt.copy(h.tgt); }
    };
    teams.us.forEach((h,i)=> set(h, m.pos.us[i]));
    teams.them.forEach((h,i)=> set(h, m.pos.them[i]));
    // v49 : IA COLLECTIVE — bloc défensif aligné et compact, soutien et appels de l'équipe qui attaque.
    // On mélange la position "tactique" voulue par le moteur de match (m.pos) avec ces comportements.
    const cc = BS.carrier;
    if(cc && !cc.isGK){
      const dirA = attackDir(cc.side), atk = teamArr(cc.side), dfn = teamArr(cc.side==="us"?"them":"us");
      const bz0 = cc.pos.z;
      // ligne défensive : ~13 m derrière le ballon, jamais dans la surface de son propre gardien
      const lineX = clamp(cc.pos.x + dirA*13, -HL+7, HL-7);
      for(let i=1;i<=10;i++){
        const h = dfn[i]; if(!h) continue;
        let x, z;
        if(i <= 4){ x = lineX; z = h.tgt.z*0.8 + bz0*0.28; }                          // défenseurs : alignés, coulissent côté ballon
        else if(i <= 8){ x = lerp(h.tgt.x, cc.pos.x + dirA*6.5, 0.55); z = h.tgt.z*0.7 + bz0*0.35; }  // milieux : entre ballon et but
        else { x = lerp(h.tgt.x, cc.pos.x - dirA*4, 0.35); z = h.tgt.z*0.85 + bz0*0.15; }           // attaquants : restent pour la contre-attaque
        h.tgt.x = lerp(h.tgt.x, clamp(x, -HL+2, HL-2), 0.7); h.tgt.z = lerp(h.tgt.z, clamp(z, -HW+2, HW-2), 0.7);
      }
      // équipe qui attaque : deux soutiens proches (angles de passe), appels en profondeur des attaquants
      const mates = atk.filter((h,i)=> i>0 && h!==cc).sort((a,b)=> Math.hypot(a.pos.x-cc.pos.x,a.pos.z-cc.pos.z) - Math.hypot(b.pos.x-cc.pos.x,b.pos.z-cc.pos.z));
      mates.slice(0,2).forEach((h,k)=>{
        const sideZ = (k===0 ? 1 : -1) * (h.pos.z > cc.pos.z ? 1 : -1);
        h.tgt.x = lerp(h.tgt.x, cc.pos.x + dirA*(k===0 ? 4 : -3), 0.6);
        h.tgt.z = lerp(h.tgt.z, clamp(cc.pos.z + sideZ*10, -HW+2, HW-2), 0.6);
      });
      [9,10].forEach(i=>{
        const h = atk[i]; if(!h || h===cc) return;
        if((cc.pos.x - (cc.side==="us" ? -HL : HL))*dirA > 30){           // ballon dans les 2/3 offensifs : appel
          const onside = lineX - dirA*0.8;                                  // reste en position licite (hors-jeu)
          h.tgt.x = dirA > 0 ? Math.min(cc.pos.x + 18, onside) : Math.max(cc.pos.x - 18, onside);
        }
      });
      // largeur : les latéraux de l'équipe qui attaque restent écartés
      [1,4].forEach(i=>{ const h = atk[i]; if(h && h!==cc) h.tgt.z = lerp(h.tgt.z, (h.tgt.z>0?1:-1)*(HW-6), 0.4); });
    }
    // v45 : le porteur conduit le ballon vers l'avant ; le défenseur le plus proche vient presser
    const c = BS.carrier;
    if(c && !BS.inHands && !c.isGK){
      c.tgt.x = clamp(c.tgt.x + attackDir(c.side)*5, -HL+3, HL-3);
      const opp = c.side==="us" ? teams.them : teams.us;
      let best=null, bd=1e9;
      opp.forEach(h=>{ if(h.isGK) return; const d=Math.hypot(h.pos.x-c.pos.x, h.pos.z-c.pos.z); if(d<bd){ bd=d; best=h; } });
      if(best && bd < 14) best.tgt.set(c.pos.x - attackDir(c.side)*1.9, 0, c.pos.z + (best.pos.z>c.pos.z?0.5:-0.5));
    }
    teams.carrier = BS.carrier;
    const bxw = world.ball.position.x, bzw = world.ball.position.z;
    // gardiens : sur la ligne ballon -> centre du but, plus avancés quand le ballon est loin
    [["us",-1],["them",1]].forEach(([sd, gx])=>{
      const gk = teamArr(sd)[0];
      if(!gk || gk === BS.carrier) return;
      const gxw = gx*HL, dx = bxw - gxw, dz = bzw, d = Math.hypot(dx, dz) || 1;
      const out = clamp(d*0.06, 0.8, 5.5);
      gk.tgt.set(gxw + dx/d*out, 0, clamp(dz/d*out*1.4, -GOAL_W/2+0.3, GOAL_W/2-0.3));
    });
    // arbitre : diagonale, ~12 m du ballon
    teams.ref.tgt.set(clamp(bxw-9, -HL+8, HL-8), 0, clamp(bzw+11, -HW+3, HW-3));
    // juges de touche : alignés sur l'avant-dernier défenseur de chaque moitié
    teams.linesmen[0].tgt.set(clamp(Math.min(bxw, -10), -HL, 0), 0, -HW-1.2);
    teams.linesmen[1].tgt.set(clamp(Math.max(bxw, 10), 0, HL), 0, HW+1.2);
    teams.coach.tgt.set(clamp(bxw*0.08-9, -14, -4), 0, HW+2.2);
    // remplaçants : petites courses d'échauffement le long de la touche
    (teams.subs||[]).forEach(sb=>{ const ph = clock.elapsedTime*0.18 + sb.subPh; sb.tgt.set(-32 + (Math.sin(ph)*0.5+0.5)*24, 0, HW+3.1 + Math.sin(ph*2.3)*0.4); });
    if(snap){ teams.ref.pos.copy(teams.ref.tgt); teams.linesmen.forEach(l=>l.pos.copy(l.tgt)); teams.coach.pos.copy(teams.coach.tgt); }
  }

  // ---------------------------------------------------------------- ballon (v45 : vrai contrôle au pied)
  // Le moteur de match envoie des ACTIONS (Stade3D.onAction) : gain, pass, dribble, shot, intercept,
  // foul, kickoff. Elles sont jouées dans l'ordre, physiquement : le passeur va au ballon, arme sa
  // frappe, le ballon part de SON pied vers le point de réception, le receveur court à sa rencontre
  // et le contrôle ; le porteur conduit le ballon par petites touches synchronisées avec ses pas.
  // Si la file s'allonge (rythme "Rapide"), le temps des actions est accéléré (timeScale).
  const BS = {mode:"dead", carrier:null, pos:new T.Vector3(0,0.11,0), prev:new T.Vector3(), vel:new T.Vector3(),
    ahead:0.45, bs:0, lat:0, latT:0, flight:null, needsRestart:false, inHands:false, footSide:1};
  let queue = [], act = null, timeScale = 1, pendingGoal = null, lastGoalAt = -99;
  const dbg = {done:0, pushed:0, simT:0, kinds:{}, time:{}};
  const _f = new T.Vector3(), _g = new T.Vector3();
  function teamArr(side){ return side==="us" ? teams.us : teams.them; }
  function pl(side, i){ return teamArr(side)[clamp((i|0), 0, 10)]; }
  function fwdOf(h, out){ return out.set(Math.sin(h.heading), 0, Math.cos(h.heading)); }
  function footOf(h, out){ fwdOf(h, out); return out.multiplyScalar(0.42).add(h.pos).setY(0.11); }
  function attackDir(side){ return side==="us" ? 1 : -1; }
  function resetBall(m){
    BS.mode = "dead"; BS.carrier = null; BS.flight = null; BS.inHands = false; BS.needsRestart = false;
    BS.pos.set(m && m.pos ? toX(m.pos.ball.x) : 0, 0.11, m && m.pos ? toZ(m.pos.ball.y) : 0); BS.prev.copy(BS.pos);
    queue = []; act = null; pendingGoal = null;
    if(teams) teams.carrier = null;
  }
  function clearOv(h){ if(h){ h.override = null; } }
  function giveTo(h, opts){
    BS.vy = 0;
    // contrôle de la poitrine / de la cuisse si le ballon arrive haut
    if(BS.pos.y > 0.9 && !(opts && opts.hands)){ h.chest = 1; }
    BS.carrier = h; BS.mode = "held"; BS.flight = null; BS.ahead = 0.45; BS.bs = h.speed; BS.lat = 0;
    BS.inHands = !!(opts && opts.hands); BS.needsRestart = false;
    teams.carrier = h; h.override = null;
    if(!(opts && opts.silent) && !BS.inHands){ h.kick = 1; h.kickAmp = 0.3; }   // contrôle orienté
  }
  function sfx(name, arg){ try{ if(typeof SFX !== "undefined" && SFX[name]) SFX[name](arg); }catch(e){} }
  function launch(target, speed, h, onEnd){
    sfx("kick", speed/30);   // le bruit de frappe part au moment exact où le ballon quitte le pied
    BS.mode = "flight"; BS.carrier = null; BS.inHands = false;
    const from = BS.pos.clone(); if(from.y < 0.11) from.y = 0.11;
    const dist = Math.hypot(target.x-from.x, target.z-from.z);
    let dur = clamp(dist/speed, 0.12, 2.4);
    if((h||0) > 1.2) dur = Math.max(dur, Math.sqrt(8*h/9.81));   // un ballon aérien met le temps de la gravité
    BS.flight = {from, to:target.clone(), t:0, dur, h:h||0, onEnd};
    teams.carrier = null;
  }
  // Fait venir le joueur h au ballon (ou le lui fait récupérer). true quand h a le ballon au pied.
  function acquire(h, a){
    if(BS.carrier === h) return true;
    if(BS.mode === "dead" && (BS.needsRestart || a.restart)){
      // remise en jeu (sortie de but, touche) : le ballon est replacé aux pieds du joueur
      if((a.wait = (a.wait||0)) < 0.45) return false;
      footOf(h, BS.pos); BS.prev.copy(BS.pos); giveTo(h, {silent:true}); return true;
    }
    if(BS.mode === "flight"){ h.override = _g.copy(BS.flight.to).setY(0).clone(); return false; }
    if(BS.carrier && BS.carrier !== h && BS.carrier.side === h.side){
      // coéquipier au ballon : il lui donne (passe courte immédiate, pas un tacle !)
      if(!a.relay){
        a.relay = true; const c = BS.carrier;
        faceTo(c, h.pos.x, h.pos.z, 0.4); c.kick = 1; c.kickAmp = 0.7;
        launch(footOf(h, _f.clone()), a.rush ? 30 : 16, 0.05, ()=>{ giveTo(h); });
      }
      return false;
    }
    if(BS.carrier && BS.carrier !== h){
      // duel : le joueur presse le porteur et tacle quand il est au contact
      const c = BS.carrier;
      h.override = _g.set(c.pos.x + Math.sin(c.heading)*0.9, 0, c.pos.z + Math.cos(c.heading)*0.9).clone();
      if(Math.hypot(h.pos.x-c.pos.x, h.pos.z-c.pos.z) < 1.7 || a.t > (a.rush ? 0.4 : 1.5)){
        h.kick = 1; h.kickAmp = 0.85;                 // jambe tendue : tacle
        c.stun = 0.9; c.override = null;
        if(c.isGK) BS.inHands = false;
        giveTo(h, {silent:true}); return true;
      }
      return false;
    }
    // ballon libre ou arrêté : on court dessus
    h.override = _g.copy(BS.pos).setY(0).clone();
    footOf(h, _f);
    if(_f.distanceTo(BS.pos) < 0.75 || Math.hypot(h.pos.x-BS.pos.x, h.pos.z-BS.pos.z) < 0.7){ giveTo(h); return true; }
    if(a.t > (a.rush ? 0.5 : 2.4) && !a.magnet){
      // trop loin (file en retard) : le ballon lui est "servi" pour ne pas bloquer la suite
      a.magnet = true; launch(footOf(h, _f.clone()), 24, 0.2, ()=>{ giveTo(h); });
    }
    return false;
  }
  function faceTo(h, x, z, dur){ h.faceTo = {x, z}; h.faceT = dur||0.5; }

  const PASS_SPEED = {courte:16, retrait:15, avant:20, longue:24, centre:21};
  function stepAction(a, dt){
    a.t += dt; a.wait = (a.wait||0) + dt;
    const k = a.kind;
    if(k === "gain" || k === "intercept"){
      const h = pl(a.side, a.who);
      return acquire(h, a);
    }
    if(k === "foul"){
      if(a.stage === 0){
        if(BS.carrier){ BS.carrier.stun = 0.6; }
        BS.mode = "dead"; BS.carrier = null; BS.flight = null; BS.needsRestart = false; teams.carrier = null;
        a.stage = 1; a.t = 0; return false;
      }
      if(a.stage === 1){ if(a.t < 0.7) return false; a.stage = 2; a.t = 0; }
      return acquire(pl(a.side, a.who), a);
    }
    if(k === "kickoff"){
      if(a.stage === 0){
        if(RP.on || RP.pendingAt) return false;                                          // attendre la fin du ralenti
        if(clock.elapsedTime - lastGoalAt < 3.6 && a.t < 6 && !a.rush) return false;   // laisser vivre la célébration
        BS.mode = "dead"; BS.carrier = null; BS.flight = null; BS.needsRestart = false; BS.inHands = false;
        BS.pos.set(0, 0.11, 0); BS.prev.copy(BS.pos); teams.carrier = null;
        // l'attaquant se place au rond central pour donner le coup d'envoi
        const gs = attackDir(a.side), taker = pl(a.side, 9), mate = pl(a.side, 10);
        taker.pos.set(-gs*0.5, 0, 0.3); taker.vel.set(0,0,0); taker.heading = gs>0 ? Math.PI/2 : -Math.PI/2;
        mate.pos.set(-gs*1.5, 0, -2.5); mate.vel.set(0,0,0);
        a.stage = 1; a.t = 0;
      }
      return acquire(pl(a.side, 9), a);
    }
    if(k === "pass"){
      const from = pl(a.side, a.from), to = pl(a.side, a.to);
      if(a.stage === 0){ if(!acquire(from, a)) return false; a.stage = 1; a.t = 0; faceTo(from, to.tgt.x, to.tgt.z, 0.6); from.kick = 1; from.kickAmp = (a.type==="longue"||a.type==="centre") ? 1.15 : 0.75; }
      if(a.stage === 1){
        if(a.t < (a.rush ? 0.06 : 0.2)) return false;     // armé de la frappe : le ballon part au contact
        if(a.header){   // centre pour une tête : le ballon est envoyé sur la tête du receveur
          const tg = new T.Vector3(clamp(to.tgt.x, -HL+2, HL-2), 1.9, clamp(to.tgt.z, -HW+2, HW-2));
          launch(tg, 21, 2.4); to.override = tg.clone().setY(0);
          a.stage = 3; a.t = 0; return false;
        }
        // point de rencontre : là où le receveur PEUT être quand le ballon arrive (pas une case idéale)
        const want = _g.set(clamp(to.tgt.x, -HL+0.5, HL-0.5), 0, clamp(to.tgt.z, -HW+0.5, HW-0.5));
        const spd = (PASS_SPEED[a.type] || 15) * (a.rush ? 1.8 : 1);
        const T0 = Math.hypot(want.x-BS.pos.x, want.z-BS.pos.z)/spd + 0.15;
        const run = Math.hypot(want.x-to.pos.x, want.z-to.pos.z), reach = 6.5*T0;
        const tgt = run > reach ? new T.Vector3(to.pos.x + (want.x-to.pos.x)*reach/run, 0.11, to.pos.z + (want.z-to.pos.z)*reach/run) : new T.Vector3(want.x, 0.11, want.z);
        const dist = Math.hypot(tgt.x-BS.pos.x, tgt.z-BS.pos.z);
        const h = a.type==="longue" ? 1 + dist*0.1 : a.type==="centre" ? 2.6 : a.type==="avant" ? 0.35 : 0.05;
        launch(tgt, spd, h);
        to.override = tgt.clone().setY(0);
        a.stage = 2; a.t = 0; return false;
      }
      if(a.stage === 3) return BS.mode !== "flight" || BS.flight.t > 0.75;   // la tête suit : pas de contrôle
      if(BS.mode === "flight") faceTo(to, BS.pos.x, BS.pos.z, 0.15);       // le receveur s'ouvre vers le ballon
      if(BS.mode === "flight") return false;
      // contrôle : le receveur tend la jambe s'il est à portée
      if(BS.mode === "loose" && Math.hypot(to.pos.x-BS.pos.x, to.pos.z-BS.pos.z) < 1.7){ giveTo(to); return true; }
      if(BS.mode === "loose") BS.vel.multiplyScalar(0.6);
      return acquire(to, a);
    }
    if(k === "dribble"){
      const who = pl(a.side, a.who), def = pl(a.side==="us"?"them":"us", a.past);
      if(a.stage === 0){
        if(!acquire(who, a)) return false;
        a.stage = 1; a.t = 0; a.dir = Math.random()<0.5 ? -1 : 1;
      }
      fwdOf(who, _f);
      const sideV = _g.set(_f.z, 0, -_f.x);                 // vecteur latéral
      if(a.stage === 1){
        // le défenseur sort au contact
        def.override = new T.Vector3(who.pos.x + _f.x*2.2, 0, who.pos.z + _f.z*2.2);
        who.override = new T.Vector3(who.pos.x + attackDir(a.side)*3, 0, who.pos.z);
        if(Math.hypot(def.pos.x-who.pos.x, def.pos.z-who.pos.z) > 2.8 && a.t < 1.6) return false;
        a.stage = 2; a.t = 0;
        who.feint = {t:0, dir:a.dir, kind:a.move||"crochet"};
        if(a.move === "petitpont"){
          const through = new T.Vector3(who.pos.x + _f.x*4.2, 0.11, who.pos.z + _f.z*4.2);
          launch(through, 9, 0.02);
          who.override = through.clone().add(sideV.clone().multiplyScalar(a.dir*1.1)).setY(0);
        } else {
          BS.lat = a.dir * (a.move==="passement" ? 0.9 : 1.15);   // le ballon est emmené sur le côté
          who.override = new T.Vector3(who.pos.x + _f.x*1.2 + sideV.x*a.dir*1.4, 0, who.pos.z + _f.z*1.2 + sideV.z*a.dir*1.4);
        }
        return false;
      }
      if(a.stage === 2){
        if(a.t < (a.move==="roulette" ? 0.55 : 0.38)) return false;
        def.stun = 1.1; def.override = null;               // le défenseur est pris à contre-pied
        if(a.move === "petitpont"){ a.stage = 3; a.t = 0; return false; }
        BS.bs = who.speed*1.4 + 4;                          // grosse touche pour partir
        who.override = new T.Vector3(who.pos.x + attackDir(a.side)*6 + sideV.x*a.dir*0.6, 0, who.pos.z + sideV.z*a.dir*0.6);
        a.stage = 3; a.t = 0; return false;
      }
      if(a.move === "petitpont"){ if(BS.mode === "flight") return false; if(!acquire(who, a)) return false; }
      if(a.t < 0.7) return false;
      BS.lat = 0; clearOv(who); return true;
    }
    if(k === "shot"){
      const sh = pl(a.side, a.who), gs = attackDir(a.side);
      const gk = a.side==="us" ? teams.them[0] : teams.us[0];
      if(a.stage === 0 && a.header){
        // reprise de la tête sur un centre : le tireur attaque le ballon en l'air, sans contrôle
        if(BS.mode === "flight"){ sh.override = _g.copy(BS.flight.to).setY(0).clone(); if(BS.flight.t < 0.78) return false; }
        sh.jump = 1; faceTo(sh, gs*HL, 0, 0.6);
        BS.carrier = null; BS.flight = null; BS.mode = "loose"; BS.pos.set(sh.pos.x + Math.sin(sh.heading)*0.2, 1.95, sh.pos.z + Math.cos(sh.heading)*0.2);
        a.stage = 1; a.t = 0.2;
      }
      if(a.stage === 0){
        if(!acquire(sh, a)) return false;
        a.stage = 1; a.t = 0; faceTo(sh, gs*HL, 0, 0.6); sh.kick = 1; sh.kickAmp = 1.45;
        gk.setT = 0.7;
      }
      if(a.stage === 1){
        if(a.t < 0.26) return false;
        const o = a.outcome, side = Math.random()<0.5 ? -1 : 1;
        let tgt, speed = a.header ? rnd(15,19) : rnd(26,31), h = 0, onEnd;
        if(o === "goal"){
          tgt = new T.Vector3(gs*(HL+0.9), 0.11, side*rnd(0.6, GOAL_W/2-0.35)); h = rnd(0.1, 1.7);
          gk.diveDir = Math.sign((-tgt.z) - gk.pos.z || 1) * (gs>0 ? -1 : 1); gk.dive = Math.random()<0.6 ? 1 : 0;   // plonge du mauvais côté / trop tard
          onEnd = ()=>{ sfx("net"); BS.mode = "dead"; BS.vel.set(0,0,0); BS.pos.y = 0.3; world.goals[gs>0?1:0].bulge = 1; BS.needsRestart = false; if(pendingGoal){ celebrate(pendingGoal); pendingGoal = null; } else a.goalHit = true; };
        } else if(o === "saved"){
          tgt = new T.Vector3(gs*(HL-0.35), 0.11, clamp(gk.pos.z + side*rnd(0.4,1.6), -GOAL_W/2+0.4, GOAL_W/2-0.4)); h = rnd(0.2, 0.9);
          gk.diveDir = Math.sign(tgt.z - gk.pos.z || 1) * (gs>0 ? -1 : 1); gk.dive = Math.abs(tgt.z-gk.pos.z) > 0.9 ? 1 : 0;
          gk.override = new T.Vector3(tgt.x, 0, tgt.z);
          onEnd = ()=>{ giveTo(gk, {hands:true}); };
        } else if(o === "save-great"){
          tgt = new T.Vector3(gs*(HL-0.2), 0.11, side*rnd(2.6, GOAL_W/2-0.2)); h = rnd(1.0, 1.6);
          gk.diveDir = Math.sign(tgt.z - gk.pos.z || 1) * (gs>0 ? -1 : 1); gk.dive = 1;
          onEnd = ()=>{ BS.mode = "loose"; BS.vel.set(gs*rnd(1,3), 0, side*rnd(7,10)); BS.lat=0; setTimeout(()=>{ if(BS.mode==="loose"){ BS.mode="dead"; BS.needsRestart=true; } }, 900); };
        } else if(o === "post"){
          tgt = new T.Vector3(gs*HL, 0.11, side*GOAL_W/2); h = rnd(0.5, 1.2);
          onEnd = ()=>{ sfx("post"); BS.mode = "loose"; BS.vel.set(-gs*rnd(7,11), 0, rnd(-4,4)); };
        } else if(o === "corner"){
          tgt = new T.Vector3(gs*(HL+1.5), 0.11, side*rnd(GOAL_W/2+3, 14)); speed = rnd(18,24); h = 0.6;
          gk.diveDir = Math.sign(tgt.z - gk.pos.z || 1) * (gs>0 ? -1 : 1); gk.dive = Math.random()<0.5?1:0;
          onEnd = ()=>{ BS.mode = "dead"; BS.needsRestart = true; sfx("ooh"); };
        } else {   // "off" : à côté ou au-dessus
          const over = Math.random() < 0.4;
          tgt = new T.Vector3(gs*(HL+6), 0.11, over ? side*rnd(0, 3) : side*rnd(GOAL_W/2+0.8, GOAL_W/2+6)); h = over ? 3.6 : rnd(0.2, 1.8);
          onEnd = ()=>{ BS.mode = "dead"; BS.needsRestart = true; sfx("ooh"); };
        }
        launch(tgt, speed, h, onEnd);
        a.stage = 2; a.t = 0; return false;
      }
      if(BS.mode === "flight") return false;
      if(a.t < 0.35) return false;
      clearOv(gk); return true;
    }
    return true;   // action inconnue : ignorée
  }

  function updateBallSystem(dt){
    dbg.simT += dt;
    // file d'actions (accélérée si elle s'allonge)
    timeScale = queue.length > 1 ? Math.min(3.2, 1 + (queue.length-1)*0.55) : 1;
    if(queue.length > 5){ queue.forEach(q=> q.rush = true); if(act) act.rush = true; }   // gros retard : on enchaîne vite
    const sdt = dt*timeScale;
    let guard = 0;
    while(guard++ < 3){
      if(!act){ if(!queue.length) break; act = queue.shift(); act.t = 0; act.stage = 0; }
      if(stepAction(act, guard===1 ? sdt : 0)){ dbg.done++; dbg.kinds[act.kind]=(dbg.kinds[act.kind]||0)+1; dbg.time[act.kind]=(dbg.time[act.kind]||0)+act.t; act = null; continue; }
      break;
    }
    BS.prev.copy(BS.pos);
    if(BS.mode === "flight"){
      const F = BS.flight; F.t = Math.min(1, F.t + sdt/F.dur);
      const e = F.t;
      // au sol : le ballon part vite puis ralentit (frottement) ; en l'air : vraie parabole
      const eg = F.h < 0.5 ? 1 - Math.pow(1-e, 1.6) : e;
      BS.pos.lerpVectors(F.from, F.to, eg);
      BS.pos.y = Math.max(0.11, lerp(F.from.y, F.to.y, e) + 4*F.h*e*(1-e));
      if(F.t >= 1){
        BS.vel.subVectors(F.to, F.from).setY(0).normalize().multiplyScalar(Math.min(6, F.from.distanceTo(F.to)/F.dur*0.25));
        BS.vy = F.h > 0.8 ? 4*F.h/F.dur*0.42 : 0;     // rebond à l'arrivée d'un ballon aérien
        BS.flight = null; BS.mode = "loose";
        if(F.onEnd) F.onEnd();
      }
    } else if(BS.mode === "loose"){
      BS.vel.y = 0; BS.vel.multiplyScalar(Math.exp(-1.4*dt));
      BS.pos.addScaledVector(BS.vel, dt);
      // gravité + rebonds amortis
      BS.vy = (BS.vy||0) - 9.81*dt; BS.pos.y += BS.vy*dt;
      if(BS.pos.y <= 0.11){ BS.pos.y = 0.11; BS.vy = Math.abs(BS.vy) > 1.2 ? -BS.vy*0.45 : 0; }
      BS.pos.x = clamp(BS.pos.x, -HL-4, HL+4); BS.pos.z = clamp(BS.pos.z, -HW-3, HW+3);
      if(!act){   // personne n'est chargé de le récupérer : le plus proche s'en occupe
        let best=null, bd=1e9;
        teams.us.concat(teams.them).forEach(h=>{ const d=Math.hypot(h.pos.x-BS.pos.x, h.pos.z-BS.pos.z); if(d<bd){ bd=d; best=h; } });
        if(best){ if(bd < 0.8) giveTo(best); else best.override = BS.pos.clone().setY(0); }
      }
    } else if(BS.mode === "held"){
      const h = BS.carrier;
      fwdOf(h, _f);
      if(BS.inHands){
        _g.set(h.pos.x + _f.x*0.32, 1.05 + h.body.position.y, h.pos.z + _f.z*0.32);
      } else {
        // conduite de balle : touche quand le ballon revient dans les pieds, puis il file devant
        const s = h.speed;
        BS.bs = lerp(BS.bs, s*0.82, damp(1.3, dt));
        BS.ahead += (BS.bs - s)*dt;
        if(s > 1.3 && BS.ahead < 0.34){ BS.ahead = 0.36; BS.bs = s*1.35 + 1.1; h.kick = 1; h.kickAmp = 0.28; BS.footSide = -BS.footSide; }
        if(s <= 1.3) BS.ahead = lerp(BS.ahead, 0.42, damp(3,dt));
        BS.ahead = clamp(BS.ahead, 0.3, 1.5);
        const latV = _g.set(_f.z, 0, -_f.x).multiplyScalar(BS.lat + BS.footSide*0.07);
        _g.set(h.pos.x + _f.x*BS.ahead + latV.x, 0.11, h.pos.z + _f.z*BS.ahead + latV.z);
      }
      BS.pos.lerp(_g, damp(BS.inHands ? 20 : 16, dt));
      BS.lat = lerp(BS.lat, 0, damp(1.2, dt));
    }
    // rotation réaliste du ballon selon son déplacement
    const dx = BS.pos.x-BS.prev.x, dz = BS.pos.z-BS.prev.z, d = Math.hypot(dx,dz);
    if(d > 1e-4 && !BS.inHands){ const ax = _ax.set(dz,0,-dx).normalize(); world.ball.rotateOnWorldAxis(ax, d/0.11); }
    world.ball.position.copy(BS.pos);
  }

  function celebrate(g){
    const ours = g.side === "us";
    const goalSide = ours ? 1 : -1;
    lastGoalAt = clock.elapsedTime;
    world.goalPulse = ours ? 1.4 : 0.6;
    const team = ours ? teams.us : teams.them;
    const scorer = team[g.idx] || team[9];
    teams.scorer = scorer;
    const corner = new T.Vector3(goalSide*(HL-2), 0, (scorer.pos.z>0?1:-1)*(HW-2));
    team.forEach((h,i)=>{ h.celebrate = i===0 ? 0.6 : 1.6; h.override = null; h.runTo = i===0 ? null : corner.clone().add(new T.Vector3(rnd(-3,3),0,rnd(-3,3))); });
    scorer.runTo = corner;
    if(ours){ teams.coach.celebrate = 1.5; launchConfetti(teams.kits.us.slice(0,3).concat(["#d4af37"])); }
    camState.goalCam = 3.2;
    RP.goalT = clock.elapsedTime; RP.gs = goalSide; RP.pendingAt = clock.elapsedTime + 2.6;
  }

  // ---------------------------------------------------------------- simulation des joueurs
  const _v1 = new T.Vector3(), _v2 = new T.Vector3(), _dummy = new T.Object3D(), _ax = new T.Vector3();
  function updatePlayers(dt, t){
    const bp = world.ball.position;
    teams.all.forEach(h=>{
      h.smoothTgt.lerp(h.tgt, damp(h===teams.carrier ? 5 : 2.2, dt));
      const goal = h.override || h.smoothTgt;
      const desired = _v1.subVectors(goal, h.pos); desired.y = 0;
      const dist = desired.length();
      let maxSp = h.isCoach ? 1.6 : (h.isGK ? (h.override ? 6.5 : 5) : (h.override ? 8.3 : (h===teams.carrier ? 7.6 : 7.2)));
      if(h.stun > 0){ maxSp *= 0.3; h.stun = Math.max(0, h.stun - dt); }
      // v49 : loin de l'action on trottine, près du ballon on sprinte
      if(!h.override && !h.isCoach && h !== teams.carrier){
        const dB = Math.hypot(bp.x-h.pos.x, bp.z-h.pos.z);
        maxSp *= dB < 15 ? 1 : dB < 30 ? 0.72 : 0.5;
      }
      const want = Math.min(maxSp, dist*1.6);
      if(dist>0.001) desired.multiplyScalar(want/dist);
      // accélération physiquement limitée (~7 m/s²) : plus de démarrages instantanés
      _v2.subVectors(desired, h.vel); const dv = _v2.length(), maxDv = (h.override ? 9 : 7)*dt;
      if(dv > maxDv) _v2.multiplyScalar(maxDv/dv);
      h.vel.add(_v2);
      if(h.celebrate>0.3 && h.runTo){ const d2 = _v2.subVectors(h.runTo, h.pos); d2.y=0; const l=d2.length(); if(l>1){ d2.multiplyScalar(Math.min(8.5,l*2)/l); h.vel.lerp(d2, damp(5,dt)); } }
      h.pos.addScaledVector(h.vel, dt);
      h.speed = h.vel.length();
      // orientation : sens de course si rapide, sinon regard vers le ballon
      let face;
      if(h.faceT > 0 && h.faceTo){ face = Math.atan2(h.faceTo.x-h.pos.x, h.faceTo.z-h.pos.z); h.faceT -= dt; }
      else if(cur.showcase && !h.isCoach) face = 0;
      else if(h.isCoach) face = Math.atan2(bp.x-h.pos.x, bp.z-h.pos.z);
      else if(h.speed > 1.2 && h.speed < 5.5 && teams.carrier && h.side !== teams.carrier.side && !h.override && !h.isRef && !h.isLinesman
              && Math.hypot(bp.x-h.pos.x, bp.z-h.pos.z) < 18){ face = Math.atan2(bp.x-h.pos.x, bp.z-h.pos.z); }   // défenseur : recule face au jeu
      else if(h.speed > 1.2) face = Math.atan2(h.vel.x, h.vel.z);
      else face = Math.atan2(bp.x-h.pos.x, bp.z-h.pos.z);
      let dh = face - h.heading; while(dh>Math.PI) dh-=Math.PI*2; while(dh<-Math.PI) dh+=Math.PI*2;
      const dHead = dh*damp(7,dt);
      h.heading += dHead; h.turnRate = dHead/Math.max(dt,1e-3);
      h.backward = h.speed > 0.8 && (h.vel.x*Math.sin(h.heading) + h.vel.z*Math.cos(h.heading))/h.speed < -0.3;
      // la tête suit le ballon (dans la limite d'une rotation naturelle du cou)
      if(!h.isCoach){
        let ly = Math.atan2(bp.x-h.pos.x, bp.z-h.pos.z) - h.heading; while(ly>Math.PI) ly-=Math.PI*2; while(ly<-Math.PI) ly+=Math.PI*2;
        h.lookYaw = clamp(ly, -1.1, 1.1);
        const dd = Math.hypot(bp.x-h.pos.x, bp.z-h.pos.z);
        h.lookPitch = clamp(Math.atan2(1.6 - bp.y, dd) * 0.6, -0.5, 0.55);
      }
      h.root.position.copy(h.pos);
      h.root.rotation.y = h.heading;
      poseHumanoid(h, dt, t);
      if(h.isCoach){ // gestes d'encouragement
        h.armR.sh.rotation.x = -0.6 - Math.max(0, Math.sin(t*2.1))*0.9*world.excite;
        h.armL.sh.rotation.x = -0.2;
      }
      if(h.isLinesman){ h.armR.sh.rotation.x = -0.15; }
      h.restPose = !h.isGK && !h.isRef && !h.isLinesman && Math.hypot(bp.x-h.pos.x, bp.z-h.pos.z) > 38;
      if(h === BS.carrier && BS.inHands){ h.armL.sh.rotation.x = -1.2; h.armR.sh.rotation.x = -1.2; h.armL.sh.rotation.z = 0.25; h.armR.sh.rotation.z = -0.25; }
      else if(h.isGK && h.dive<=0 && h.celebrate<=0){
        // posture d'attente du gardien quand le ballon approche
        const near = clamp(1 - Math.abs(bp.x - h.pos.x)/30, 0, 1);
        h.armL.sh.rotation.z = 0.12 + near*0.6; h.armR.sh.rotation.z = -0.12 - near*0.6;
        h.spine.rotation.x += near*0.25;
      }
    });
    // ombres multiples
    const dummy = _dummy;
    const offs = [[0.55,0.45],[-0.55,0.45],[0.55,-0.45],[-0.55,-0.45]];
    let k=0;
    teams.all.forEach(h=>{
      if(k >= 30*4) return;
      const lift = h.body.position.y;
      offs.forEach(o=>{
        dummy.position.set(h.pos.x+o[0]*0.9, 0.012+k*0.00002, h.pos.z+o[1]*0.9);
        const s = clamp(1.25 - lift*0.6, 0.4, 1.3);
        dummy.scale.set(s*1.5, 1, s*0.75);
        dummy.rotation.set(0, Math.atan2(o[0],o[1]), 0);
        dummy.updateMatrix(); world.blobs.setMatrixAt(k++, dummy.matrix);
      });
    });
    world.blobs.count = k;
    world.blobs.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- caméra
  const camState = {pos:new T.Vector3(0,30,90), look:new T.Vector3(), fov:30, goalCam:0, orbit:0};
  function updateCamera(dt, t){
    const b = world.ball.position;
    const aspect = camera.aspect;
    const narrow = aspect < 1.2;
    let p = new T.Vector3(), l = new T.Vector3(), fov = 30;
    const mode = CAM_MODES[camMode];
    let modeKey = mode;
    if(cur.showcase){
      modeKey = "showcase";
      // travelling lent le long de l'alignement des joueurs
      const a = Math.sin(t*0.12)*1.05;
      p.set(Math.sin(a)*15, 2.2 + Math.sin(t*0.07)*0.6, 4 + Math.cos(a)*15); l.set(Math.sin(a)*5, 1.25, 4); fov = narrow?50:34;
    } else if(camState.goalCam > 0 && teams && teams.scorer){
      // plan serré sur le buteur pendant la célébration
      const s = teams.scorer.pos;
      const ang = t*0.35;
      p.set(s.x + Math.sin(ang)*7, 2.4, s.z + Math.cos(ang)*7);
      l.set(s.x, 1.3, s.z); fov = 38;
      camState.goalCam -= dt;
    } else if(mode==="TV"){
      // nacelle TV en haut de l'anneau inférieur (devant l'anneau supérieur : jamais dans le béton)
      p.set(b.x*0.8, narrow?21:17, HW+26); l.set(b.x*0.95, 0, b.z*0.4); fov = narrow?42:27;
    } else if(mode==="Proche"){
      p.set(b.x*0.92, 13, Math.min(HW+16, b.z+30)); l.set(b.x, 0.6, b.z); fov = narrow?44:32;
    } else if(mode==="Tactique"){
      // vue 2.5D façon tableau tactique : haute et inclinée, tout le bloc visible (sous l'ouverture du toit)
      p.set(b.x*0.45, narrow?96:80, 24 + b.z*0.1); l.set(b.x*0.55, 0, b.z*0.2 - 3); fov = narrow?48:42;
    } else if(mode==="Tribune"){
      const side = b.x>0 ? 1 : -1;
      p.set(-side*(HL+24), 22, b.z*0.3); l.set(b.x*0.6+side*10, 0, b.z*0.6); fov = narrow?52:40;
    } else {
      camState.orbit += dt*0.07;
      // drone dans l'ouverture du toit (au-dessus du toit, celui-ci masquait le terrain)
      p.set(Math.cos(camState.orbit)*56, 44, Math.sin(camState.orbit)*38); l.set(b.x*0.4, 0, b.z*0.4); fov = narrow ? 60 : 50;
    }
    if(camState.snap){ camState.pos.copy(p); camState.look.copy(l); camState.fov = fov; camState.snap = false; }
    // changement de plan franc (comme en régie) plutôt qu'un travelling qui traverserait les tribunes
    if(camState.lastMode !== modeKey || camState.wasGoal !== (camState.goalCam>0)){
      camState.lastMode = modeKey; camState.wasGoal = camState.goalCam>0;
      camState.pos.copy(p); camState.look.copy(l); camState.fov = fov;
    }
    const k = camState.goalCam>0 ? damp(3,dt) : damp(2.4,dt);
    camState.pos.lerp(p, k); camState.look.lerp(l, damp(3.2,dt));
    camState.fov = lerp(camState.fov, fov, damp(2,dt));
    // léger tremblé "caméra à l'épaule" + vibration sur les buts
    const shake = world.goalPulse*0.25;
    camera.position.set(camState.pos.x + Math.sin(t*1.3)*0.05 + rnd(-shake,shake), camState.pos.y + Math.sin(t*0.9)*0.04 + rnd(-shake,shake), camState.pos.z);
    camera.lookAt(camState.look);
    if(Math.abs(camera.fov-camState.fov)>0.01){ camera.fov = camState.fov; camera.updateProjectionMatrix(); }
  }

  // ---------------------------------------------------------------- écrans géants
  let lastScreenKey = "";
  function updateScreens(m){
    const key = [m.us, m.them, m.minute, m.opp].join("|");
    if(key === lastScreenKey) return;
    lastScreenKey = key;
    const usName = m.ctx==="club" ? clubName() : "FRANCE";
    world.screens.forEach(tex=>{
      const g = tex.userData.ctx, w = 512, h = 192;
      const grd = g.createLinearGradient(0,0,0,h); grd.addColorStop(0,"#0b1430"); grd.addColorStop(1,"#03060f");
      g.fillStyle = grd; g.fillRect(0,0,w,h);
      g.fillStyle = teams.kits.us[0]; g.fillRect(18,40,14,70);
      g.fillStyle = teams.kits.them[0]; g.fillRect(w-32,40,14,70);
      g.fillStyle = "#fff"; g.font = "bold 34px 'Barlow Condensed', sans-serif"; g.textBaseline = "middle";
      g.textAlign = "left"; g.fillText(usName.toUpperCase().slice(0,12), 42, 75);
      g.textAlign = "right"; g.fillText(String(m.opp).toUpperCase().slice(0,12), w-42, 75);
      g.textAlign = "center"; g.fillStyle = "#d4af37"; g.font = "bold 74px 'Bebas Neue', sans-serif";
      g.fillText(`${m.us} - ${m.them}`, w/2, 80);
      g.fillStyle = "#cfd6e6"; g.font = "bold 30px 'Barlow Condensed', sans-serif";
      g.fillText(`${m.minute}'${m.finalWhistlePlayed?" · FIN":""}`, w/2, 150);
      g.fillStyle = "rgba(255,255,255,0.05)"; for(let y=0;y<h;y+=3) g.fillRect(0,y,w,1);
      tex.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- ralentis (v47)
  // Enregistreur circulaire : à chaque image, pose complète des 26 personnages + ballon + filets.
  // Après un but, on rejoue les ~5 dernières secondes au ralenti sous un autre angle, puis on
  // restaure l'instant présent (la simulation est figée pendant le ralenti).
  const REC = {cap:420, per:28, stride:0, buf:null, times:null, head:0, count:0, objs:null, snap:null};
  const RP = {on:false, pendingAt:0, goalT:0, t0:0, t1:0, cur:0, speed:0.6, gs:1, angle:0};
  const _q1 = new T.Quaternion(), _q2 = new T.Quaternion();
  function jointsOf(h){ return [h.root, h.body, h.spine, h.headG, h.legL.hp, h.legL.kn, h.legR.hp, h.legR.kn, h.armL.sh, h.armL.el, h.armR.sh, h.armR.el]; }
  function recInit(){
    REC.objs = teams.all.map(jointsOf);
    REC.stride = REC.objs.length*REC.per + 7 + 2 + 3;
    REC.buf = new Float32Array(REC.cap*REC.stride); REC.times = new Float32Array(REC.cap);
    REC.snap = new Float32Array(REC.stride);
    REC.head = 0; REC.count = 0; RP.on = false; RP.pendingAt = 0;
  }
  function recWrite(arr, o){
    for(const j of REC.objs){
      arr[o++]=j[0].position.x; arr[o++]=j[0].position.y; arr[o++]=j[0].position.z; arr[o++]=j[0].rotation.y;
      arr[o++]=j[1].position.x; arr[o++]=j[1].position.y; arr[o++]=j[1].rotation.x; arr[o++]=j[1].rotation.y; arr[o++]=j[1].rotation.z;
      arr[o++]=j[2].rotation.x; arr[o++]=j[3].rotation.x; arr[o++]=j[3].rotation.y;
      for(let k=4;k<12;k++){ arr[o++]=j[k].rotation.x; arr[o++]=j[k].rotation.z; }
    }
    const b = world.ball; arr[o++]=b.position.x; arr[o++]=b.position.y; arr[o++]=b.position.z;
    arr[o++]=b.quaternion.x; arr[o++]=b.quaternion.y; arr[o++]=b.quaternion.z; arr[o++]=b.quaternion.w;
    arr[o++]=world.goals[0].back.position.x; arr[o++]=world.goals[1].back.position.x;
    arr[o++]=world.ring.visible?1:0; arr[o++]=world.ring.position.x; arr[o++]=world.ring.position.z;
  }
  function recApply(A, oa, B, ob, u){
    const L = (i)=> A[oa+i] + (B[ob+i]-A[oa+i])*u;
    let i = 0;
    for(const j of REC.objs){
      j[0].position.set(L(i),L(i+1),L(i+2)); j[0].rotation.y = L(i+3);
      j[1].position.x = L(i+4); j[1].position.y = L(i+5); j[1].rotation.set(L(i+6),L(i+7),L(i+8));
      j[2].rotation.x = L(i+9); j[3].rotation.x = L(i+10); j[3].rotation.y = L(i+11);
      let k2 = i+12; for(let k=4;k<12;k++){ j[k].rotation.x = L(k2); j[k].rotation.z = L(k2+1); k2+=2; }
      i += REC.per;
    }
    world.ball.position.set(L(i),L(i+1),L(i+2));
    _q1.set(A[oa+i+3],A[oa+i+4],A[oa+i+5],A[oa+i+6]); _q2.set(B[ob+i+3],B[ob+i+4],B[ob+i+5],B[ob+i+6]);
    world.ball.quaternion.copy(_q1).slerp(_q2, u);
    world.goals[0].back.position.x = L(i+7); world.goals[1].back.position.x = L(i+8);
    world.ring.visible = A[oa+i+9] > 0.5; world.ring.position.set(L(i+10), 0.025, L(i+11));
  }
  function recFrame(t){
    if(!REC.buf || RP.on) return;
    recWrite(REC.buf, REC.head*REC.stride); REC.times[REC.head] = t;
    REC.head = (REC.head+1) % REC.cap; REC.count = Math.min(REC.count+1, REC.cap);
  }
  function recSeek(tq){
    // cherche les deux images encadrant l'instant tq (ordre chronologique dans le tampon circulaire)
    const n = REC.count, start = (REC.head - n + REC.cap) % REC.cap;
    let prev = start;
    for(let k=1;k<n;k++){
      const idx = (start + k) % REC.cap;
      if(REC.times[idx] >= tq){ const ta = REC.times[prev], tb = REC.times[idx]; return [prev, idx, tb>ta ? (tq-ta)/(tb-ta) : 0]; }
      prev = idx;
    }
    return [prev, prev, 0];
  }
  function startReplay(){
    if(REC.count < 20){ RP.pendingAt = 0; return; }
    recWrite(REC.snap, 0);
    const n = REC.count, first = REC.times[(REC.head - n + REC.cap) % REC.cap];
    RP.t0 = Math.max(first, RP.goalT - 4.0); RP.t1 = RP.goalT + 0.7; RP.cur = RP.t0;   // ≈ 8 s à 0,6x
    RP.on = true; RP.pendingAt = 0; RP.angle = Math.random() < 0.5 ? 0 : 1;
    if(cur && cur.container) cur.container.classList.add("s3d-replaying");
    camState.lastMode = "replay";
  }
  function endReplay(){
    if(!RP.on) return;
    recApply(REC.snap, 0, REC.snap, 0, 0);
    RP.on = false;
    if(cur && cur.container) cur.container.classList.remove("s3d-replaying");
    camState.lastMode = "fin-replay";
    lastGoalAt = clock.elapsedTime - 1.5;   // le coup d'envoi peut suivre rapidement
  }
  S.skipReplay = ()=> endReplay();
  function replayStep(dtRaw){
    RP.cur += dtRaw*RP.speed;
    if(RP.cur >= RP.t1){ endReplay(); return; }
    const [a, b, u] = recSeek(RP.cur);
    recApply(REC.buf, a*REC.stride, REC.buf, b*REC.stride, u);
    // caméra du ralenti : derrière le but ou au ras de la pelouse, toujours sur le ballon
    const bp = world.ball.position, gs = RP.gs;
    const p = RP.angle === 0 ? _f.set(gs*(HL+9), 3.0, bp.z*0.4) : _f.set(bp.x - gs*7, 1.6, bp.z + 8);
    camState.pos.lerp(p, camState.lastMode === "replay" ? 1 : 0.12); camState.lastMode = "replay-on";
    camState.look.lerp(bp, 0.25);
    camera.position.copy(camState.pos); camera.lookAt(camState.look);
    if(Math.abs(camera.fov - 34) > 0.1){ camera.fov = 34; camera.updateProjectionMatrix(); }
  }

  // ---------------------------------------------------------------- boucle
  let acc = 0;
  function frame(){
    if(!running) return;
    rafId = requestAnimationFrame(frame);
    if(!cur || !cur.container.isConnected || !renderer.domElement.isConnected){ document.body.classList.remove("s3d-fs-open"); stop(); return; }
    const dtRaw = clock.getDelta();
    acc += dtRaw;
    if(cur.showcase && acc < 1/30) return;      // avant-match : 30 i/s suffisent, on épargne la batterie
    const dt = Math.min(window.__S3D_MAXDT || 0.1, acc); acc = 0;   // __S3D_MAXDT : réservé aux tests (rendu logiciel lent)
    const t = clock.elapsedTime;
    const m = cur.m;
    resizeIfNeeded();
    if(!m.showcase && RP.pendingAt && t >= RP.pendingAt) startReplay();
    if(RP.on){
      replayStep(dtRaw > 0.1 ? 0.1 : dtRaw);
      const cu0 = world.crowd.material.uniforms; cu0.time.value = t; cu0.excite.value = world.excite; cu0.flash.value = 0.6;
      updateHud(m);
      renderer.render(scene, camera);
      return;
    }
    syncTargets(m, false);
    updatePlayers(dt, t);
    if(!m.showcase) updateBallSystem(dt); else world.ball.position.set(0, 0.11, 0);
    const rc = !m.showcase && BS.carrier;
    world.ring.visible = !!rc;
    if(rc){ world.ring.position.set(rc.pos.x, 0.025, rc.pos.z); world.ring.material.color.set(rc.side==="us" ? teams.kits.us[0] : teams.kits.them[0]); world.ring.scale.setScalar(1 + Math.sin(t*6)*0.06); }
    updateCamera(dt, t);
    if(!m.showcase) updateScreens(m);
    // ambiance : excitation de la foule (selon le score, la possession et les buts)
    const amb = clamp(0.25 + (m.us-m.them)*0.12 + (world.goalPulse*0.8), 0.12, 1);
    world.excite = lerp(world.excite, amb, damp(1.5,dt));
    world.goalPulse = Math.max(0, world.goalPulse - dt*0.25);
    // tension sonore : le murmure du stade enfle quand le ballon approche d'un but
    if(!m.showcase && (cur.tensT = (cur.tensT||0) + dt) > 0.4){ cur.tensT = 0; const bx = Math.abs(world.ball.position.x); try{ if(typeof SFX!=="undefined" && SFX.setTension) SFX.setTension(clamp((bx-22)/28, 0, 1)); }catch(e){} }
    const cu = world.crowd.material.uniforms;
    cu.time.value = t; cu.excite.value = world.excite; cu.flash.value = Math.min(1, world.goalPulse*1.2 + 0.08);
    world.adTex.offset.x = (t*0.025)%1;
    world.ringTex.offset.x = (-t*0.03)%1;
    if(!m.showcase) updateSideline(t, dt);
    world.flags.forEach((f,i)=>{ f.rotation.y = Math.sin(t*(cur.windy?6:2.5)+i)*(cur.windy?0.9:0.35) + (cur.windy?0.6:0); });
    world.flares.forEach((f,i)=>{ const s = 8.5 + Math.sin(t*0.8+i)*0.4; f.scale.set(s,s,1); });
    // filets qui gonflent après un but
    world.goals.forEach(g=>{ if(g.bulge>0){ g.bulge = Math.max(0, g.bulge-dt*1.4); g.back.position.x = g.side*(GOAL_D + Math.sin(g.bulge*Math.PI)*0.6); } });
    // météo
    if(world.weather.visible){
      const pos = world.weather.geometry.attributes.position, arr = pos.array, snow = cur.weatherKind==="neige";
      const vy = snow ? 2.2 : 28, vx = cur.windy ? 6 : (snow?0.6:1.5);
      for(let i=0;i<arr.length;i+=3){
        arr[i+1] -= vy*dt; arr[i] += vx*dt + (snow? Math.sin(t+i)*0.01 : 0);
        if(arr[i+1] < 0){ arr[i+1] = 45; arr[i] = camera.position.x + rnd(-70,70); arr[i+2] = rnd(-50,50); }
      }
      pos.needsUpdate = true;
    }
    if(world.confetti.visible) updateConfetti(dt);
    if(!m.showcase){ updateHud(m); recFrame(t); }
    renderer.render(scene, camera);
  }

  function start(){ if(running) return; running = true; clock.getDelta(); rafId = requestAnimationFrame(frame); }
  function stop(){ running = false; if(rafId) cancelAnimationFrame(rafId); rafId = 0; }

  let lastW=0, lastH=0;
  function resizeIfNeeded(){
    const el = cur.container;
    const w = el.clientWidth|0, h = el.clientHeight|0;
    if(w===lastW && h===lastH) return;
    lastW = w; lastH = h;
    if(!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w/h; camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- HUD (surimpression façon TV)
  function buildHud(container, m){
    const hud = document.createElement("div");
    hud.className = "s3d-hud";
    hud.innerHTML = `
      <div class="s3d-bug">
        <span class="s3d-chip" id="s3dChipUs"></span><span class="s3d-tm" id="s3dUs"></span>
        <span class="s3d-sc" id="s3dScore"></span>
        <span class="s3d-tm" id="s3dThem"></span><span class="s3d-chip" id="s3dChipThem"></span>
        <span class="s3d-min" id="s3dMin"></span>
      </div>
      <div class="s3d-live">● LIVE</div>
      <div class="s3d-tools">
        <button class="s3d-btn" id="s3dCam" title="Changer de caméra">🎥 <span id="s3dCamLbl"></span></button>
        <button class="s3d-btn" id="s3dPace" title="Rythme du match"><span data-pace-label></span></button>
        <button class="s3d-btn" id="s3dFs" title="Plein écran">⛶</button>
        <button class="s3d-btn" id="s3d2d" title="Vue 2D">2D</button>
      </div>
      <div class="s3d-carrier" id="s3dCarrier"></div>
      <div class="s3d-ticker" id="s3dTicker"></div>
      <div class="s3d-replay"><span>⟲ RALENTI</span><button class="s3d-btn" id="s3dSkip">Passer ⏭</button></div>`;
    container.appendChild(hud);
    const q = (id)=> hud.querySelector("#"+id);
    q("s3dCamLbl").textContent = CAM_MODES[camMode];
    q("s3dCam").onclick = (e)=>{ e.stopPropagation(); camMode = (camMode+1)%CAM_MODES.length; q("s3dCamLbl").textContent = CAM_MODES[camMode]; };
    const pl = q("s3dPace").querySelector("[data-pace-label]");
    if(typeof MATCH_PACES !== "undefined" && typeof matchPaceKey === "function"){ pl.textContent = MATCH_PACES[matchPaceKey()].label.split(" ")[0]; q("s3dPace").onclick = (e)=>{ e.stopPropagation(); cycleMatchPace(); }; }
    else q("s3dPace").remove();
    q("s3dSkip").onclick = (e)=>{ e.stopPropagation(); endReplay(); };
    q("s3dFs").onclick = (e)=>{ e.stopPropagation(); fsOn = !fsOn; applyFs(); };
    q("s3d2d").onclick = (e)=>{ e.stopPropagation(); fsOn = false; applyFs(); S.setEnabled(false); stop(); if(typeof window.render==="function") window.render(); };
    return hud;
  }
  function applyFs(){
    if(!cur) return;
    cur.container.classList.toggle("s3d-fullscreen", fsOn);
    document.body.classList.toggle("s3d-fs-open", fsOn);
    lastW = 0;
  }
  let lastHudKey = "";
  function updateHud(m){
    const h = cur.hud; if(!h) return;
    const usName = m.ctx==="club" ? clubName() : "FRA";
    const key = [m.us,m.them,m.minute,m.finalWhistlePlayed,m.extraTime].join("|");
    if(key !== lastHudKey){
      lastHudKey = key;
      h.querySelector("#s3dUs").textContent = usName.slice(0,3).toUpperCase();
      h.querySelector("#s3dThem").textContent = String(m.opp).normalize("NFD").replace(/[̀-ͯ]/g,"").slice(0,3).toUpperCase();
      h.querySelector("#s3dScore").textContent = `${m.us} - ${m.them}`;
      h.querySelector("#s3dMin").textContent = m.finalWhistlePlayed ? "FIN" : (m.extraTime ? `${m.minute}' MS` : `${m.minute}'`);
      h.querySelector("#s3dChipUs").style.background = teams.kits.us[0];
      h.querySelector("#s3dChipThem").style.background = teams.kits.them[0];
    }
    const c = teams.carrier, el = h.querySelector("#s3dCarrier");
    let txt = "";
    if(c){
      const esc = (x)=> String(x).replace(/[&<>"]/g, ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
      if(c.side==="us"){ const p = m.usOrder && m.usOrder[c.idx]; txt = p ? `<b>${c.idx===0?1:c.idx+1}</b> ${esc(p.nom)}` : ""; }
      else { const nm = (typeof oppNamesFor === "function") ? oppNamesFor(m)[c.idx] : null; txt = `<b>${c.idx===0?1:c.idx+1}</b> ${esc(nm || m.opp)}`; }
    }
    if(el.dataset.t !== txt){ el.dataset.t = txt; el.innerHTML = txt; el.style.opacity = txt ? 1 : 0; }
    // dernier commentaire du match en bandeau (passes, frappes, buts...)
    const tk = h.querySelector("#s3dTicker"), last = m.log && m.log[m.log.length-1];
    const n = m.log ? m.log.length : 0;
    if(tk) tk.style.display = S.tickerOn() ? "" : "none";
    if(tk && last && tk.dataset.n !== String(n)){
      tk.dataset.n = String(n);
      tk.innerHTML = `<span class="s3d-tmin">${last.min}'</span>`;
      tk.appendChild(document.createTextNode(String(last.text).replace(/<[^>]*>/g,"")));
      tk.classList.toggle("goal", !!last.goal);
      tk.classList.remove("in"); void tk.offsetWidth; tk.classList.add("in");
    }
  }

  // ---------------------------------------------------------------- confettis
  function launchConfetti(colors){
    const geo = world.confetti.geometry, pos = geo.attributes.position.array, col = geo.attributes.color.array, v = world.confettiVel;
    const cols = colors.map(c=> new T.Color(c));
    for(let i=0;i<pos.length/3;i++){
      const side = Math.random()<0.5 ? -1 : 1;
      pos[i*3] = rnd(-HL, HL); pos[i*3+1] = rnd(18, 32); pos[i*3+2] = side*(HW+rnd(10,30));
      v[i*3] = rnd(-1,1); v[i*3+1] = rnd(-2.5,-1); v[i*3+2] = -side*rnd(0.5,2.5);
      const c = cols[(Math.random()*cols.length)|0]; col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b;
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    world.confetti.visible = true; world.confettiT = 7;
  }
  function updateConfetti(dt){
    const pos = world.confetti.geometry.attributes.position.array, v = world.confettiVel, t = clock.elapsedTime;
    for(let i=0;i<pos.length;i+=3){ pos[i] += (v[i]+Math.sin(t*3+i)*0.8)*dt; pos[i+1] = Math.max(0.05, pos[i+1]+v[i+1]*dt); pos[i+2] += v[i+2]*dt; }
    world.confetti.geometry.attributes.position.needsUpdate = true;
    world.confettiT -= dt; if(world.confettiT <= 0) world.confetti.visible = false;
  }

  // ---------------------------------------------------------------- API
  S.mount = function(container, m){
    if(!S.supported()) return false;
    try{
      if(!renderer) initRenderer();
    }catch(e){ console.warn("Stade3D indisponible :", e); webglOK = false; return false; }
    const newMatch = !cur || cur.m !== m || !teams;
    const layer = document.createElement("div");
    layer.className = "s3d-layer";
    layer.appendChild(renderer.domElement);
    container.appendChild(layer);
    container.classList.add("mode3d");
    cur = {m, container, hud:null, showcase:!!m.showcase};
    if(m.showcase){
      const tag = document.createElement("div"); tag.className = "s3d-hud";
      tag.innerHTML = `<div class="s3d-live s3d-pre">🏟️ AVANT-MATCH · HYMNES</div>`;
      container.appendChild(tag);
    } else cur.hud = buildHud(container, m);
    const wk = m.weather && m.weather.key;
    cur.windy = wk === "vent";
    cur.weatherKind = wk==="pluie" ? "pluie" : (wk==="froid" ? "neige" : null);
    world.weather.visible = !!cur.weatherKind;
    world.weather.material.size = cur.weatherKind==="neige" ? 0.22 : 0.09;
    world.weather.material.color.set(cur.weatherKind==="neige" ? 0xffffff : 0xbcd0ff);
    applyLighting(wk);
    if(newMatch){
      fsOn = false; camState.goalCam = 0; RP.on = false; RP.pendingAt = 0;
      buildTeams(m);
      resetBall(m);
      // nouvelle pub LED avec le nom des équipes
      const old = world.adTex; const fresh = makeAdTexture(m.ctx==="club" ? clubName() : "les Bleus", m.opp);
      old.image = fresh.image; old.needsUpdate = true;
      lastScreenKey = ""; lastHudKey = "";
      camState.snap = true;
    }
    lastW = 0; lastH = 0;
    if(!m.showcase) applyFs();
    start();
    return true;
  };

  // Vue d'avant-match (onglet Match, avant le coup d'envoi) : réutilise le même renderer.
  // `info` = {opp, ctx, usOrder, weather, key} ; `key` évite de reconstruire les 22 joueurs
  // à chaque render() du jeu tant que l'affiche (adversaire + composition) ne change pas.
  let showcaseM = null;
  S.mountShowcase = function(container, info){
    if(!S.supported() || !S.isEnabled()) return false;
    if(!showcaseM || showcaseM.key !== info.key){
      showcaseM = {showcase:true, key:info.key, ctx:info.ctx, opp:info.opp, usOrder:info.usOrder||[], weather:info.weather||null,
        us:0, them:0, minute:0, pos:{us:[], them:[], ball:{x:50,y:50}}};
      for(let i=0;i<11;i++){ showcaseM.pos.us.push({x:40,y:56}); showcaseM.pos.them.push({x:60,y:56}); }
    }
    return S.mount(container, showcaseM);
  };

  function applyLighting(wk){
    const day = wk === "canicule" || wk === "soleil";
    const sky = world.sky.material.uniforms;
    if(day){
      sky.top.value.set(0x2a6fd6); sky.bottom.value.set(0xbfd8f5); sky.day.value = 1;
      scene.background.set(0x8fb6e8); scene.fog.color.set(0xa8c4e6);
      world.key.intensity = 3.0; world.key.color.set(0xfff1d6); world.hemi.intensity = 0.9;
      world.flares.forEach(f=> f.visible=false);
      (world.beams||[]).forEach(b=> b.visible=false);
      world.crowd.material.uniforms.light.value = 1.05;
      renderer.toneMappingExposure = 1.0;
    } else {
      const gloomy = wk==="pluie" || wk==="froid";
      sky.top.value.set(gloomy?0x05070d:0x02040c); sky.bottom.value.set(gloomy?0x2a2f3c:0x1a2448); sky.day.value = gloomy?1:0;
      scene.background.set(0x070b18); scene.fog.color.set(gloomy?0x1a1e28:0x0a0f22);
      scene.fog.near = gloomy ? 90 : 180;
      world.key.intensity = 2.1; world.key.color.set(0xfff4e0); world.hemi.intensity = 0.55;
      world.flares.forEach(f=> f.visible=true);
      (world.beams||[]).forEach(b=> b.visible=true);
      world.crowd.material.uniforms.light.value = 0.92;
      renderer.toneMappingExposure = 1.05;
    }
  }

  S.onGoal = function(m, side, idx){
    if(!cur || cur.m !== m || !teams) return;
    const g = {side, idx};
    const shotPending = (act && act.kind==="shot" && act.outcome==="goal" && !act.goalHit) || queue.some(a=> a.kind==="shot" && a.outcome==="goal");
    if(shotPending) pendingGoal = g;            // la fête démarrera quand le ballon touchera le filet
    else {
      if(BS.mode !== "dead"){ const gs = side==="us"?1:-1; BS.mode="dead"; BS.carrier=null; BS.pos.set(gs*(HL+1), 0.3, rnd(-2.5,2.5)); world.goals[gs>0?1:0].bulge = 1; }
      celebrate(g);
    }
  };
  // Diagnostic (tests) : état du ballon et de la file d'actions
  S._debug = ()=>({dbg:JSON.parse(JSON.stringify(dbg)), mode:BS.mode, carrier: BS.carrier ? BS.carrier.side+BS.carrier.idx : null, q:queue.length, act: act ? act.kind : null,
    ball:[+BS.pos.x.toFixed(1), +BS.pos.y.toFixed(2), +BS.pos.z.toFixed(1)],
    footDist: BS.carrier ? +Math.hypot(BS.carrier.pos.x-BS.pos.x, BS.carrier.pos.z-BS.pos.z).toFixed(2) : null});
  // Actions de jeu envoyées par le moteur de match (cf. playPassChain / playSequence dans index.html)
  S.onAction = function(m, a){
    if(!cur || cur.m !== m || !teams || cur.showcase) return;
    queue.push(Object.assign({}, a)); dbg.pushed++;
    if(queue.length > 16) queue.splice(0, queue.length-16);
  };

  // Écran de chargement : crée le renderer et compile les shaders du stade pendant la barre de
  // progression, pour que le premier match/avant-match s'affiche sans à-coup.
  S.warmup = function(){
    if(!S.supported() || !S.isEnabled()) return false;
    try{
      if(!renderer) initRenderer();
      camera.position.set(0, 17, HW+26); camera.lookAt(0,0,0);
      renderer.compile(scene, camera);
      return true;
    }catch(e){ console.warn("Préchargement 3D impossible :", e); return false; }
  };

  S.onEvent = function(m, kind){
    if(!cur || cur.m !== m || !teams) return;
    if(kind === "post"){ world.goalPulse = Math.max(world.goalPulse, 0.35); }
    if(kind === "save"){ world.goalPulse = Math.max(world.goalPulse, 0.25); }
  };
})();
