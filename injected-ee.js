// Page world d'easy-express.fr/shipping (injecté par ee-content.js).
// Reçoit le destinataire de la commande, le cherche dans le carnet d'adresses
// Easy Express (appObj.cneeAddrs, chargé par la page) avec la même société,
// adresse, code postal, ville, pays, téléphone et email, puis :
//   - trouvé  → le sélectionne comme destinataire ;
//   - absent  → le crée via le formulaire « Ajouter une adresse » de la page
//               (appObj.newadr → POST /shipping/v2/addBook) et le sélectionne.
// Un champ vide côté commande n'entre pas dans la comparaison.
// Si des informations obligatoires manquent (email, téléphone…) ou si Easy
// Express refuse la création, le formulaire s'ouvre pré-rempli pour finir à
// la main ; le client enregistré est ensuite sélectionné automatiquement.
(function () {
  "use strict";
  if (window.__eeRegroupLoaded) return;
  window.__eeRegroupLoaded = true;

  const ORIGIN = location.origin;
  let started = false;

  window.addEventListener("message", function (ev) {
    if (ev.source !== window || !ev.data || ev.data.source !== "ee-regroup-ext") return;
    if (ev.data.type !== "EE_PREFILL" || started) return;
    started = true;
    run(ev.data.data || {}).catch(function (err) {
      banner("err", "Easy Express : " + ((err && err.message) || String(err)));
    });
  });
  window.postMessage({ source: "ee-regroup", type: "EE_READY" }, ORIGIN);

  // ─── Accès aux globales de la page (déclarées par ses scripts inline) ───
  function getApp() { try { return typeof appObj !== "undefined" ? appObj : null; } catch (e) { return null; } }
  function getJq() { try { return typeof jQuery !== "undefined" ? jQuery : null; } catch (e) { return null; } }
  function newBook() {
    try { if (typeof GetBook === "function") return GetBook(); } catch (e) { /* ignore */ }
    return { role: 0, residence: 0, country: "FR" };
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function waitFor(fn, timeoutMs, stepMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      await sleep(stepMs || 250);
    }
    return null;
  }

  // ─── Normalisation ───
  function norm(s) {
    return String(s == null ? "" : s)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function normPostcode(s) { return String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase(); }
  function normEmail(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  function normPhone(s) {
    let d = String(s == null ? "" : s).replace(/\D/g, "");
    if (d.indexOf("00") === 0) d = d.slice(2);
    return d;
  }
  function samePhone(a, b) {
    const x = normPhone(a), y = normPhone(b);
    if (!x || !y) return x === y;
    if (x.length >= 9 && y.length >= 9) return x.slice(-9) === y.slice(-9);
    return x === y;
  }

  // ─── Pays : nom (FR/EN) ou code ISO → code utilisé par Easy Express ───
  const COUNTRY_ALIASES = {
    "france": "FR", "france metropolitaine": "FR", "belgium": "BE", "germany": "DE",
    "spain": "ES", "italy": "IT", "netherlands": "NL", "the netherlands": "NL",
    "holland": "NL", "switzerland": "CH", "luxembourg": "LU", "portugal": "PT",
    "austria": "AT", "united kingdom": "GB", "uk": "GB", "great britain": "GB",
    "england": "GB", "royaume uni": "GB", "ireland": "IE", "united states": "US",
    "united states of america": "US", "usa": "US", "etats unis": "US", "canada": "CA",
    "sweden": "SE", "denmark": "DK", "poland": "PL", "greece": "GR",
    "czech republic": "CZ", "czechia": "CZ", "finland": "FI", "norway": "NO",
    "monaco": "MC", "croatia": "HR", "hungary": "HU", "romania": "RO", "bulgaria": "BG",
    "slovakia": "SK", "slovenia": "SI", "lithuania": "LT", "latvia": "LV",
    "estonia": "EE", "cyprus": "CY", "malta": "MT"
  };
  function countrySelect() {
    const sels = document.querySelectorAll("#ae96532 select, select");
    for (const s of sels) {
      if (s.options.length > 100 && [].some.call(s.options, function (o) { return o.value === "FR"; })) return s;
    }
    return null;
  }
  function toIso(country) {
    const raw = String(country || "").trim();
    if (!raw) return "FR";
    const sel = countrySelect();
    const codes = {};
    const labels = {};
    if (sel) {
      for (const o of sel.options) {
        if (!o.value) continue;
        codes[o.value.toUpperCase()] = o.value;
        labels[norm(o.textContent)] = o.value;
      }
    }
    if (/^[A-Za-z]{2}$/.test(raw)) {
      const up = raw.toUpperCase();
      if (!sel || codes[up]) return up === "UK" ? "GB" : up;
    }
    const n = norm(raw);
    if (labels[n]) return labels[n];
    if (COUNTRY_ALIASES[n]) return COUNTRY_ALIASES[n];
    return /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : "FR";
  }

  // ─── Bandeau d'information ───
  let bannerNode = null;
  function banner(kind, text, sub) {
    if (!bannerNode) {
      bannerNode = document.createElement("div");
      bannerNode.setAttribute("style", [
        "position:fixed", "left:16px", "bottom:16px", "z-index:2147483647",
        "max-width:440px", "padding:12px 36px 12px 14px", "border-radius:10px",
        "font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
        "box-shadow:0 6px 24px rgba(0,0,0,.25)", "color:#fff"
      ].join(";"));
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.setAttribute("style", "position:absolute;top:6px;right:8px;background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1");
      close.addEventListener("click", function () { bannerNode.style.display = "none"; });
      bannerNode.appendChild(close);
      bannerNode.appendChild(document.createElement("div"));
      bannerNode.appendChild(document.createElement("div"));
      document.body.appendChild(bannerNode);
    }
    const colors = { info: "#1f2937", ok: "#15803d", warn: "#b45309", err: "#b91c1c" };
    bannerNode.style.background = colors[kind] || colors.info;
    bannerNode.style.display = "";
    bannerNode.children[1].textContent = text || "";
    bannerNode.children[1].style.fontWeight = "600";
    bannerNode.children[2].textContent = sub || "";
    bannerNode.children[2].style.marginTop = sub ? "4px" : "0";
    bannerNode.children[2].style.opacity = ".9";
  }

  // ─── Données de la commande → fiche carnet Easy Express ───
  function buildFields(r) {
    const contact = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
    return {
      role: 0,          // 0 = Destinataire
      residence: 0,     // 0 = Professionnel
      prefers: "recipient",
      company: String(r.company || contact || "").trim(),
      firstname: String(r.firstName || "").trim(),
      lastname: String(r.lastName || "").trim(),
      street: String(r.street || "").trim(),
      building: String(r.complement || "").trim(),
      postcode: String(r.postalCode || "").trim(),
      city: String(r.city || "").trim(),
      country: toIso(r.country),
      mobile: String(r.phone || "").trim(),
      email: String(r.email || "").trim(),
      siret: String(r.siret || "").replace(/\s+/g, ""),
      vat_number: String(r.vat || "").replace(/\s+/g, "").toUpperCase()
    };
  }

  function isMatch(a, f) {
    if (!a) return false;
    if (norm(a.company) !== norm(f.company)) return false;
    if (f.street && norm(a.street) !== norm(f.street)) return false;
    if (f.postcode && normPostcode(a.postcode) !== normPostcode(f.postcode)) return false;
    if (f.city && norm(a.city) !== norm(f.city)) return false;
    if (f.country && String(a.country || "").toUpperCase() !== f.country.toUpperCase()) return false;
    if (f.mobile && !samePhone(a.mobile, f.mobile)) return false;
    if (f.email && normEmail(a.email) !== normEmail(f.email)) return false;
    return true;
  }

  function missingFields(f) {
    const m = [];
    if (!f.company) m.push("société");
    if (!f.street) m.push("adresse");
    if (!f.postcode) m.push("code postal");
    if (!f.city) m.push("ville");
    if (!f.mobile) m.push("téléphone");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) m.push("email");
    return m;
  }

  // ─── Actions sur la page ───
  async function selectRecipient(ukey) {
    const app = getApp(), $ = getJq();
    const sel = app && app.$refs && app.$refs.cneeOpts;
    if (!sel || !$) return false;
    const opt = await waitFor(function () {
      return [].find.call(sel.options, function (o) { return o.value === ukey; });
    }, 10000);
    if (!opt) return false;
    $(sel).val(ukey).trigger("change");
    const ok = await waitFor(function () { return app.cneeKey === ukey; }, 5000);
    return !!ok;
  }

  function prepareParcel(prefill) {
    const app = getApp();
    try {
      if (app && app.parcel && prefill.parcelValue && !app.parcel.objValue) {
        app.parcel.objValue = prefill.parcelValue;
      }
    } catch (e) { /* ignore */ }
    const label = [].find.call(document.querySelectorAll("label"), function (l) { return /Poids\s*\(kg\)/i.test(l.textContent); });
    const box = label && label.closest("div");
    const input = box && box.querySelector("input");
    if (input) {
      input.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(function () { try { input.focus(); } catch (e) { /* ignore */ } }, 400);
    }
  }

  async function openPrefilledForm(fields) {
    const app = getApp();
    const btn = [].find.call(document.querySelectorAll("span[role=button], button, a"), function (e) {
      return /Ajouter une adresse/i.test(e.textContent || "");
    });
    if (btn) { btn.click(); await sleep(600); }
    if (app) {
      if (!app.model) app.model = newBook();
      Object.keys(fields).forEach(function (k) { app.model[k] = fields[k]; });
    }
    const $ = getJq();
    if (!btn && $) { try { $("#ae96532").modal("show"); } catch (e) { /* ignore */ } }
  }

  // Après une saisie manuelle dans le formulaire, sélectionne le client enregistré.
  async function watchForNewEntry(known, fields, prefill) {
    const app = getApp();
    const found = await waitFor(function () {
      const list = (app && app.cneeAddrs) || [];
      const fresh = list.filter(function (a) { return a && a.ukey && !known.has(a.ukey); });
      if (!fresh.length) return null;
      return fresh.find(function (a) { return norm(a.company) === norm(fields.company); }) || fresh[0];
    }, 15 * 60 * 1000, 500);
    if (!found) return;
    const ok = await selectRecipient(found.ukey);
    if (ok) finish("ok", "Nouveau client enregistré et sélectionné : " + found.company, prefill);
  }

  function finish(kind, text, prefill) {
    banner(kind, text, "Saisissez le poids du colis puis cliquez sur « Ajouter le colis » pour afficher la liste des transporteurs.");
    prepareParcel(prefill);
    window.postMessage({ source: "ee-regroup", type: "EE_DONE" }, ORIGIN);
  }

  // ─── Déroulé principal ───
  async function run(prefill) {
    const r = prefill.receiver || {};
    banner("info", "Recherche du client dans le carnet d'adresses Easy Express…", prefill.orderNo ? "Commande " + prefill.orderNo : "");

    const app = await waitFor(function () {
      const a = getApp();
      return a && Array.isArray(a.cneeAddrs) && a.$refs && a.$refs.cneeOpts && getJq() ? a : null;
    }, 20000);
    if (!app) {
      banner("err", "Page Easy Express pas prête.", "Vérifiez que vous êtes connecté à Easy Express, puis rechargez cette page (F5).");
      return;
    }
    // Le carnet est chargé de façon asynchrone par la page (ls()).
    await waitFor(function () { return app.cneeAddrs.length > 0; }, 8000);

    const fields = buildFields(r);
    if (!fields.company) {
      banner("err", "Nom de société absent de la commande.", "Choisissez ou créez le destinataire à la main.");
      return;
    }

    const existing = app.cneeAddrs.find(function (a) { return isMatch(a, fields); });
    if (existing) {
      const ok = await selectRecipient(existing.ukey);
      if (ok) finish("ok", "Client existant sélectionné : " + existing.company, prefill);
      else banner("warn", "Client trouvé (" + existing.company + ") mais la sélection a échoué.", "Choisissez-le dans la liste « Destinataire ».");
      return;
    }

    const known = new Set(app.cneeAddrs.map(function (a) { return a.ukey; }));
    const missing = missingFields(fields);
    if (missing.length) {
      await openPrefilledForm(fields);
      banner("warn", "Nouveau client — informations manquantes : " + missing.join(", ") + ".",
        "Complétez le formulaire puis cliquez sur « Enregistrer » : le client sera sélectionné automatiquement.");
      watchForNewEntry(known, fields, prefill);
      return;
    }

    banner("info", "Client introuvable — création dans le carnet d'adresses…", fields.company);
    app.model = Object.assign(newBook(), fields);
    try { app.newadr(); } catch (e) { /* le message d'erreur éventuel s'affiche via la page */ }

    const created = await waitFor(function () {
      const fresh = app.cneeAddrs.filter(function (a) { return a && a.ukey && !known.has(a.ukey); });
      if (!fresh.length) return null;
      return fresh.find(function (a) { return isMatch(a, fields); })
        || fresh.find(function (a) { return norm(a.company) === norm(fields.company); })
        || fresh[0];
    }, 20000, 400);

    if (created) {
      const ok = await selectRecipient(created.ukey);
      if (ok) finish("ok", "Nouveau client créé et sélectionné : " + created.company, prefill);
      else banner("warn", "Client créé (" + created.company + ") mais la sélection a échoué.", "Choisissez-le dans la liste « Destinataire ».");
      return;
    }

    await openPrefilledForm(fields);
    banner("warn", "Easy Express n'a pas accepté la création automatique.",
      "Corrigez le formulaire (voir le message en haut à droite) puis cliquez sur « Enregistrer » : le client sera sélectionné automatiquement.");
    watchForNewEntry(known, fields, prefill);
  }
})();
