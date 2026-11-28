/* Rádio CNB News — barra fixa + navegação sem recarregar ENQUANTO a rádio toca.
   Sem rádio tocando, nada muda no site (cada clique recarrega a página: AdSense e GA4 como sempre).
   Com a rádio tocando: o clique em link interno busca a página, troca o #pagina (a barra fica), reexecuta
   os scripts da página, atualiza título/URL e manda page_view ao GA4. AdSense NÃO é reinserido (sem refresh de anúncio).
   Subdomínio de cidade: o link vira news.cnbmobile.com/cidades/<cidade>/... (mesma página; canonical continua no subdomínio). */
(function () {
  "use strict";
  var barra = document.querySelector("[data-radio-barra]");
  if (!barra || !window.fetch || !window.history || !window.DOMParser) return;

  var PRINCIPAL = "news.cnbmobile.com";
  var COOKIE_TESTE = "cnb-radio-teste";
  var url = barra.getAttribute("data-url");
  var btPlay = barra.querySelector("[data-rb-play]"), st = barra.querySelector("[data-rb-st]");
  var btDeNovo = barra.querySelector("[data-rb-de-novo]"), btFechar = barra.querySelector("[data-rb-fechar]");
  var audio = null, tentativas = 0, timerTentativa = null, nossoHistorico = false;
  var ESPERAS = [2000, 5000, 10000];

  /* ---------- teste fechado (?radio=1) ---------- */
  function dominioCookie() { return /(^|\.)cnbmobile\.com$/.test(location.hostname) ? "; domain=.cnbmobile.com" : ""; }
  function emTeste() { return /(?:^|; )cnb-radio-teste=1/.test(document.cookie); }
  try {
    var q = new URLSearchParams(location.search).get("radio");
    if (q === "1") document.cookie = COOKIE_TESTE + "=1; path=/; max-age=172800; SameSite=Lax" + dominioCookie();
    if (q === "0") document.cookie = COOKIE_TESTE + "=; path=/; max-age=0; SameSite=Lax" + dominioCookie();
  } catch (e) {}
  if (barra.getAttribute("data-breve") && !emTeste()) return;

  /* ---------- estado visual ---------- */
  function tocando() { return !!(audio && !audio.paused && !audio.ended); }
  function status(txt) { st.textContent = txt; }
  function pinta() {
    var t = tocando();
    barra.classList.toggle("tocando", t);
    btPlay.setAttribute("aria-label", t ? "Pausar a Rádio CNB" : "Ouvir a Rádio CNB");
    document.querySelectorAll("[data-radio-abre]").forEach(function (b) {
      b.classList.toggle("tocando", t);
      b.setAttribute("aria-pressed", t ? "true" : "false");
    });
  }
  function abreBarra() {
    barra.hidden = false;
    document.body.classList.add("tem-radio");
  }
  function ligaCabecalho() {
    document.querySelectorAll("[data-radio-breve]").forEach(function (s) { s.hidden = true; });
    document.querySelectorAll("[data-radio-abre]").forEach(function (b) {
      b.hidden = false;
      b.classList.add("rd-on");
      if (b.dataset.ini) return;
      b.dataset.ini = "1";
      b.addEventListener("click", function () {
        if (irParaPrincipal()) return;
        abreBarra();
        if (tocando()) audio.pause(); else tocar();
      });
    });
    pinta();
  }

  /* ---------- player ---------- */
  function criaAudio() {
    audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("playing", function () {
      tentativas = 0; btDeNovo.hidden = true; barra.classList.remove("fora", "carregando");
      status("Ao vivo · música e notícia"); pinta();
    });
    audio.addEventListener("pause", function () { barra.classList.remove("carregando"); status("Pausada"); pinta(); });
    audio.addEventListener("waiting", function () { barra.classList.add("carregando"); status("Carregando…"); });
    audio.addEventListener("error", falhou);
    audio.addEventListener("ended", falhou); /* stream ao vivo não acaba: se acabou, caiu */
    audio.addEventListener("stalled", function () { if (!audio.paused) setTimeout(function () { if (audio.readyState < 3 && !audio.paused) falhou(); }, 8000); });
  }
  function tocar() {
    if (!audio) criaAudio();
    delete audio.dataset.parado;
    clearTimeout(timerTentativa);
    barra.classList.add("carregando"); status("Conectando…");
    audio.src = url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now(); /* ao vivo: sempre do ponto atual */
    var p = audio.play();
    if (p && p.catch) p.catch(function (e) {
      if (e && e.name === "NotAllowedError") { barra.classList.remove("carregando"); status("Toque no play para ouvir"); pinta(); }
    });
    pinta();
  }
  function falhou() {
    if (!audio || audio.dataset.parado) return;
    clearTimeout(timerTentativa);
    if (tentativas < ESPERAS.length) {
      var espera = ESPERAS[tentativas++];
      barra.classList.add("carregando"); status("Reconectando…");
      timerTentativa = setTimeout(tocar, espera);
    } else {
      barra.classList.remove("carregando"); barra.classList.add("fora");
      status("Rádio fora do ar"); btDeNovo.hidden = false;
      audio.dataset.parado = "1"; /* sem isso, o load() sem src dispara "error" e entra em laço */
      try { audio.removeAttribute("src"); audio.load(); } catch (e) {}
      pinta();
    }
  }
  btPlay.addEventListener("click", function () {
    if (irParaPrincipal()) return;
    if (tocando()) { audio.pause(); return; }
    tentativas = 0; tocar();
  });
  btDeNovo.addEventListener("click", function () { tentativas = 0; btDeNovo.hidden = true; barra.classList.remove("fora"); tocar(); });
  btFechar.addEventListener("click", function () {
    clearTimeout(timerTentativa);
    if (audio) { audio.dataset.parado = "1"; audio.pause(); audio.removeAttribute("src"); try { audio.load(); } catch (e) {} }
    barra.hidden = true; document.body.classList.remove("tem-radio"); pinta();
  });

  /* ---------- subdomínio de cidade → mesma página no domínio principal ---------- */
  function cidadeDoHost(host) { var m = host.match(/^([a-z0-9-]+)\.news\.cnbmobile\.com$/); return m ? m[1] : null; }
  function noPrincipal(u) {
    var c = cidadeDoHost(u.hostname);
    return c ? new URL("https://" + PRINCIPAL + "/cidades/" + c + u.pathname + u.search + u.hash) : u;
  }
  /* Rádio só navega sem recarregar dentro de uma origem; no subdomínio, o play leva à mesma página no principal. */
  function irParaPrincipal() {
    if (!cidadeDoHost(location.hostname)) return false;
    var u = noPrincipal(new URL(location.href));
    u.hash = "radio";
    location.href = u.href;
    return true;
  }

  /* ---------- navegação sem recarregar (só com a rádio tocando) ---------- */
  function destinoInterno(a, ev) {
    if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return null;
    if ((a.target && a.target !== "_self") || a.hasAttribute("download") || a.getAttribute("rel") === "external") return null;
    var u;
    try { u = noPrincipal(new URL(a.href, location.href)); } catch (e) { return null; }
    if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return null;
    if (/^\/(admin|api)(\/|$)/.test(u.pathname) || /\.(xml|json|txt|pdf|jpe?g|png|webp|mp3|zip)$/i.test(u.pathname)) return null;
    if (u.pathname === location.pathname && u.search === location.search) return null; /* âncora na mesma página */
    return u;
  }
  function trocaHead(doc) {
    document.title = doc.title;
    ["link[rel=canonical]", "meta[name=description]", "meta[name=robots]"].forEach(function (sel) {
      var velho = document.head.querySelector(sel), novo = doc.head.querySelector(sel);
      if (velho && novo) velho.replaceWith(novo.cloneNode(true));
      else if (velho) velho.remove();
      else if (novo) document.head.appendChild(novo.cloneNode(true));
    });
  }
  function rodaScripts(raiz) {
    raiz.querySelectorAll("script").forEach(function (velho) {
      var s = document.createElement("script");
      for (var i = 0; i < velho.attributes.length; i++) s.setAttribute(velho.attributes[i].name, velho.attributes[i].value);
      if (!velho.src) s.text = velho.textContent;
      velho.replaceWith(s);
    });
  }
  function navegar(u, empurra) {
    var ctl = window.AbortController ? new AbortController() : null;
    var prazo = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    document.documentElement.classList.add("rb-navegando");
    return fetch(u.href, { credentials: "same-origin", signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        var tipo = r.headers.get("content-type") || "";
        if (!r.ok || tipo.indexOf("text/html") < 0) throw new Error("http " + r.status);
        return r.text();
      })
      .then(function (html) {
        clearTimeout(prazo);
        var doc = new DOMParser().parseFromString(html, "text/html");
        var novo = doc.getElementById("pagina"), atual = document.getElementById("pagina");
        if (!novo || !atual) throw new Error("sem #pagina");
        if (!nossoHistorico) { history.replaceState({ cnb: 1 }, "", location.href); nossoHistorico = true; }
        trocaHead(doc);
        document.body.className = doc.body.className;
        if (!barra.hidden) document.body.classList.add("tem-radio");
        atual.innerHTML = novo.innerHTML;
        if (empurra) history.pushState({ cnb: 1 }, "", u.href);
        var alvo = u.hash && document.getElementById(decodeURIComponent(u.hash.slice(1)));
        if (alvo) alvo.scrollIntoView(); else window.scrollTo(0, 0);
        rodaScripts(atual);
        ligaCabecalho();
        try { gtag("event", "page_view", { page_location: location.href, page_title: document.title }); } catch (e) {}
      })
      .catch(function () { location.href = u.href; }) /* qualquer falha: navegação normal */
      .then(function () { clearTimeout(prazo); document.documentElement.classList.remove("rb-navegando"); });
  }
  document.addEventListener("click", function (ev) {
    if (!tocando()) return;
    var a = ev.target.closest ? ev.target.closest("a[href]") : null;
    var u = destinoInterno(a, ev);
    if (!u) return;
    ev.preventDefault();
    navegar(u, true);
  });
  window.addEventListener("popstate", function (ev) {
    if (!ev.state || !ev.state.cnb) return;
    if (tocando()) navegar(new URL(location.href), false);
    else location.reload();
  });

  /* ---------- início ---------- */
  window.cnbRadio = { tocando: tocando, audio: function () { return audio; } };
  ligaCabecalho();
  if (location.hash === "#radio") {
    history.replaceState(history.state, "", location.pathname + location.search);
    abreBarra();
    tocar();
  }
})();
