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
    crs: L.CRS.Simple, minZoom: -1, maxZoom: 6, zoomSnap: 1, zoomDelta: 1, wheelPxPerZoomLevel: 100,
    maxBounds: BOUNDS.pad(0.15), maxBoundsViscosity: 0.8, attributionControl: true, zoomControl: false,
  });
  L.control.zoom({ position: "topright" }).addTo(map);
  map.attributionControl.setPrefix(false).addAttribution("Myrn · a world built by Caio · <a href=\"https://leafletjs.com\">Leaflet</a>");
  if (hash.has("z") && hash.has("x") && hash.has("y")) map.setView(LL(+hash.get("x"), +hash.get("y")), +hash.get("z"));
  else map.fitBounds(BOUNDS, { padding: [10, 10] });

  // ---------------------------------------------------------------- tiles
  const tiles = {};
  for (const v of ["dia", "escuro"]) {
    tiles[v] = L.tileLayer(`tiles/${v}/{z}/{x}/{y}.webp`, {
      minNativeZoom: 0, maxNativeZoom: 3, minZoom: -1, maxZoom: 6, bounds: BOUNDS, noWrap: true,
      keepBuffer: 4, updateWhenZooming: false,
    });
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
  function popup(l) {
    const esc = S.epoca === "escuro";
    const nome = l.n || (l.t === "acampamento" ? "Unnamed camp" : "Unnamed hamlet");
    let tipo = TIPO[l.t];
    if (l.t === "cidade") tipo = l.cap ? "Capital" : "City (former capital)";
    if (l.porto) tipo += ", port";
    const linhas = [["Type", tipo]];
    if (l.r) linhas.push(["Realm", l.r]);
    linhas.push(["People", esc ? `${fmt(l.p7)} <small>(${fmt(l.p)} before the Day)</small>` : fmt(l.p)]);
    if (esc || l.e === "destruida") linhas.push(["State", ESTADO[l.e] || l.e]);
    return `<div class="pp"><h3>${nome}</h3>${l.en ? `<p class="sig">“${l.en}”</p>` : ""}<dl>${
      linhas.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl></div>`;
  }
  const marcas = D.lugares.map((l) => {
    const m = L.circleMarker(LL(l.x, l.y), { renderer: canvas, ...estilo(l, 0) });
    m.bindPopup(() => popup(l), { autoPanPadding: [40, 40] });
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
    for (const l of D.lugares) {
      if (!l.n) continue;
      const morta = esc && l.e === "abandonada";
      if (l.t === "cidade") C.push({ c: l.cap ? "cap" : "cid", t: l.n + (l.e === "destruida" ? " (ruin)" : ""), x: l.x, y: l.y, z: l.cap ? -1 : 0, p: (l.cap ? 700 : 600) + l.p / 1e4, r: 7 });
      else if (l.t === "mercado") C.push({ c: "mer", t: l.n, x: l.x, y: l.y, z: 1 + d, p: 500 + l.p / 1e4, r: 5 });
      else if (l.t === "vila") C.push({ c: "vila" + (morta ? " morta" : ""), f: "vila", t: l.n, x: l.x, y: l.y, z: (l.p >= 250 ? 2 : l.p >= 110 ? 3 : 4) + d, p: 100 + (esc ? l.p7 : l.p) / 100 - (morta ? 50 : 0), r: 3 });
      else if (l.t === "acampamento") C.push({ c: "vila", t: l.n, x: l.x, y: l.y, z: 4 + d, p: 50 + l.p / 100, r: 3 });
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
        const opcoes = k.centro ? [[0, 0]] : k.lado || LADOS.map(([a, b]) => [a * (k.r + 3 + (a ? w / 2 : 0)) , b * (k.r + 2 + h / 2)]);
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
      frag.appendChild(el);
    }
    painelRot.appendChild(frag);
  }

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
    if (a.l) map.once("moveend", () => { const m = marcas.find((m) => m._l === a.l); if (m) { if (!grupoLugares.hasLayer(m)) grupoLugares.addLayer(m); m.openPopup(); } });
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
    if (S.epoca === "escuro") sois.addTo(map); else sois.remove();
    document.getElementById("sobre-dia").hidden = S.epoca === "escuro";
    document.getElementById("sobre-escuro").hidden = S.epoca !== "escuro";
    if (S.hex) { hex.redraw(); hex.addTo(map); } else hex.remove();
    atualizaLugares(); desenhaRotulos(); escala.atualiza(); salvaHash();
  }
  function salvaHash() {
    const c = map.getCenter();
    const h = new URLSearchParams({ z: map.getZoom(), x: c.lng.toFixed(1), y: c.lat.toFixed(1) });
    if (S.epoca !== "dia") h.set("t", S.epoca);
    if (S.dens) h.set("d", S.dens);
    if (S.hex) h.set("hex", "1");
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

  map.on("zoomend", () => { atualizaLugares(); escala.atualiza(); });
  map.on("moveend", () => { desenhaRotulos(); salvaHash(); });
  await Promise.all(Object.values(FONTE).map(([f]) => document.fonts.load(f, "Nälsam").catch(() => {})));
  aplica();
})();
