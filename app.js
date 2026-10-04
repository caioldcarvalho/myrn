/* Myrn — o planeta inteiro, continuo ate a estrada de Dejgomesvav.
   Mercator esferico no raio do Myrn (web_mundo.py, MU1). Nalsam chega em km (projecao azimutal
   equidistante centrada no vulcao) e e convertido aqui (inv). Todo limite de zoom e medido em
   zk = log2(px por km no centro da tela): 0 = 1 px/km, 6 = 64 px/km — vale igual no planeta e na regiao. */
(async function () {
  "use strict";
  const [D, MU] = await Promise.all(["dados.json", "mundo.json"].map(async (f) => (await fetch(f)).json()));
  const raiz = document.documentElement;
  const R = MU.regiao.R * 1000;

  // ---------------------------------------------------------------- CRS do Myrn (MU1)
  const MERC = L.extend({}, L.Projection.SphericalMercator, { R, bounds: L.bounds([-Math.PI * R, -Math.PI * R], [Math.PI * R, Math.PI * R]) });
  const sc = 0.5 / (Math.PI * R);
  const CRS = L.extend({}, L.CRS.Earth, { code: "MYRN", projection: MERC, transformation: new L.Transformation(sc, 0.5, -sc, 0.5), R });

  // km da regiao <-> lat/lon (regiao.py inv/proj, azimutal equidistante no vulcao)
  const RAD = Math.PI / 180, RK = MU.regiao.R, P0 = MU.regiao.lat0 * RAD, L0 = MU.regiao.lon0 * RAD;
  function inv(x, y) {
    const rho = Math.hypot(x, y), c = rho / RK;
    const lat = Math.asin(Math.cos(c) * Math.sin(P0) + (rho > 0 ? (y * Math.sin(c) * Math.cos(P0)) / rho : 0));
    const lon = L0 + Math.atan2(x * Math.sin(c), rho * Math.cos(P0) * Math.cos(c) - y * Math.sin(P0) * Math.sin(c));
    return [lat / RAD, lon / RAD];
  }
  function proj(lat, lon) {
    const p = lat * RAD, l = lon * RAD;
    const cc = Math.sin(P0) * Math.sin(p) + Math.cos(P0) * Math.cos(p) * Math.cos(l - L0);
    const c = Math.acos(Math.max(-1, Math.min(1, cc))), k = c > 1e-12 ? c / Math.sin(c) : 1;
    return [RK * k * Math.cos(p) * Math.sin(l - L0), RK * k * (Math.cos(P0) * Math.sin(p) - Math.sin(P0) * Math.cos(p) * Math.cos(l - L0))];
  }
  const LL = (x, y) => L.latLng(inv(x, y));
  const LLs = (pts) => pts.map(([x, y]) => inv(x, y));
  const [X0, X1, Y0, Y1] = D.ext;
  const REGIAO = L.latLngBounds(LLs([[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1], [(X0 + X1) / 2, Y1], [(X0 + X1) / 2, Y0]]));

  // ---------------------------------------------------------------- estado (com hash na URL)
  const S = { epoca: "dia", dens: 0, nomes: true, lugares: true, hex: false };
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("t") === "escuro") S.epoca = "escuro";
  if (hash.has("d")) S.dens = Math.max(-1, Math.min(1, +hash.get("d") || 0));
  if (hash.get("hex") === "1") S.hex = true;

  const map = L.map("map", { crs: CRS, minZoom: 1, maxZoom: 15, zoomSnap: 1, wheelPxPerZoomLevel: 100,
    worldCopyJump: true, zoomControl: false, maxBounds: [[-86, -540], [86, 540]], maxBoundsViscosity: 0.9 });
  L.control.zoom({ position: "topright" }).addTo(map);
  L.control.scale({ position: "bottomright", maxWidth: 140 }).addTo(map);
  map.attributionControl.setPrefix(false).addAttribution("Myrn · a world built by Caio · <a href=\"https://leafletjs.com\">Leaflet</a>");
  if (hash.has("z") && hash.has("la")) map.setView([+hash.get("la"), +hash.get("lo")], +hash.get("z"));
  else map.setView(REGIAO.getCenter(), 6);

  // zk = log2(px/km) no centro da tela
  const zk = () => Math.log2(256 * 2 ** map.getZoom() / (2 * Math.PI * RK * Math.cos(map.getCenter().lat * RAD)));

  // ---------------------------------------------------------------- tiles (MU2: mundo + Nalsam por cima)
  const VAZIO = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  const camadas = (D.camadas || []).map((c) => ({ ...c, lay: {} }));
  function tileLayer(c, v) {
    const caixa = c.caixa && L.latLngBounds([c.caixa[0], c.caixa[2]], [c.caixa[1], c.caixa[3]]);
    return L.tileLayer(`t/${v}/{z}/{x}/{y}.webp?v=${c.v || 0}`, { minNativeZoom: c.z0, maxNativeZoom: c.z1, minZoom: c.z0 ? c.z0 : 0,
      maxZoom: 18, noWrap: !!caixa, bounds: caixa || undefined, errorTileUrl: VAZIO, keepBuffer: 3, zIndex: c.ordem || 1 });
  }

  // ---------------------------------------------------------------- linhas (vetor)
  map.createPane("linhas").style.zIndex = 380;
  const rLinhas = L.canvas({ pane: "linhas", padding: 0.6 });
  const K = (z) => z < -1 ? Math.max(0.3, 0.45 + (z + 1) * 0.04) : [0.45, 0.55, 0.75, 1, 1.25, 1.55, 1.9, 2.3, 2.7][Math.min(8, Math.round(z) + 1)];
  const PT = 200 / 72;
  const camadasLinha = [];
  function linha(pls, est, opts = {}) {
    if (!pls.length) return;
    const lay = L.polyline(pls, { renderer: rLinhas, interactive: false, lineCap: "round", lineJoin: "round", smoothFactor: 0.6, noClip: false, ...est });
    camadasLinha.push({ lay, peso: est.weight, dash: est.dashArray, ...opts });
  }
  function estiloLinhas() {
    const z = zk(), k = K(z);
    for (const c of camadasLinha) {
      const ver = z >= (c.zmin ?? -99) && z <= (c.zmax ?? 99) && (!c.epoca || c.epoca === S.epoca);
      if (!ver) { c.lay.remove(); continue; }
      const st = { weight: Math.max(c.peso * (c.fixo ? 1 : k), 0.35) };
      if (c.dash) st.dashArray = c.dash.split(",").map((v) => (+v * (c.fixo ? 1 : k)).toFixed(1)).join(",");
      c.lay.setStyle(st);
      if (!map.hasLayer(c.lay)) c.lay.addTo(map);
    }
  }
  const pts = (it) => (Array.isArray(it) ? it : it.p);
  const json = async (f) => (await fetch(f)).json();
  const [LV, LM] = await Promise.all([json("linhas.json"), json("mundo-linhas.json")]);
  // o planeta (fora de Nalsam; MU5) — larguras em px de tela, finas
  linha(LM.costa, { color: "#2F6E9E", weight: 1 }, { fixo: 1 });
  linha(LM.lago, { color: "#2F6E9E", weight: 0.7 }, { fixo: 1, zmin: -4.5 });
  const rq = {};
  for (const r of LM.rio) { const f = r.q >= 3000 ? 3 : r.q >= 800 ? 2 : r.q >= 200 ? 1 : 0; (rq[f] ||= []).push(r.p); }
  [[-7, 1.3], [-5, 1.0], [-3.5, 0.8], [-2.5, 0.6]].reverse().forEach(([zmin, w], i) => { const f = 3 - i; if (rq[f]) linha(rq[f], { color: "#3C86C6", weight: w }, { fixo: 1, zmin }); });
  linha(LM.fronteira, { color: "#7B3F8C", weight: 1.1, opacity: 0.7, dashArray: "5,3", lineCap: "butt" }, { fixo: 1, zmin: -6 });
  // Nalsam (km -> lat/lon)
  linha(LV.costa.map((p) => LLs(pts(p))), { color: "#2F6E9E", weight: 0.6 * PT });
  linha(LV.lago.map((p) => LLs(pts(p))), { color: "#2F6E9E", weight: 0.4 * PT }, { zmin: -2 });
  const faixas = {};
  for (const r of LV.rio) { const w = Math.round(r.w * 10) / 10; (faixas[w] ||= []).push(LLs(r.p)); }
  for (const [w, pl] of Object.entries(faixas))
    linha(pl, { color: "#3C86C6", weight: +w * PT }, { zmin: w >= 0.9 ? -3 : w >= 0.55 ? 1 : w >= 0.32 ? 2 : 3 });
  linha(LV.fronteira.map((p) => LLs(pts(p))), { color: "#7B3F8C", weight: 1.3 * PT, opacity: 0.75, dashArray: `${5 * PT},${2.5 * PT}`, lineCap: "butt" }, { zmin: -3 });
  const est = LV.estrada.map((p) => LLs(pts(p)));
  linha(est, { color: "#fff", weight: 2.0 * PT, opacity: 0.7 }, { zmin: -2 });
  linha(est, { color: "#8E3B2B", weight: 1.1 * PT }, { zmin: -2 });
  for (const s of LV["sombra-antes"]) linha([LLs(s.p)], { color: "#1b1640", weight: s.w * PT, opacity: 0.85, dashArray: `${6 * PT},${3 * PT}`, lineCap: "butt" }, { epoca: "escuro", zmin: -1 });
  for (const s of LV.sombra) linha([LLs(s.p)], { color: "#1b1640", weight: s.w * PT, opacity: 0.85 }, { epoca: "escuro", zmin: -4 });
  let pedidoTrilha = null, pedidoCurva = null;
  function sobDemanda() {
    const z = zk(), perto = map.getBounds().intersects(REGIAO);
    if (perto && z >= 2 && !pedidoTrilha) pedidoTrilha = json("trilhas.json").then((d) => {
      linha(d.trilha.map(LLs), { color: "#7A6A55", weight: 0.32 * PT, opacity: 0.6 }, { zmin: 2 }); estiloLinhas(); });
    if (perto && z >= 1 && !pedidoCurva) pedidoCurva = json("curvas.json").then((d) => {
      linha(d.curva.filter((c) => c.h % 1000).map((c) => LLs(pts(c))), { color: "#6B4A2B", weight: 0.25 * PT, opacity: 0.35 }, { zmin: 2 });
      linha(d.curva.filter((c) => !(c.h % 1000)).map((c) => LLs(pts(c))), { color: "#6B4A2B", weight: 0.45 * PT, opacity: 0.35 }, { zmin: 1 });
      estiloLinhas(); });
  }

  // ---------------------------------------------------------------- assentamentos (Nalsam) e cidades (planeta)
  const canvas = L.canvas({ padding: 0.5, tolerance: 4 });
  const TIPO = { cidade: "City", mercado: "Market town", vila: "Village", acampamento: "Dekirio camp", capital: "Capital" };
  const ESTADO = { viva: "inhabited", minguando: "dwindling", sol: "under a Tirsång", refugio: "swollen with refugees",
    abandonada: "abandoned", destruida: "destroyed on the Day" };
  const fmt = (n) => (n ?? 0).toLocaleString("en-US");
  for (const l of D.lugares) l.ll = LL(l.x, l.y);
  function zSimbolo(l) {
    if (l.t === "cidade") return -1;
    if (l.t === "mercado") return 0;
    if (l.t === "acampamento") return 3;
    return l.p >= 400 ? 1 : l.p >= 150 ? 2 : 3;
  }
  function estilo(l, z) {
    const esc = S.epoca === "escuro";
    const g = Math.max(0, z - 2) * 0.6;
    if (l.e === "destruida") return { radius: 5 + g, color: "#5a1a1a", weight: 2, fillColor: "#5a1a1a", fillOpacity: 0.25 };
    if (l.t === "cidade") return l.cap
      ? { radius: 6 + g, color: esc ? "#fff" : "#111", weight: 2, fillColor: esc ? "#111" : "#fff", fillOpacity: 1 }
      : { radius: 4.5 + g, color: esc ? "#ddd" : "#111", weight: 1.5, fillColor: esc ? "#333" : "#fff", fillOpacity: 1 };
    if (l.t === "mercado") return { radius: 3.6 + g * .7, color: esc ? "#eee" : "#222", weight: 1.2, fillColor: esc ? "#444" : "#fff", fillOpacity: 1 };
    const r = (l.t === "acampamento" ? 1.6 : 1.1 + Math.sqrt(esc ? l.p7 : l.p) / 11) + g * .5;
    if (!esc) return { radius: r, stroke: false, fillColor: l.t === "acampamento" ? "#6b5a3a" : "#3a3a3a", fillOpacity: .9 };
    const c = { viva: "#cfc8ba", minguando: "#8d8799", sol: "#ffc233", refugio: "#ff5a4a" }[l.e];
    if (l.e === "abandonada") return { radius: Math.max(r, 1.6), color: "#8f8aa8", weight: 0.8, fill: false, opacity: .8 };
    return { radius: Math.max(r, 1.2), stroke: false, fillColor: c || "#cfc8ba", fillOpacity: .95 };
  }
  const marcas = D.lugares.map((l, i) => {
    const m = L.circleMarker(l.ll, { renderer: canvas, ...estilo(l, 0) });
    m.on("click", (e) => { L.DomEvent.stop(e); abreFicha(i); });
    m._l = l;
    return m;
  });
  const marcasMundo = MU.cidades.map((c, i) => {
    const m = L.circleMarker([c.la, c.lo], { renderer: canvas, radius: c.t === "capital" ? 4 : 2.8, color: "#111", weight: c.t === "capital" ? 1.6 : 1.1, fillColor: "#fff", fillOpacity: 1 });
    m.on("click", (e) => { L.DomEvent.stop(e); abreFichaMundo(i); });
    m._c = c;
    return m;
  });
  const grupoLugares = L.layerGroup().addTo(map);
  let visiveis = new Set();
  function atualizaLugares() {
    const z = zk(), quero = new Set();
    if (S.lugares) {
      for (const m of marcas) {
        const l = m._l;
        if (S.epoca === "escuro" && l.t !== "cidade" && l.t !== "mercado" && l.e === "abandonada" && z < 2) continue;
        if (z >= zSimbolo(l)) quero.add(m);
      }
      for (const m of marcasMundo) if (z >= (m._c.t === "capital" ? -6 : -4.5)) quero.add(m);
    }
    for (const m of visiveis) if (!quero.has(m)) grupoLugares.removeLayer(m);
    for (const m of quero) { if (m._l) { const s = estilo(m._l, z); m.setStyle(s); m.setRadius(s.radius); } if (!visiveis.has(m)) grupoLugares.addLayer(m); }
    visiveis = quero;
  }
  const vulcao = L.marker(LL(D.vulcao.x, D.vulcao.y), {
    icon: L.divIcon({ className: "", html: '<div class="ico-vulcao"></div>', iconSize: [18, 15], iconAnchor: [9, 13] }),
  }).bindPopup(`<div class="pp"><h3>${D.vulcao.n}</h3><p class="sig">the mountain of the Day</p><dl>
    <dt>Erupted</dt><dd>end of 3600</dd><dt>Range</dt><dd>Jylefjön, dead for 320 million years</dd></dl>
    <p style="margin:6px 0 0">No sage can say why it burns. The ash it raises never settles.</p></div>`).addTo(map);
  const sois = L.layerGroup(D.sois.map((o) => L.marker(LL(o.x, o.y), {
    icon: L.divIcon({ className: "", html: '<div class="ico-sol"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
  }).bindPopup(`<div class="pp"><h3>Tirsång</h3><p class="sig">“fire-sun”</p><dl>
    <dt>Lit</dt><dd>${o.ano}</dd><dt>Owner</dt><dd>${o.dono}</dd></dl></div>`)));

  // ---------------------------------------------------------------- grade de hex (6 milhas), so em Nalsam
  const HEX_KM = 6 * 1.609344, HS = HEX_KM / Math.sqrt(3);
  const Hex = L.GridLayer.extend({
    createTile(c) {
      const t = document.createElement("canvas"), sz = this.getTileSize();
      t.width = sz.x; t.height = sz.y;
      const ctx = t.getContext("2d"), nw = c.scaleBy(sz);
      const cantos = [[0, 0], [sz.x, 0], [0, sz.y], [sz.x, sz.y], [sz.x / 2, 0], [sz.x / 2, sz.y], [0, sz.y / 2], [sz.x, sz.y / 2]]
        .map(([a, b]) => { const ll = map.unproject(nw.add([a, b]), c.z); return proj(ll.lat, ll.lng); });
      const kx0 = Math.max(X0, Math.min(...cantos.map((p) => p[0]))), kx1 = Math.min(X1, Math.max(...cantos.map((p) => p[0])));
      const ky0 = Math.max(Y0, Math.min(...cantos.map((p) => p[1]))), ky1 = Math.min(Y1, Math.max(...cantos.map((p) => p[1])));
      if (kx0 > kx1 || ky0 > ky1) return t;
      const px = (x, y) => map.project(LL(x, y), c.z).subtract(nw);
      const escuro = S.epoca === "escuro";
      ctx.strokeStyle = escuro ? "rgba(230,225,255,.28)" : "rgba(60,40,20,.32)";
      ctx.lineWidth = c.z >= 11 ? 1.1 : 0.8;
      ctx.font = "10px 'Alegreya Sans', sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = escuro ? "rgba(230,225,255,.55)" : "rgba(60,40,20,.55)";
      const dx = 1.5 * HS, dy = HEX_KM, rotulo = map.getZoom() >= 11;
      for (let q = Math.floor((kx0 - HS) / dx); q <= Math.ceil((kx1 + HS) / dx); q++) {
        const off = (q & 1) ? dy / 2 : 0;
        for (let r = Math.floor((ky0 - dy - off) / dy); r <= Math.ceil((ky1 + dy - off) / dy); r++) {
          const cx = q * dx, cy = r * dy + off;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k, p = px(cx + HS * Math.cos(a), cy + HS * Math.sin(a));
            k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
          }
          ctx.closePath(); ctx.stroke();
          if (rotulo) { const p = px(cx, cy + HS * 0.62); ctx.fillText(`${String(q + 100).padStart(3, "0")}.${String(-r + 100).padStart(3, "0")}`, p.x, p.y); }
        }
      }
      return t;
    },
  });
  const hex = new Hex({ minZoom: 8, maxZoom: 18, bounds: REGIAO, pane: "overlayPane" });

  // ---------------------------------------------------------------- rotulos (anticolisao)
  map.createPane("rotulos").style.zIndex = 450;
  const painelRot = map.getPane("rotulos");
  const ctxMede = document.createElement("canvas").getContext("2d");
  const FONTE = {
    oceano: ["italic 400 22px Alegreya", 22, 0.3], continente: ["700 20px Alegreya", 20, 0.35],
    reino: ["700 15px Alegreya", 15, 0.25], mar: ["italic 400 16px Alegreya", 16, 0], serra: ["italic 400 12px Alegreya", 12, 0.2],
    cap: ["700 16px Alegreya", 16, 0], cid: ["400 14px Alegreya", 14, 0], mer: ["500 13px 'Alegreya Sans'", 13, 0],
    vila: ["400 12px 'Alegreya Sans'", 12, 0], rio: ["italic 400 12.5px Alegreya", 12.5, 0], pico: ["400 10.5px 'Alegreya Sans'", 10.5, 0],
    vulcao: ["700 13px Alegreya", 13, 0.12], sol: ["700 12px 'Alegreya Sans'", 12, 0], regiao: ["700 12px Alegreya", 12, 0.3],
  };
  function mede(txt, cls) {
    const [f, h, esp] = FONTE[cls];
    ctxMede.font = f;
    const sup = /reino|serra|continente|regiao/.test(cls) ? txt.toUpperCase() : txt;
    return [ctxMede.measureText(sup).width + esp * h * sup.length, h];
  }
  // rotulos do planeta: tipo -> [classe, zmin, zmax, prioridade]
  const TIPO_ROT = { oceano: ["oceano", -9, -3, 950], continente: ["continente", -9, -4.5, 940], mar: ["mar", -6.5, -1, 800],
    regiao: ["regiao", -5.5, -2, 700], cordilheira: ["serra", -5, -1, 600], ilha: ["mar", -5, 0, 500], rio: ["rio", -3.5, 0, 300] };
  function candidatos() {
    const esc = S.epoca === "escuro", d = S.dens, C = [];
    for (const r of MU.rotulos) { const t = TIPO_ROT[r.t]; if (t) C.push({ c: t[0], t: r.n, ll: [r.la, r.lo], z: t[1], zmax: t[2], p: t[3], r: 0, centro: 1 }); }
    for (const r of MU.reinos) C.push({ c: "reino", t: r.n, ll: [r.la, r.lo], z: r.a > 2e6 ? -6.5 : r.a > 4e5 ? -5 : -4, zmax: -1.5, p: 880 + r.a / 1e8, r: 0, centro: 1 });
    for (const [i, c] of MU.cidades.entries()) C.push({ c: c.t === "capital" ? "cap" : "cid", t: c.n, ll: [c.la, c.lo], z: c.t === "capital" ? -6 + d : -4.5 + d, p: (c.t === "capital" ? 690 : 590) + c.p / 1e6, r: 5, mi: i });
    C.push({ c: "vulcao", t: D.vulcao.n.toUpperCase(), ll: LL(D.vulcao.x, D.vulcao.y), z: -3, p: 1000, r: 10, lado: [[12, 4]] });
    for (const r of D.reinos) C.push({ c: "reino", t: r.n, ll: LL(r.x, r.y), z: -1.5, zmax: 3.5, p: 900 + r.a / 1e4, r: 0, centro: 1 });
    for (const f of D.feicoes) C.push({ c: f.t === "mar" ? "mar" : "serra", t: f.n, ll: LL(f.x, f.y), z: f.t === "mar" ? -2 : -1, zmax: 5, p: 800, r: 0, centro: 1 });
    for (const [i, l] of D.lugares.entries()) {
      if (!l.n) continue;
      const n0 = C.length, morta = esc && l.e === "abandonada";
      if (l.t === "cidade") C.push({ c: l.cap ? "cap" : "cid", t: l.n + (l.e === "destruida" ? " (ruin)" : ""), ll: l.ll, z: l.cap ? -3 : -1, p: (l.cap ? 700 : 600) + l.p / 1e4, r: 7 });
      else if (l.t === "mercado") C.push({ c: "mer", t: l.n, ll: l.ll, z: 1 + d, p: 500 + l.p / 1e4, r: 5 });
      else if (l.t === "vila") C.push({ c: "vila" + (morta ? " morta" : ""), f: "vila", t: l.n, ll: l.ll, z: (l.p >= 250 ? 2 : l.p >= 110 ? 3 : 4) + d, p: 100 + (esc ? l.p7 : l.p) / 100 - (morta ? 50 : 0), r: 3 });
      else if (l.t === "acampamento") C.push({ c: "vila", t: l.n, ll: l.ll, z: 4 + d, p: 50 + l.p / 100, r: 3 });
      if (C.length > n0) C[C.length - 1].i = i;
    }
    for (const r of D.rios) C.push({ c: "rio", t: r.n, rio: r, z: r.km > 150 ? 1 : 2 + Math.max(d, 0), p: 400 + r.km / 100 });
    for (const k of D.picos) C.push({ c: "pico", t: `▲ ${fmt(k.h)} m`, ll: LL(k.x, k.y), z: 3 + d, p: 40 + k.h / 1e4, r: 0, centro: 1 });
    if (esc) for (const o of D.sois) C.push({ c: "sol", t: "Tirsång", ll: LL(o.x, o.y), z: 1.5 + d, p: 650, r: 13, lado: [[0, 15], [0, -15]] });
    return C.sort((a, b) => b.p - a.p);
  }
  for (const r of D.rios) r.ll = LLs(r.pts);
  const LADOS = [[1, 0], [-1, 0], [0, -1], [0, 1], [0.8, -0.8], [-0.8, 0.8]];
  function desenhaRotulos() {
    painelRot.innerHTML = "";
    if (!S.nomes) return;
    const z = zk(), tam = map.getSize(), caixas = [];
    const livre = (b) => !caixas.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    const frag = document.createDocumentFragment();
    for (const m of visiveis) {
      if (m._l && m._l.t !== "cidade" && m._l.t !== "mercado") continue;
      const p = map.latLngToContainerPoint(m.getLatLng()), r = m.getRadius() + 1;
      caixas.push([p.x - r, p.y - r, p.x + r, p.y + r]);
    }
    if (S.epoca === "escuro") for (const o of D.sois) {
      const p = map.latLngToContainerPoint(LL(o.x, o.y));
      caixas.push([p.x - 9, p.y - 9, p.x + 9, p.y + 9]);
    }
    for (const k of candidatos()) {
      if (z < k.z || (k.zmax !== undefined && z > k.zmax)) continue;
      const cresce = k.r && k.i !== undefined ? Math.max(0, z - 2) * 0.6 : 0;
      const fcls = k.f || k.c.split(" ")[0];
      const [w, h] = mede(k.t, fcls);
      let px, py, ang = 0;
      if (k.rio) {
        const pts = k.rio.ll.map((ll) => map.latLngToContainerPoint(ll));
        const dentro = pts.map((p, i) => [p, i]).filter(([p]) => p.x > 30 && p.y > 30 && p.x < tam.x - 30 && p.y < tam.y - 30);
        if (dentro.length < 3) continue;
        const i = dentro[Math.floor(dentro.length / 2)][1];
        const a = pts[Math.max(i - 2, 0)], b = pts[Math.min(i + 2, pts.length - 1)];
        if (a.distanceTo(b) < w * 0.5) continue;
        ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
        px = pts[i].x; py = pts[i].y;
        const rw = Math.abs(w * Math.cos(ang)) + Math.abs(h * Math.sin(ang)), rh = Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang));
        const b2 = [px - rw / 2, py - rh / 2 - 6, px + rw / 2, py + rh / 2 - 6];
        if (!livre(b2)) continue;
        caixas.push(b2); py -= 6;
      } else {
        const p = map.latLngToContainerPoint(k.ll);
        if (p.x < -200 || p.y < -50 || p.x > tam.x + 200 || p.y > tam.y + 50) continue;
        const opcoes = k.centro ? [[0, 0]] : k.lado || LADOS.map(([a, b]) => [a * (k.r + cresce + 3 + (a ? w / 2 : 0)), b * (k.r + cresce + 2 + h / 2)]);
        let ok = null;
        for (const [ox, oy] of opcoes) {
          const cx = p.x + ox, cy = p.y + oy, b2 = [cx - w / 2 - 1, cy - h / 2, cx + w / 2 + 1, cy + h / 2];
          if (livre(b2)) { ok = b2; px = cx; py = cy; break; }
        }
        if (!ok) continue;
        caixas.push(ok);
      }
      const el = document.createElement("div");
      el.className = "rt " + k.c;
      el.textContent = k.t;
      el.style.font = FONTE[fcls][0];
      const lp = map.containerPointToLayerPoint([px, py]);
      el.style.transform = `translate(${lp.x}px, ${lp.y}px) translate(-50%, -50%)` + (ang ? ` rotate(${ang}rad)` : "");
      el.style.left = "0"; el.style.top = "0";
      if (k.i !== undefined) { el.dataset.i = k.i; el.classList.add("clica"); }
      if (k.mi !== undefined) { el.dataset.mi = k.mi; el.classList.add("clica"); }
      frag.appendChild(el);
    }
    painelRot.appendChild(frag);
  }

  // ---------------------------------------------------------------- ficha do lugar (W11, a la Azgaar)
  const fichaEl = document.getElementById("ficha");
  let INFO = null, fichaAberta = "";
  map.createPane("selecao").style.zIndex = 460;
  const anel = L.circleMarker([0, 0], { radius: 13, color: "#c0392b", weight: 2.5, fill: false, interactive: false, pane: "selecao" });
  painelRot.addEventListener("click", (e) => {
    const el = e.target.closest(".clica"); if (!el) return;
    e.stopPropagation();
    if (el.dataset.i !== undefined) abreFicha(+el.dataset.i); else abreFichaMundo(+el.dataset.mi);
  });
  L.DomEvent.disableClickPropagation(fichaEl); L.DomEvent.disableScrollPropagation(fichaEl);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function semente(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; }
  function planta(o) {
    // watabou: Medieval Fantasy City Generator pra cidade e mercado, Village Generator pra vila e acampamento
    const seed = semente(o.nome + o.ll.lat.toFixed(3) + o.ll.lng.toFixed(3)) % 2147483647;
    if (o.vila) return `https://watabou.github.io/village-generator/?seed=${seed}`;
    const p = new URLSearchParams({ size: Math.max(6, Math.min(40, Math.round(o.pop / 250))), seed, name: o.nome,
      citadel: o.cap ? 1 : 0, walls: o.cidade ? 1 : 0, plaza: 1, temple: 1, river: o.rio ? 1 : 0,
      coast: o.costa ? 1 : 0, greens: 0, shantytown: o.cidade ? 1 : 0, random: 0 });
    return `https://watabou.github.io/city-generator/?${p}`;
  }
  function mostraFicha(o, chave) {
    const pecas = (o.pc || []).map(([, en]) => `<i>${esc(en)}</i>`).join(" + ");
    const ev = (o.ev || []).map(([ano, t]) => `<li><b>${ano}</b> ${esc(t)}</li>`).join("");
    fichaEl.innerHTML = `<button class="fecha" aria-label="Close">×</button>
      <h2>${esc(o.nome)}</h2>
      ${o.ipa ? `<p class="ipa">/${esc(o.ipa)}/</p>` : ""}
      ${o.en ? `<p class="sig">“${esc(o.en)}”${pecas ? ` <span>— ${pecas}</span>` : ""}</p>` : ""}
      ${o.lg ? `<p class="lg">${esc(o.lg)}${o.proto ? `, from Proto <i>*${esc(o.proto)}</i>` : ""}</p>` : ""}
      <dl>${o.linhas.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl>
      ${ev ? `<h3>Chronicle</h3><ul class="cron">${ev}</ul>` : ""}
      ${o.planta !== false ? `<a class="planta" href="${planta(o)}" target="_blank" rel="noopener">${o.vila ? "Village layout" : "Town plan"} ↗</a>
      <p class="nota">Layout drawn by watabou's generator, seeded by this place.</p>` : ""}`;
    fichaEl.hidden = false; fichaAberta = chave;
    anel.setLatLng(o.ll).addTo(map);
    const p = map.latLngToContainerPoint(o.ll), tam = map.getSize();
    if (innerWidth < 600) { if (p.y > tam.y * 0.32) map.panBy([0, p.y - tam.y * 0.22]); }
    else if (p.x > tam.x - 420) map.panBy([p.x - (tam.x - 420) / 2, 0]);
    fichaEl.querySelector(".fecha").onclick = fechaFicha;
    salvaHash();
  }
  const clima = (f) => `${f.tq} °C in high summer, ${f.tf} °C in deep winter; ${fmt(f.pr)} mm of rain a year`;
  async function abreFicha(i) {
    const l = D.lugares[i]; if (!l) return;
    if (!INFO) INFO = await json("info.json");
    const f = INFO.lugares[i] || {}, escuro = S.epoca === "escuro";
    let tipo = TIPO[l.t];
    if (l.t === "cidade") tipo = l.cap ? "Capital" : (l.e === "destruida" ? "City, destroyed on the Day" : "City");
    if (l.porto) tipo += " · port";
    const linhas = [["Type", tipo]];
    if (l.r) linhas.push(["Realm", esc(l.r)]);
    linhas.push(["People", escuro ? `${fmt(l.p7)} in 3607 <small>(${fmt(l.p)} before the Day)</small>` : `${fmt(l.p)}`]);
    if (escuro) linhas.push(["State", ESTADO[l.e] || l.e]);
    if (f.fund) linhas.push(["Founded", `year ${f.fund}`]);
    linhas.push(["Elevation", `${fmt(f.alt)} m`]);
    if (f.bio) linhas.push(["Land", f.bio + (f.rio ? ", on a river" : "") + (f.costa ? ", by the sea" : "")]);
    if (f.tq !== undefined) linhas.push(["Climate", clima(f)]);
    mostraFicha({ nome: l.n || (l.t === "acampamento" ? "Unnamed camp" : "Unnamed hamlet"), en: l.en, ipa: f.ipa, proto: f.proto, lg: f.lg, pc: f.pc,
      linhas, ev: (f.ev || []).map((n) => INFO.eventos[n]), ll: l.ll, pop: l.p, cap: l.cap, cidade: l.t === "cidade",
      vila: l.t === "vila" || l.t === "acampamento", rio: f.rio, costa: f.costa || l.porto, planta: l.n ? undefined : false }, `${i}`);
  }
  function abreFichaMundo(i) {
    const c = MU.cidades[i]; if (!c) return;
    const linhas = [["Type", c.t === "capital" ? "Capital" : "City"]];
    if (c.r) linhas.push(["Realm", esc(c.r)]);
    if (c.p) linhas.push(["People", fmt(c.p)]);
    if (c.fund !== undefined) linhas.push(["Founded", `year ${c.fund}`]);
    linhas.push(["Elevation", `${fmt(c.alt)} m`], ["Land", c.bio]);
    if (c.tq !== undefined) linhas.push(["Climate", clima(c)]);
    mostraFicha({ nome: c.n, en: c.en, ipa: c.ipa, proto: c.proto, lg: c.lg, pc: c.pc, linhas, ll: L.latLng(c.la, c.lo),
      pop: c.p, cap: c.t === "capital", cidade: true }, `m${i}`);
  }
  function fechaFicha() { fichaEl.hidden = true; fichaAberta = ""; anel.remove(); salvaHash(); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && fichaAberta) fechaFicha(); });

  // ---------------------------------------------------------------- busca
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const ZK2Z = (k, lat) => Math.round(Math.log2(2 ** k * 2 * Math.PI * RK * Math.cos(lat * RAD) / 256));
  const indice = [
    ...D.lugares.map((l, i) => [l, i]).filter(([l]) => l.n).map(([l, i]) => ({ n: l.n, tipo: l.t === "cidade" ? (l.cap ? "capital" : "city") : TIPO[l.t].toLowerCase(), ll: l.ll, zk: l.t === "cidade" ? 3 : 4, abre: () => abreFicha(i) })),
    ...D.rios.map((r) => ({ n: r.n, tipo: "river", ll: r.ll[r.ll.length >> 1], zk: 2 })),
    ...D.reinos.map((r) => ({ n: r.n, tipo: "realm", ll: LL(r.x, r.y), zk: 0 })),
    { n: D.vulcao.n, tipo: "volcano", ll: LL(D.vulcao.x, D.vulcao.y), zk: 3 },
    ...MU.cidades.map((c, i) => ({ n: c.n, tipo: c.t === "capital" ? "capital" : "city", ll: L.latLng(c.la, c.lo), zk: -2, abre: () => abreFichaMundo(i) })),
    ...MU.reinos.filter((r) => !D.reinos.some((q) => q.n === r.n)).map((r) => ({ n: r.n, tipo: "realm", ll: L.latLng(r.la, r.lo), zk: -4 })),
    ...MU.rotulos.filter((r) => r.t !== "rio").map((r) => ({ n: r.n, tipo: r.t === "cordilheira" ? "mountains" : r.t === "regiao" ? "region" : r.t === "continente" ? "continent" : r.t === "oceano" ? "ocean" : r.t === "mar" ? "sea" : "island", ll: L.latLng(r.la, r.lo), zk: r.t === "oceano" || r.t === "continente" ? -6 : -3.5 })),
  ].map((a) => ({ ...a, k: norm(a.n) }));
  const caixa = document.getElementById("busca"), lista = document.getElementById("resultados");
  let achados = [], sel = 0;
  function mostra() {
    lista.innerHTML = achados.map((a, i) => `<li data-i="${i}" class="${i === sel ? "ativo" : ""}">${esc(a.n)}<small>${a.tipo}</small></li>`).join("");
    lista.hidden = !achados.length;
  }
  function vai(a) {
    lista.hidden = true; caixa.value = a.n; caixa.blur();
    map.flyTo(a.ll, Math.max(map.getZoom(), ZK2Z(a.zk, a.ll.lat)), { duration: 1.4 });
    if (a.abre) map.once("moveend", a.abre);
  }
  caixa.addEventListener("input", () => {
    const q = norm(caixa.value.trim()); sel = 0;
    achados = q.length < 2 ? [] : indice.filter((a) => a.k.includes(q)).sort((a, b) => (b.k.startsWith(q) - a.k.startsWith(q)) || a.n.length - b.n.length).slice(0, 12);
    mostra();
  });
  caixa.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, achados.length - 1); mostra(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); mostra(); e.preventDefault(); }
    else if (e.key === "Enter" && achados[sel]) vai(achados[sel]);
    else if (e.key === "Escape") lista.hidden = true;
  });
  lista.addEventListener("click", (e) => { const li = e.target.closest("li"); if (li) vai(achados[+li.dataset.i]); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".busca")) lista.hidden = true; });

  // ---------------------------------------------------------------- controles
  function aplica() {
    raiz.dataset.epoca = S.epoca;
    for (const c of camadas) {
      const vs = c.c === "regiao" ? ["dia", "escuro"] : [c.c];
      for (const v of vs) {
        const quer = c.c !== "regiao" || v === S.epoca;
        if (quer) { c.lay[v] ||= tileLayer(c, v); c.lay[v].addTo(map); } else if (c.lay[v]) c.lay[v].remove();
      }
    }
    if (S.epoca === "escuro") sois.addTo(map); else sois.remove();
    document.getElementById("sobre-dia").hidden = S.epoca === "escuro";
    document.getElementById("sobre-escuro").hidden = S.epoca !== "escuro";
    if (S.hex) { hex.redraw(); hex.addTo(map); } else hex.remove();
    estiloLinhas(); sobDemanda(); atualizaLugares(); desenhaRotulos(); salvaHash();
  }
  function salvaHash() {
    const c = map.getCenter();
    const h = new URLSearchParams({ z: map.getZoom(), la: c.lat.toFixed(3), lo: c.lng.toFixed(3) });
    if (S.epoca !== "dia") h.set("t", S.epoca);
    if (S.dens) h.set("d", S.dens);
    if (S.hex) h.set("hex", "1");
    if (fichaAberta) h.set("p", fichaAberta);
    history.replaceState(null, "", "#" + h);
  }
  document.querySelectorAll("input[name=epoca]").forEach((i) => { i.checked = i.value === S.epoca; i.onchange = () => { S.epoca = i.value; aplica(); }; });
  document.querySelectorAll("input[name=dens]").forEach((i) => { i.checked = +i.value === S.dens; i.onchange = () => { S.dens = +i.value; aplica(); }; });
  const liga = (id, k) => { const el = document.getElementById(id); el.checked = S[k]; el.onchange = () => { S[k] = el.checked; aplica(); }; };
  liga("c-nomes", "nomes"); liga("c-lugares", "lugares"); liga("c-hex", "hex");
  const painel = document.getElementById("painel"), abre = document.getElementById("abre");
  document.getElementById("fecha").onclick = () => { painel.hidden = true; abre.hidden = false; };
  abre.onclick = () => { painel.hidden = false; abre.hidden = true; };
  if (innerWidth < 600) { painel.hidden = true; abre.hidden = false; }
  L.DomEvent.disableClickPropagation(painel); L.DomEvent.disableScrollPropagation(painel);

  map.on("zoomend", () => { estiloLinhas(); sobDemanda(); atualizaLugares(); });
  map.on("moveend", () => { sobDemanda(); desenhaRotulos(); salvaHash(); });
  await Promise.all(Object.values(FONTE).map(([f]) => document.fonts.load(f, "Nälsam").catch(() => {})));
  aplica();
  const ph = hash.get("p");
  if (ph) ph.startsWith("m") ? abreFichaMundo(+ph.slice(1)) : abreFicha(+ph);
})();
