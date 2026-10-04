/* Myrn — mapa navegavel da costa de Nälsam. Unidade do mapa = km (L.CRS.Simple): no zoom z, 1 km = 2^z px. */
(async function () {
  "use strict";
  const D = await (await fetch("dados.json")).json();
  const [X0, X1, Y0, Y1] = D.ext;
  const LL = (x, y) => L.latLng(y, x);
  const BOUNDS = L.latLngBounds(LL(X0, Y0), LL(X1, Y1));
  const raiz = document.documentElement;

  // ---------------------------------------------------------------- estado (com hash na URL)
  const S = { epoca: "dia", dens: 0, nomes: true, lugares: true, hex: false };
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("t") === "escuro") S.epoca = "escuro";
  if (hash.has("d")) S.dens = Math.max(-1, Math.min(1, +hash.get("d") || 0));
  if (hash.get("hex") === "1") S.hex = true;

  const map = L.map("map", {
    crs: L.CRS.Simple, minZoom: -1, maxZoom: 7, zoomSnap: 1, zoomDelta: 1, wheelPxPerZoomLevel: 100,
    maxBounds: BOUNDS.pad(0.15), maxBoundsViscosity: 0.8, attributionControl: true, zoomControl: false,
  });
  L.control.zoom({ position: "topright" }).addTo(map);
  map.attributionControl.setPrefix(false).addAttribution("Myrn · a world built by Caio · <a href=\"https://leafletjs.com\">Leaflet</a>");
  if (hash.has("z") && hash.has("x") && hash.has("y")) map.setView(LL(+hash.get("x"), +hash.get("y")), +hash.get("z"));
  else map.fitBounds(BOUNDS, { padding: [10, 10] });

  // ---------------------------------------------------------------- tiles
  const VAZIO = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  const tiles = {}, detalhe = {};
  for (const v of ["dia", "escuro"]) {
    tiles[v] = L.tileLayer(`tiles/${v}/{z}/{x}/{y}.webp`, {
      minNativeZoom: 0, maxNativeZoom: D.zmax ?? 3, minZoom: -1, maxZoom: 7, bounds: BOUNDS, noWrap: true,
      keepBuffer: 4, updateWhenZooming: false, errorTileUrl: VAZIO,
    });
    // W9: os zooms mais fundos so existem em caixas (z5 na campanha, z6 do vulcao a Dejgomesvav);
    // cada um vai por cima do anterior ampliado
    detalhe[v] = (D.fundos || []).map((f) => L.tileLayer(`tiles/${v}/{z}/{x}/{y}.webp`, {
      minNativeZoom: f.z, maxNativeZoom: f.z, minZoom: f.z, maxZoom: 7, noWrap: true, zIndex: 1 + f.z,
      bounds: L.latLngBounds(LL(f.caixa[0], f.caixa[2]), LL(f.caixa[1], f.caixa[3])), errorTileUrl: VAZIO,
    }));
  }

  // ---------------------------------------------------------------- linhas (vetor: nitidas em qualquer zoom)
  // Geometria colhida do mapa aprovado (web.py, W6). Larguras em px no z2, como no PNG de 4 px/km;
  // o fator K engrossa de perto e afina de longe. Uma polilinha multipla por estilo (poucas camadas).
  map.createPane("linhas").style.zIndex = 380;
  const rLinhas = L.canvas({ pane: "linhas", padding: 0.6 });
  const K = { "-1": 0.45, 0: 0.55, 1: 0.75, 2: 1, 3: 1.25, 4: 1.55, 5: 1.9, 6: 2.3, 7: 2.7 };
  const PT = 200 / 72;                                   // pt do matplotlib -> px no z2
  const camadasLinha = [];                               // {layer, peso, zmin, zmax, epoca}
  const LLs = (pts) => pts.map(([x, y]) => [y, x]);
  function linha(pls, est, opts = {}) {
    if (!pls.length) return;
    const lay = L.polyline(pls.map(LLs), { renderer: rLinhas, interactive: false, lineCap: "round", lineJoin: "round",
      smoothFactor: 0.6, ...est });
    camadasLinha.push({ lay, peso: est.weight, dash: est.dashArray, ...opts });
  }
  function estiloLinhas() {
    const z = map.getZoom(), k = K[Math.max(-1, Math.min(7, Math.round(z)))];
    for (const c of camadasLinha) {
      const ver = z >= (c.zmin ?? -9) && z <= (c.zmax ?? 99) && (!c.epoca || c.epoca === S.epoca);
      if (!ver) { c.lay.remove(); continue; }
      const st = { weight: Math.max(c.peso * k, 0.35) };
      if (c.dash) st.dashArray = c.dash.split(",").map((v) => (+v * k).toFixed(1)).join(",");
      c.lay.setStyle(st);
      if (!map.hasLayer(c.lay)) c.lay.addTo(map);
    }
  }
  const pts = (it) => (Array.isArray(it) ? it : it.p);
  async function carregaLinhas(arq) { return (await fetch(arq)).json(); }
  const LV = await carregaLinhas("linhas.json");
  // costa e lagos
  linha(LV.costa.map(pts), { color: "#2F6E9E", weight: 0.6 * PT });
  linha(LV.lago.map(pts), { color: "#2F6E9E", weight: 0.4 * PT });
  // rios: largura pela vazao (w = lw em pt do mapa aprovado); de longe so os grandes (W3)
  const faixas = {};
  for (const r of LV.rio) { const w = Math.round(r.w * 10) / 10; (faixas[w] ||= []).push(r.p); }
  for (const [w, pl] of Object.entries(faixas))
    linha(pl, { color: "#3C86C6", weight: +w * PT }, { zmin: w >= 0.9 ? -9 : w >= 0.55 ? 1 : w >= 0.32 ? 2 : 3 });
  // fronteiras
  linha(LV.fronteira.map(pts), { color: "#7B3F8C", weight: 1.3 * PT, opacity: 0.75, dashArray: `${5 * PT},${2.5 * PT}`, lineCap: "butt" });
  // estradas: contorno branco + traco
  const est = LV.estrada.map(pts);
  linha(est, { color: "#fff", weight: 2.0 * PT, opacity: 0.7 });
  linha(est, { color: "#8E3B2B", weight: 1.1 * PT });
  // borda da sombra (so no Escuro)
  for (const s of LV["sombra-antes"]) linha([s.p], { color: "#1b1640", weight: s.w * PT, opacity: 0.85, dashArray: `${6 * PT},${3 * PT}`, lineCap: "butt" }, { epoca: "escuro" });
  for (const s of LV.sombra) linha([s.p], { color: "#1b1640", weight: s.w * PT, opacity: 0.85 }, { epoca: "escuro" });
  // trilha e curva de nivel: arquivos a parte, so quando o zoom pede
  let pedidoTrilha = null, pedidoCurva = null;
  function sobDemanda() {
    const z = map.getZoom();
    if (z >= 2 && !pedidoTrilha) pedidoTrilha = carregaLinhas("trilhas.json").then((d) => {
      linha(d.trilha, { color: "#7A6A55", weight: 0.32 * PT, opacity: 0.6 }, { zmin: 2 }); estiloLinhas(); });
    if (z >= 1 && !pedidoCurva) pedidoCurva = carregaLinhas("curvas.json").then((d) => {
      const fina = d.curva.filter((c) => c.h % 1000).map(pts), grossa = d.curva.filter((c) => !(c.h % 1000)).map(pts);
      linha(fina, { color: "#6B4A2B", weight: 0.25 * PT, opacity: 0.35 }, { zmin: 2 });
      linha(grossa, { color: "#6B4A2B", weight: 0.45 * PT, opacity: 0.35 }, { zmin: 1 });
      estiloLinhas(); });
  }

  // ---------------------------------------------------------------- assentamentos
  const canvas = L.canvas({ padding: 0.5, tolerance: 4 });
  const TIPO = { cidade: "City", mercado: "Market town", vila: "Village", acampamento: "Dekirio camp" };
  const ESTADO = { viva: "inhabited", minguando: "dwindling", sol: "under a Tirsång", refugio: "swollen with refugees",
    abandonada: "abandoned", destruida: "destroyed on the Day" };
  const fmt = (n) => n.toLocaleString("en-US");

  // a partir de que zoom cada lugar aparece (simbolo)
  function zSimbolo(l) {
    if (l.t === "cidade") return -1;
    if (l.t === "mercado") return 0;
    if (l.t === "acampamento") return 3;
    return l.p >= 400 ? 1 : l.p >= 150 ? 2 : 3;
  }
  function estilo(l, z) {
    const esc = S.epoca === "escuro";
    const g = Math.max(0, z - 2) * 0.6;                         // cresce de perto
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
  const marcas = D.lugares.map((l) => {
    const m = L.circleMarker(LL(l.x, l.y), { renderer: canvas, ...estilo(l, 0) });
    m.on("click", (e) => { L.DomEvent.stop(e); abreFicha(D.lugares.indexOf(l)); });
    m._l = l;
    return m;
  });
  const grupoLugares = L.layerGroup().addTo(map);
  let visiveis = new Set();
  function atualizaLugares() {
    const z = map.getZoom();
    const quero = new Set();
    if (S.lugares) for (const m of marcas) {
      const l = m._l;
      if (S.epoca === "escuro" && l.t !== "cidade" && l.t !== "mercado" && l.e === "abandonada" && z < 2) continue;
      if (z >= zSimbolo(l)) quero.add(m);
    }
    for (const m of visiveis) if (!quero.has(m)) grupoLugares.removeLayer(m);
    for (const m of quero) { m.setStyle(estilo(m._l, z)); m.setRadius(estilo(m._l, z).radius); if (!visiveis.has(m)) grupoLugares.addLayer(m); }
    visiveis = quero;
  }

  // vulcao e sois
  const vulcao = L.marker(LL(D.vulcao.x, D.vulcao.y), {
    icon: L.divIcon({ className: "", html: '<div class="ico-vulcao"></div>', iconSize: [18, 15], iconAnchor: [9, 13] }),
  }).bindPopup(`<div class="pp"><h3>${D.vulcao.n}</h3><p class="sig">the mountain of the Day</p><dl>
    <dt>Erupted</dt><dd>end of 3600</dd><dt>Range</dt><dd>Jylefjön, dead for 320 million years</dd></dl>
    <p style="margin:6px 0 0">No sage can say why it burns. The ash it raises never settles.</p></div>`).addTo(map);
  const sois = L.layerGroup(D.sois.map((o) => L.marker(LL(o.x, o.y), {
    icon: L.divIcon({ className: "", html: '<div class="ico-sol"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
  }).bindPopup(`<div class="pp"><h3>Tirsång</h3><p class="sig">“fire-sun”</p><dl>
    <dt>Lit</dt><dd>${o.ano}</dd><dt>Owner</dt><dd>${o.dono}</dd></dl></div>`)));

  // ---------------------------------------------------------------- grade de hex (6 milhas entre lados)
  const HEX_KM = 6 * 1.609344, HS = HEX_KM / Math.sqrt(3);    // lado plano a lado plano; HS = centro ao vertice
  const Hex = L.GridLayer.extend({
    createTile(c) {
      const t = document.createElement("canvas"), sz = this.getTileSize();
      t.width = sz.x; t.height = sz.y;
      const z = c.z, s = 2 ** z, ctx = t.getContext("2d");
      const kx0 = (c.x * sz.x) / s, ky0 = -(c.y * sz.y) / s;   // canto superior esquerdo em km
      const kx1 = kx0 + sz.x / s, ky1 = ky0 - sz.y / s;
      const px = (x) => (x - kx0) * s, py = (y) => (ky0 - y) * s;
      const escuro = S.epoca === "escuro";
      ctx.strokeStyle = escuro ? "rgba(230,225,255,.28)" : "rgba(60,40,20,.32)";
      ctx.lineWidth = z >= 4 ? 1.1 : 0.8;
      ctx.font = "10px 'Alegreya Sans', sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = escuro ? "rgba(230,225,255,.55)" : "rgba(60,40,20,.55)";
      const dx = 1.5 * HS, dy = HEX_KM;
      for (let q = Math.floor((kx0 - HS) / dx); q <= Math.ceil((kx1 + HS) / dx); q++) {
        const off = (q & 1) ? dy / 2 : 0;
        for (let r = Math.floor((ky1 - dy - off) / dy); r <= Math.ceil((ky0 + dy - off) / dy); r++) {
          const cx = q * dx, cy = r * dy + off;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k;
            const x = px(cx + HS * Math.cos(a)), y = py(cy + HS * Math.sin(a));
            k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.closePath(); ctx.stroke();
          if (z >= 4) ctx.fillText(`${String(q + 100).padStart(3, "0")}.${String(-r + 100).padStart(3, "0")}`, px(cx), py(cy) - HS * s * 0.62);
        }
      }
      return t;
    },
  });
  const hex = new Hex({ minZoom: 1, maxZoom: 6, bounds: BOUNDS, pane: "overlayPane" });

  // ---------------------------------------------------------------- rotulos (anticolisao por zoom)
  map.createPane("rotulos").style.zIndex = 450;
  const painelRot = map.getPane("rotulos");
  const ctxMede = document.createElement("canvas").getContext("2d");
  const FONTE = {
    reino: ["700 15px Alegreya", 15, 0.25], mar: ["italic 400 16px Alegreya", 16, 0], serra: ["italic 400 12px Alegreya", 12, 0.2],
    cap: ["700 16px Alegreya", 16, 0], cid: ["400 14px Alegreya", 14, 0], mer: ["500 13px 'Alegreya Sans'", 13, 0],
    vila: ["400 12px 'Alegreya Sans'", 12, 0], rio: ["italic 400 12.5px Alegreya", 12.5, 0], pico: ["400 10.5px 'Alegreya Sans'", 10.5, 0],
    vulcao: ["700 13px Alegreya", 13, 0.12], sol: ["700 12px 'Alegreya Sans'", 12, 0],
  };
  function mede(txt, cls) {
    const [f, h, esp] = FONTE[cls];
    ctxMede.font = f;
    const sup = /reino|serra/.test(cls) ? txt.toUpperCase() : txt;
    return [ctxMede.measureText(sup).width + esp * h * sup.length, h];
  }
  // candidatos: [classe css, fonte, texto, x, y, zmin, prioridade, raio do simbolo, extra]
  function candidatos() {
    const esc = S.epoca === "escuro", d = S.dens;
    const C = [];
    C.push({ c: "vulcao", t: D.vulcao.n.toUpperCase(), x: D.vulcao.x, y: D.vulcao.y, z: -1, p: 1000, r: 10, lado: [[12, 4]] });
    for (const r of D.reinos) C.push({ c: "reino", t: r.n, x: r.x, y: r.y, z: -1, zmax: 3.5, p: 900 + r.a / 1e4, r: 0, centro: 1 });
    for (const f of D.feicoes) C.push({ c: f.t === "mar" ? "mar" : "serra", t: f.n, x: f.x, y: f.y, z: f.t === "mar" ? -1 : 0, zmax: 5, p: 800, r: 0, centro: 1 });
    for (const [i, l] of D.lugares.entries()) {
      if (!l.n) continue;
      const n0 = C.length;
      const morta = esc && l.e === "abandonada";
      if (l.t === "cidade") C.push({ c: l.cap ? "cap" : "cid", t: l.n + (l.e === "destruida" ? " (ruin)" : ""), x: l.x, y: l.y, z: l.cap ? -1 : 0, p: (l.cap ? 700 : 600) + l.p / 1e4, r: 7 });
      else if (l.t === "mercado") C.push({ c: "mer", t: l.n, x: l.x, y: l.y, z: 1 + d, p: 500 + l.p / 1e4, r: 5 });
      else if (l.t === "vila") C.push({ c: "vila" + (morta ? " morta" : ""), f: "vila", t: l.n, x: l.x, y: l.y, z: (l.p >= 250 ? 2 : l.p >= 110 ? 3 : 4) + d, p: 100 + (esc ? l.p7 : l.p) / 100 - (morta ? 50 : 0), r: 3 });
      else if (l.t === "acampamento") C.push({ c: "vila", t: l.n, x: l.x, y: l.y, z: 4 + d, p: 50 + l.p / 100, r: 3 });
      if (C.length > n0) C[C.length - 1].i = i;
    }
    for (const r of D.rios) C.push({ c: "rio", t: r.n, rio: r, z: r.km > 150 ? 1 : 2 + Math.max(d, 0), p: 400 + r.km / 100 });
    for (const k of D.picos) C.push({ c: "pico", t: `▲ ${fmt(k.h)} m`, x: k.x, y: k.y, z: 3 + d, p: 40 + k.h / 1e4, r: 0, centro: 1 });
    if (esc) for (const o of D.sois) C.push({ c: "sol", t: "Tirsång", x: o.x, y: o.y, z: 1.5 + d, p: 650, r: 13, lado: [[0, 15], [0, -15]] });
    return C.sort((a, b) => b.p - a.p);
  }
  const LADOS = [[1, 0], [-1, 0], [0, -1], [0, 1], [0.8, -0.8], [-0.8, 0.8]];
  function desenhaRotulos() {
    painelRot.innerHTML = "";
    if (!S.nomes) return;
    const z = map.getZoom(), tam = map.getSize();
    const caixas = [];
    const livre = (b) => !caixas.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    const frag = document.createDocumentFragment();
    // simbolos das cidades e mercados visiveis reservam espaco
    for (const m of visiveis) {
      const l = m._l; if (l.t !== "cidade" && l.t !== "mercado") continue;
      const p = map.latLngToContainerPoint(m.getLatLng()), r = m.getRadius() + 1;
      caixas.push([p.x - r, p.y - r, p.x + r, p.y + r]);
    }
    if (S.epoca === "escuro") for (const o of D.sois) {
      const p = map.latLngToContainerPoint(LL(o.x, o.y));
      caixas.push([p.x - 9, p.y - 9, p.x + 9, p.y + 9]);
    }
    for (const k of candidatos()) {
      if (z < k.z || (k.zmax !== undefined && z > k.zmax)) continue;
      const cresce = k.r ? Math.max(0, z - 2) * 0.6 : 0;   // o simbolo cresce de perto (estilo())
      const fcls = k.f || k.c.split(" ")[0];
      const [w, h] = mede(k.t, fcls);
      let px, py, ang = 0;
      if (k.rio) {                                  // rio: no trecho mais central visivel, ao longo do curso
        const pts = k.rio.pts.map(([x, y]) => map.latLngToContainerPoint(LL(x, y)));
        const dentro = pts.map((p, i) => [p, i]).filter(([p]) => p.x > 30 && p.y > 30 && p.x < tam.x - 30 && p.y < tam.y - 30);
        if (dentro.length < 3) continue;
        const i = dentro[Math.floor(dentro.length / 2)][1];
        const a = pts[Math.max(i - 2, 0)], b = pts[Math.min(i + 2, pts.length - 1)];
        if (a.distanceTo(b) < w * 0.5) continue;    // curso curto demais na tela pro nome
        ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
        px = pts[i].x; py = pts[i].y;
        const rw = Math.abs(w * Math.cos(ang)) + Math.abs(h * Math.sin(ang)), rh = Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang));
        const b2 = [px - rw / 2, py - rh / 2 - 6, px + rw / 2, py + rh / 2 - 6];
        if (!livre(b2)) continue;
        caixas.push(b2); py -= 6;
      } else {
        const p = map.latLngToContainerPoint(LL(k.x, k.y));
        if (p.x < -200 || p.y < -50 || p.x > tam.x + 200 || p.y > tam.y + 50) continue;
        const opcoes = k.centro ? [[0, 0]] : k.lado || LADOS.map(([a, b]) => [a * (k.r + cresce + 3 + (a ? w / 2 : 0)), b * (k.r + cresce + 2 + h / 2)]);
        let ok = null;
        for (const [ox, oy] of opcoes) {
          const cx = p.x + ox, cy = p.y + oy;
          const b2 = [cx - w / 2 - 1, cy - h / 2, cx + w / 2 + 1, cy + h / 2];
          if (livre(b2)) { ok = b2; px = cx; py = cy; break; }
        }
        if (!ok) continue;
        caixas.push(ok);
      }
      const el = document.createElement("div");
      el.className = "rt " + k.c;
      el.textContent = k.t;
      const [f] = FONTE[fcls];
      el.style.font = f;
      const lp = map.containerPointToLayerPoint([px, py]);
      el.style.transform = `translate(${lp.x}px, ${lp.y}px) translate(-50%, -50%)` + (ang ? ` rotate(${ang}rad)` : "");
      el.style.left = "0"; el.style.top = "0";
      if (k.i !== undefined) { el.dataset.i = k.i; el.classList.add("clica"); }
      frag.appendChild(el);
    }
    painelRot.appendChild(frag);
  }


  // ---------------------------------------------------------------- ficha do lugar (W11, a la Azgaar)
  const fichaEl = document.getElementById("ficha");
  let INFO = null, fichaAberta = -1;
  map.createPane("selecao").style.zIndex = 460;
  const anel = L.circleMarker([0, 0], { radius: 13, color: "#c0392b", weight: 2.5, fill: false, interactive: false, pane: "selecao" });
  painelRot.addEventListener("click", (e) => {
    const el = e.target.closest(".clica"); if (!el) return;
    e.stopPropagation(); abreFicha(+el.dataset.i);
  });
  L.DomEvent.disableClickPropagation(fichaEl); L.DomEvent.disableScrollPropagation(fichaEl);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function semente(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; }
  function planta(l, f) {
    // watabou: Medieval Fantasy City Generator pra cidade e mercado, Village Generator pra vila e acampamento
    const seed = semente(l.n + l.x + l.y) % 2147483647;
    if (l.t === "vila" || l.t === "acampamento") return `https://watabou.github.io/village-generator/?seed=${seed}`;
    const p = new URLSearchParams({ size: Math.max(6, Math.min(40, Math.round(l.p / 250))), seed, name: l.n,
      citadel: l.cap ? 1 : 0, walls: l.t === "cidade" ? 1 : 0, plaza: 1, temple: 1, river: f.rio ? 1 : 0,
      coast: f.costa || l.porto ? 1 : 0, greens: 0, shantytown: l.t === "cidade" ? 1 : 0, random: 0 });
    return `https://watabou.github.io/city-generator/?${p}`;
  }
  async function abreFicha(i) {
    const l = D.lugares[i]; if (!l) return;
    if (!INFO) INFO = await (await fetch("info.json")).json();
    const f = INFO.lugares[i] || {}, escuro = S.epoca === "escuro";
    let tipo = TIPO[l.t];
    if (l.t === "cidade") tipo = l.cap ? "Capital" : (l.e === "destruida" ? "City, destroyed on the Day" : "City");
    if (l.porto) tipo += " · port";
    const nome = l.n || (l.t === "acampamento" ? "Unnamed camp" : "Unnamed hamlet");
    const pecas = (f.pc || []).map(([, en]) => `<i>${esc(en)}</i>`).join(" + ");
    const linhas = [["Type", tipo]];
    if (l.r) linhas.push(["Realm", esc(l.r)]);
    linhas.push(["People", escuro ? `${fmt(l.p7)} in 3607 <small>(${fmt(l.p)} before the Day)</small>` : `${fmt(l.p)}`]);
    if (escuro) linhas.push(["State", ESTADO[l.e] || l.e]);
    if (f.fund) linhas.push(["Founded", `year ${f.fund}`]);
    linhas.push(["Elevation", `${fmt(f.alt)} m`]);
    if (f.bio) linhas.push(["Land", f.bio + (f.rio ? ", on a river" : "") + (f.costa ? ", by the sea" : "")]);
    if (f.tq !== undefined) linhas.push(["Climate", `${f.tq} °C in high summer, ${f.tf} °C in deep winter; ${fmt(f.pr)} mm of rain a year`]);
    const ev = (f.ev || []).map((n) => INFO.eventos[n]).map(([ano, t]) => `<li><b>${ano}</b> ${esc(t)}</li>`).join("");
    fichaEl.innerHTML = `<button class="fecha" aria-label="Close">×</button>
      <h2>${esc(nome)}</h2>
      ${f.ipa ? `<p class="ipa">/${esc(f.ipa)}/</p>` : ""}
      ${l.en ? `<p class="sig">“${esc(l.en)}”${pecas ? ` <span>— ${pecas}</span>` : ""}</p>` : ""}
      ${f.lg ? `<p class="lg">${esc(f.lg)}${f.proto ? `, from Proto <i>*${esc(f.proto)}</i>` : ""}</p>` : ""}
      <dl>${linhas.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl>
      ${ev ? `<h3>Chronicle</h3><ul class="cron">${ev}</ul>` : ""}
      ${l.n ? `<a class="planta" href="${planta(l, f)}" target="_blank" rel="noopener">${l.t === "vila" || l.t === "acampamento" ? "Village layout" : "Town plan"} ↗</a>
      <p class="nota">Layout drawn by watabou's generator, seeded by this place.</p>` : ""}`;
    fichaEl.hidden = false; fichaAberta = i;
    anel.setLatLng(LL(l.x, l.y)).addTo(map);
    // o lugar nao pode ficar debaixo da ficha: no celular sobe, no desktop vai pra esquerda
    const p = map.latLngToContainerPoint(LL(l.x, l.y)), tam = map.getSize();
    if (innerWidth < 600) { if (p.y > tam.y * 0.32) map.panBy([0, p.y - tam.y * 0.22]); }
    else if (p.x > tam.x - 420) map.panBy([p.x - (tam.x - 420) / 2, 0]);
    fichaEl.querySelector(".fecha").onclick = fechaFicha;
    salvaHash();
  }
  function fechaFicha() { fichaEl.hidden = true; fichaAberta = -1; anel.remove(); salvaHash(); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && fichaAberta >= 0) fechaFicha(); });

  // ---------------------------------------------------------------- escala km / milhas
  const Escala = L.Control.extend({
    options: { position: "bottomright" },
    onAdd() { this._d = L.DomUtil.create("div", "escala"); return this._d; },
    atualiza() {
      const kmpx = 1 / 2 ** map.getZoom();
      const bom = (alvo) => { const e = 10 ** Math.floor(Math.log10(alvo)); return [1, 2, 5, 10].map((m) => m * e).filter((v) => v <= alvo).pop(); };
      const km = bom(120 * kmpx), mi = bom(120 * kmpx / 1.609344);
      this._d.innerHTML = `<div class="barra" style="width:${km / kmpx}px"></div>${km} km` +
        `<div class="barra" style="width:${mi * 1.609344 / kmpx}px;margin-top:4px"></div>${mi} mi`;
    },
  });
  const escala = new Escala().addTo(map);

  // ---------------------------------------------------------------- busca
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const indice = [
    ...D.lugares.filter((l) => l.n).map((l) => ({ n: l.n, k: norm(l.n), tipo: l.t === "cidade" ? (l.cap ? "capital" : "city") : TIPO[l.t].toLowerCase(), x: l.x, y: l.y, z: l.t === "cidade" ? 3 : 4, l })),
    ...D.rios.map((r) => ({ n: r.n, k: norm(r.n), tipo: "river", x: r.pts[r.pts.length >> 1][0], y: r.pts[r.pts.length >> 1][1], z: 2 })),
    ...D.reinos.map((r) => ({ n: r.n, k: norm(r.n), tipo: "realm", x: r.x, y: r.y, z: 1 })),
    { n: D.vulcao.n, k: norm(D.vulcao.n), tipo: "volcano", x: D.vulcao.x, y: D.vulcao.y, z: 3 },
  ];
  const caixa = document.getElementById("busca"), lista = document.getElementById("resultados");
  let achados = [], sel = 0;
  function mostra() {
    lista.innerHTML = achados.map((a, i) => `<li data-i="${i}" class="${i === sel ? "ativo" : ""}">${a.n}<small>${a.tipo}</small></li>`).join("");
    lista.hidden = !achados.length;
  }
  function vai(a) {
    lista.hidden = true; caixa.value = a.n; caixa.blur();
    map.flyTo(LL(a.x, a.y), Math.max(map.getZoom(), a.z), { duration: 1.2 });
    if (a.l) abreFicha(D.lugares.indexOf(a.l));
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
    for (const v in tiles) if (v === S.epoca) tiles[v].addTo(map); else tiles[v].remove();
    for (const v in detalhe) for (const t of detalhe[v]) if (v === S.epoca) t.addTo(map); else t.remove();
    if (S.epoca === "escuro") sois.addTo(map); else sois.remove();
    document.getElementById("sobre-dia").hidden = S.epoca === "escuro";
    document.getElementById("sobre-escuro").hidden = S.epoca !== "escuro";
    if (S.hex) { hex.redraw(); hex.addTo(map); } else hex.remove();
    estiloLinhas(); sobDemanda(); atualizaLugares(); desenhaRotulos(); escala.atualiza(); salvaHash();
  }
  function salvaHash() {
    const c = map.getCenter();
    const h = new URLSearchParams({ z: map.getZoom(), x: c.lng.toFixed(1), y: c.lat.toFixed(1) });
    if (S.epoca !== "dia") h.set("t", S.epoca);
    if (S.dens) h.set("d", S.dens);
    if (S.hex) h.set("hex", "1");
    if (typeof fichaAberta !== "undefined" && fichaAberta >= 0) h.set("p", fichaAberta);
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

  map.on("zoomend", () => { estiloLinhas(); sobDemanda(); atualizaLugares(); escala.atualiza(); });
  map.on("moveend", () => { desenhaRotulos(); salvaHash(); });
  await Promise.all(Object.values(FONTE).map(([f]) => document.fonts.load(f, "Nälsam").catch(() => {})));
  aplica();
  if (hash.has("p")) abreFicha(+hash.get("p"));
})();
