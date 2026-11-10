// Page world de www.37-express.com/qyfr/express/parcel/address/ (injecté par
// x37-content.js). Étape « Adresses » de la création d'un envoi de colis.
// Reçoit le destinataire de la commande et :
//   - le cherche dans le carnet d'adresses 37 Express (liste du champ
//     « Destinataire », #shipping_address_id.dataOptions = [{value, label,
//     data-country}], label = « Société Prénom Nom Rue CP, Ville Pays ») avec
//     la même société (ou nom), rue, code postal, ville et pays ;
//   - trouvé  → le sélectionne (même chemin que la liste déroulante :
//               événement shipping_address_id_change → Parcel.saveQuoteAddress) ;
//   - absent  → le crée via le formulaire « + Ajouter » de la page
//               (composant Alpine #customer-address-modal, saveAddress →
//               POST /express/parcel/saveCustomerAddress/), qui le sélectionne ;
//   - informations obligatoires manquantes (téléphone, rue…) ou création
//     refusée → le formulaire reste ouvert pré-rempli ; dès que Boris l'a
//     enregistré, on continue.
// Une fois le destinataire choisi, on passe à l'étape « Colis » (bouton
// « Suivant ») : Boris saisit le poids, puis « Suivant » affiche les
// transporteurs.
//
// Étape « Assurance » (/express/parcel/insurance/shipping/<id>/, atteinte en
// cochant « Assurance » sur un transporteur) : la valeur de la commande (total
// HT du regroupement) est saisie dans « Valeur à assurer HT » (répartie au
// poids s'il y a plusieurs colis), « Assuré » coché, puis « Confirmation »
// calcule les frais d'assurance. Boris vérifie et clique « Suivant ».
(function () {
  "use strict";
  if (window.__x37RegroupLoaded) return;
  window.__x37RegroupLoaded = true;

  const ORIGIN = location.origin;
  let started = false;

  window.addEventListener("message", function (ev) {
    if (ev.source !== window || !ev.data || ev.data.source !== "x37-regroup-ext") return;
    if (ev.data.type !== "X37_PREFILL" || started) return;
    started = true;
    const data = ev.data.data || {};
    const job = document.getElementById("parcel-insurance-form") ? runInsurance(data)
      : document.getElementById("package-weight") ? runPackage(data)
      : run(data);
    job.catch(function (err) {
      banner("err", "37 Express : " + ((err && err.message) || String(err)));
    });
  });
  window.postMessage({ source: "x37-regroup", type: "X37_READY" }, ORIGIN);

  // ─── Accès aux globales de la page ───
  function getParcel() { try { return typeof Parcel !== "undefined" ? Parcel : null; } catch (e) { return null; } }
  function getJsExt() { try { return typeof JSExt !== "undefined" ? JSExt : null; } catch (e) { return null; } }
  function getJq() { try { return typeof jQuery !== "undefined" ? jQuery : null; } catch (e) { return null; } }
  function getForm() {
    const el = document.getElementById("customer-address-modal");
    return el && el._x_dataStack && el._x_dataStack[0] ? el._x_dataStack[0] : null;
  }
  function recipientInput() { return document.getElementById("shipping_address_id"); }
  function selectedId() {
    const inp = recipientInput();
    const v = inp ? inp.getAttribute("value-data") : "";
    return v && v !== "0" ? v : "";
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
  // Attention : la page charge Prototype.js (Array.prototype.find remplacé,
  // etc.) → boucles simples sur les NodeList.
  function norm(s) {
    return String(s == null ? "" : s)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function contains(hay, needle) {
    const n = norm(needle);
    if (!n) return true;
    return (" " + hay + " ").indexOf(" " + n + " ") !== -1;
  }
  // 37 Express refuse " # $ % ^ * ! ！ ￥ ， 。 “ ” ‘ ’ dans les champs.
  function clean(s) {
    return String(s == null ? "" : s).replace(/["#$%\^*!！￥，。“”‘’]/g, " ").replace(/\s+/g, " ").trim();
  }

  // ─── Pays : nom (FR/EN) ou code ISO → code 37 Express ───
  const COUNTRY_ALIASES = {
    "france metropolitaine": "FR", "belgium": "BE", "germany": "DE", "deutschland": "DE",
    "spain": "ES", "espana": "ES", "italy": "IT", "italia": "IT", "netherlands": "NL",
    "the netherlands": "NL", "holland": "NL", "nederland": "NL", "switzerland": "CH",
    "schweiz": "CH", "portugal": "PT", "austria": "AT", "osterreich": "AT",
    "united kingdom": "GB", "uk": "GB", "great britain": "GB", "royaume uni": "GB",
    "england": "EN", "scotland": "SF", "wales": "WL", "northern ireland": "NB",
    "ireland": "IE", "united states": "US", "united states of america": "US", "usa": "US",
    "etats unis": "US", "sweden": "SE", "denmark": "DK", "poland": "PL", "greece": "GR",
    "czech republic": "CZ", "czechia": "CZ", "tchequie": "CZ", "finland": "FI",
    "norway": "NO", "croatia": "HR", "hungary": "HU", "romania": "RO", "bulgaria": "BG",
    "slovakia": "SK", "slovenia": "SI", "lithuania": "LT", "latvia": "LV",
    "estonia": "EE", "cyprus": "CY", "malta": "MT", "iceland": "IS", "reunion": "RE",
    "la reunion": "RE", "hong kong": "HK", "macao": "MO", "macau": "MO",
    "south korea": "KR", "korea": "KR", "japan": "JP", "china": "CN", "morocco": "MA",
    "tunisia": "TN", "algeria": "DZ", "ivory coast": "CI", "cote d ivoire": "CI",
    "senegal": "SN", "united arab emirates": "AE", "uae": "AE", "turkey": "TR", "turkiye": "TR"
  };
  function countryList() {
    const P = getParcel();
    const list = P && P.receiverCountries;
    return list && list.length ? list : [];
  }
  function toCode(country) {
    const raw = String(country || "").trim();
    if (!raw) return "FR";
    const list = countryList();
    const codes = {};
    const labels = {};
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || !c.value) continue;
      codes[String(c.value).toUpperCase()] = c.value;
      labels[norm(c.label)] = c.value;
    }
    const known = list.length > 0;
    if (/^[A-Za-z]{2}$/.test(raw)) {
      const up = raw.toUpperCase() === "UK" ? "GB" : raw.toUpperCase();
      if (!known || codes[up]) return codes[up] || up;
    }
    const n = norm(raw);
    if (labels[n]) return labels[n];
    const alias = COUNTRY_ALIASES[n] || (n === "france" ? "FR" : null);
    if (alias && (!known || codes[alias])) return alias;
    for (const label in labels) {
      if (label.length >= 4 && (" " + n + " ").indexOf(" " + label + " ") !== -1) return labels[label];
    }
    return null;
  }
  function countryLabel(code) {
    const list = countryList();
    for (let i = 0; i < list.length; i++) if (list[i].value === code) return list[i].label;
    return code;
  }

  // ─── Bandeau d'information (DOM pur, pas d'innerHTML) ───
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

  // ─── Commande → champs du formulaire d'adresse 37 Express ───
  function buildFields(r) {
    let first = clean(r.firstName);
    let last = clean(r.lastName);
    let company = clean(r.company);
    // 37 Express exige prénom ET nom ensemble (ou aucun des deux) : un nom
    // seul passe en société si la commande n'en a pas.
    if (!(first && last)) {
      if (!company) company = first || last;
      first = "";
      last = "";
    }
    return {
      address_type: "shipping",
      company: company,
      firstname: first,
      lastname: last,
      street: ["", clean(r.street), clean(r.complement)],
      postcode: String(r.postalCode || "").trim(),
      city: clean(r.city),
      country_id: toCode(r.countryCode || r.country),
      telephone: String(r.phone || "").replace(/[^\d+ ()-]/g, "").trim(),
      email: String(r.email || "").trim(),
      vat_id: String(r.vat || "").replace(/\s+/g, "").toUpperCase(),
      delivery_instructions: ""
    };
  }

  function findInBook(f, r) {
    const inp = recipientInput();
    const options = (inp && inp.dataOptions) || [];
    const who = f.company || [r.firstName, r.lastName].filter(Boolean).join(" ");
    if (!norm(who)) return null;
    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      if (!o || !o.value) continue;
      if (f.country_id && o["data-country"] && String(o["data-country"]).toUpperCase() !== f.country_id.toUpperCase()) continue;
      const label = norm(o.label);
      if (!contains(label, who)) continue;
      if (!contains(label, f.street[1])) continue;
      if (!contains(label, f.postcode)) continue;
      if (!contains(label, f.city)) continue;
      return o;
    }
    return null;
  }

  // Même chemin qu'un clic dans la liste « Choisir une adresse de destination ».
  function selectOption(o) {
    const inp = recipientInput();
    const J = getJsExt();
    const $ = getJq();
    inp.value = o.label;
    inp.setAttribute("value-data", o.value);
    if ($) $(inp).closest(".el-box").addClass("canuse");
    if (J && J.Event && J.Event.Customize) {
      J.Event.Customize.triggerEvent("shipping_address_id_change", inp);
    } else {
      getParcel().saveQuoteAddress(o.value, "shipping");
    }
  }

  function missingFields(f) {
    const miss = [];
    if (!f.company && !(f.firstname && f.lastname)) miss.push("société ou nom");
    if (!f.street[1]) miss.push("adresse");
    if (!f.postcode) miss.push("code postal");
    if (!f.city) miss.push("ville");
    if (!f.telephone) miss.push("téléphone");
    const form = getForm();
    const emailCountries = (form && form.requiredEmailCountries) || ["GB", "EN", "NB", "SF", "WL"];
    if (!f.email && emailCountries.indexOf(f.country_id) !== -1) miss.push("email");
    return miss;
  }

  function openPrefilledForm(f) {
    getParcel().showEditAddressForm({
      address_type: "shipping",
      company: f.company,
      firstname: f.firstname,
      lastname: f.lastname,
      street: f.street.slice(),
      postcode: f.postcode,
      city: f.city,
      country_id: f.country_id,
      telephone: f.telephone,
      email: f.email,
      vat_id: f.vat_id,
      delivery_instructions: ""
    });
  }

  function goToPackageStep() {
    window.postMessage({ source: "x37-regroup", type: "X37_ADDRESS_DONE" }, ORIGIN);
    const btns = document.querySelectorAll("button.el-button.next");
    for (let i = 0; i < btns.length; i++) {
      if (/submitAddress/.test(btns[i].getAttribute("onclick") || "")) { btns[i].click(); return; }
    }
    getParcel().submitAddress("../package/");
  }

  async function finish(label, how) {
    // saveQuoteAddress / saveCustomerAddress remplissent le bloc du destinataire.
    await waitFor(function () {
      const h = document.getElementById("shipping_address_html");
      return h && h.textContent.trim() && selectedId();
    }, 15000);
    banner("ok", "Destinataire " + how + " : " + label, "Passage à l'étape « Colis »" +
      (window.__x37HasParcel ? " : dimensions / poids de la commande saisis ensuite." : " : saisissez le poids puis « Suivant » pour voir les transporteurs."));
    await sleep(1200);
    goToPackageStep();
  }

  // ─── Étape « Colis » (/express/parcel/package/, 3.36.0) ───
  // Formulaire « Ajouter colis » en haut de la page : champs name=length /
  // width / height (cm) et #package-weight (kg). On reproduit ce que fait la
  // page quand on choisit une dimension favorite (logistic_parcel_package_
  // favorites.set) : value + JSExt.Event.fire(input, "blur"). Seules les
  // valeurs saisies dans le modal sont écrites ; « Ajouter » reste à Boris.
  async function runPackage(data) {
    const dims = data.parcel || {};
    const form = await waitFor(function () { return document.querySelector(".parcel-package-add-form"); }, 15000);
    if (!form) return;
    const J = getJsExt();
    const order = [
      { key: "length", label: "longueur", el: form.querySelector('input[name="length"]') },
      { key: "width", label: "largeur", el: form.querySelector('input[name="width"]') },
      { key: "height", label: "hauteur", el: form.querySelector('input[name="height"]') },
      { key: "weight", label: "poids", el: document.getElementById("package-weight") }
    ];
    const done = [];
    const missing = [];
    for (let i = 0; i < order.length; i++) {
      const f = order[i];
      if (!f.el) continue;
      const v = dims[f.key];
      if (v == null || !(v > 0)) { if (!String(f.el.value || "").trim()) missing.push(f); continue; }
      f.el.value = String(v);
      try {
        if (J && J.Event && J.Event.fire) J.Event.fire(f.el, "blur");
        else f.el.dispatchEvent(new Event("blur"));
      } catch (e) { /* ignore */ }
      try { f.el.dispatchEvent(new Event("input", { bubbles: true })); f.el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) { /* ignore */ }
      const box = f.el.closest(".el-box");
      if (box) box.classList.add("focus");
      done.push(f.label + " " + String(v).replace(".", ",") + (f.key === "weight" ? " kg" : " cm"));
    }
    window.postMessage({ source: "x37-regroup", type: "X37_PACKAGE_DONE" }, ORIGIN);
    if (!done.length) return;
    let target = missing.length ? missing[0].el : null;
    if (!target) {
      const btns = form.parentElement ? form.parentElement.querySelectorAll("button.add-package") : [];
      target = btns.length ? btns[0] : null;
    }
    if (target) {
      try { target.scrollIntoView({ block: "center" }); target.focus(); } catch (e) { /* ignore */ }
    }
    banner("ok", "Colis : " + done.join(", ") + ".",
      (missing.length ? "À compléter : " + missing.map(function (f) { return f.label; }).join(", ") + ". " : "") +
      "Cliquez « Ajouter » puis « Suivant » pour voir les transporteurs.");
  }

  async function run(data) {
    window.__x37HasParcel = !!(data && data.parcel);
    const r = data.receiver || {};
    const title = [r.company, [r.postalCode, r.city].filter(Boolean).join(" ")].filter(Boolean).join(" — ");
    banner("info", "37 Express : recherche du client dans le carnet d'adresses…", title);

    const P = await waitFor(getParcel, 20000);
    const inp = await waitFor(recipientInput, 20000);
    if (!P || !inp) {
      banner("warn", "Page « Adresses » de 37 Express introuvable.",
        "Ouvrez Envois → Envoi de colis (www.37-express.com/qyfr/express/parcel/address/).");
      return;
    }

    // Le carnet se charge en Ajax (premier lot puis le reste) : on attend
    // qu'il soit complet et stable.
    let last = -1;
    let stable = 0;
    await waitFor(function () {
      const n = inp.dataOptions ? inp.dataOptions.length : -1;
      const ul = inp.dataList || inp.parentNode.querySelector("ul.list");
      const loading = ul && ul.querySelector("li.loading");
      if (n >= 0 && n === last && !loading) stable++; else stable = 0;
      last = n;
      return stable >= 4;
    }, 20000, 300);

    const f = buildFields(r);
    if (!f.country_id) {
      banner("warn", "Pays « " + (r.country || "?") + " » non reconnu par 37 Express.",
        "Le formulaire « Ajouter » s'ouvre pré-rempli : choisissez le pays puis enregistrez.");
      f.country_id = "FR";
      openPrefilledForm(f);
      return watchManualSave();
    }

    const found = findInBook(f, r);
    if (found) {
      selectOption(found);
      return finish(found.label, "sélectionné");
    }

    const miss = missingFields(f);
    openPrefilledForm(f);
    if (miss.length) {
      banner("warn", "Client absent du carnet — informations manquantes : " + miss.join(", ") + ".",
        "Complétez le formulaire puis « Enregistrer » ; la suite se fera automatiquement.");
      return watchManualSave();
    }

    banner("info", "Client absent du carnet : création dans 37 Express…", title);
    const form = await waitFor(function () { const d = getForm(); return d && d.modal ? d : null; }, 5000);
    if (!form) {
      banner("warn", "Formulaire d'adresse 37 Express introuvable.", "Ajoutez le destinataire à la main.");
      return watchManualSave();
    }
    await sleep(300);
    form.saveAddress();
    const ok = await waitFor(function () { return selectedId() && !form.saving ? selectedId() : null; }, 20000);
    if (ok) {
      return finish((recipientInput().value || title), "créé et sélectionné");
    }
    const errs = Object.keys(form.errors || {});
    banner("warn", "37 Express n'a pas accepté la création automatique" + (errs.length ? " (champs : " + errs.join(", ") + ")" : "") + ".",
      "Corrigez le formulaire pré-rempli puis « Enregistrer » ; la suite se fera automatiquement.");
    return watchManualSave();
  }

  // Formulaire ouvert pour Boris : dès qu'un destinataire est enregistré et
  // sélectionné (15 min max), on passe à l'étape « Colis ».
  async function watchManualSave() {
    const before = selectedId();
    const id = await waitFor(function () {
      const v = selectedId();
      return v && v !== before ? v : null;
    }, 15 * 60 * 1000, 500);
    if (id) return finish(recipientInput().value || "", "enregistré");
  }
  // ─── Étape « Assurance » ───
  function fmtEur(n) {
    return n.toFixed(2).replace(".", ",") + " €";
  }
  function parseWeight(text) {
    const m = String(text || "").replace(",", ".").match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }
  // Le « Suivant » que 37 Express réactive après le calcul est le premier de
  // .bottom-btn (cf. Parcel.submitSaveInsuranceForm).
  function nextButton() {
    const main = document.querySelector(".bottom-btn .el-button.next");
    if (main) return main;
    const btns = document.querySelectorAll("button.el-button.next");
    for (let i = 0; i < btns.length; i++) {
      if (/additional/.test(btns[i].getAttribute("onclick") || "")) return btns[i];
    }
    return null;
  }

  async function runInsurance(data) {
    const value = Number(data.parcelValue);
    if (!(value > 0)) {
      banner("warn", "Assurance : montant de la commande inconnu.", "Saisissez la valeur à assurer à la main.");
      return;
    }
    const container = await waitFor(function () {
      const c = document.getElementById("parcel-insurance-items-html");
      return c && c.querySelector('input[name$="[amount]"]') ? c : null;
    }, 15000);
    if (!container) {
      banner("warn", "Tableau d'assurance 37 Express introuvable.", "Saisissez la valeur à assurer à la main (" + fmtEur(value) + " HT).");
      return;
    }

    const rows = [];
    const trs = container.querySelectorAll("tbody tr");
    for (let i = 0; i < trs.length; i++) {
      const input = trs[i].querySelector('input[name$="[amount]"]');
      if (!input) continue;
      const wCell = trs[i].querySelector('td[data-th="Poids"]');
      rows.push({ input: input, weight: parseWeight(wCell ? wCell.textContent : "") });
    }
    if (!rows.length) return;

    // Valeurs déjà saisies (retour sur la page) : on ne les écrase pas.
    for (let i = 0; i < rows.length; i++) {
      if (parseFloat(String(rows[i].input.value || "0").replace(",", ".")) > 0) {
        banner("info", "Assurance déjà renseignée sur cette page : rien n'a été modifié.", "Valeur de la commande : " + fmtEur(value) + " HT.");
        window.postMessage({ source: "x37-regroup", type: "X37_DONE" }, ORIGIN);
        return;
      }
    }

    // Répartition au poids (parts égales si les poids manquent), en centimes,
    // le reste sur le dernier colis.
    const cents = Math.round(value * 100);
    let totalW = 0;
    for (let i = 0; i < rows.length; i++) totalW += rows[i].weight;
    let given = 0;
    for (let i = 0; i < rows.length; i++) {
      let c;
      if (i === rows.length - 1) c = cents - given;
      else c = Math.floor(cents * (totalW > 0 ? rows[i].weight / totalW : 1 / rows.length));
      given += c;
      rows[i].amount = c / 100;
    }

    for (let i = 0; i < rows.length; i++) {
      const inp = rows[i].input;
      inp.value = rows[i].amount.toFixed(2);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      try {
        if (typeof changeInsuranceAmount === "function") changeInsuranceAmount(inp);
      } catch (e) { /* ignore */ }
      const yes = inp.closest("tr") && inp.closest("tr").querySelector('input[type="radio"][value="yes"]');
      if (yes && !yes.checked) yes.click();
    }

    // « Confirmation » : 37 Express calcule les frais (POST saveInsurance) et
    // réactive « Suivant ».
    const confirmBtn = document.getElementById("parcel-insurance-button");
    if (!confirmBtn) {
      banner("warn", "Valeur à assurer saisie (" + fmtEur(value) + " HT).", "Cliquez sur « Confirmation » pour calculer l'assurance.");
      return;
    }
    banner("info", "Assurance : calcul pour " + fmtEur(value) + " HT…");
    confirmBtn.click();
    const next = nextButton();
    const ok = await waitFor(function () { return next && !next.disabled; }, 15000);
    const totalEl = document.getElementById("parcel-insurance-total-html");
    const totalText = totalEl ? totalEl.textContent.replace(/\s+/g, " ").trim() : "";
    const split = rows.length > 1 ? " (répartie au poids sur " + rows.length + " colis)" : "";
    const over = [];
    for (let i = 0; i < rows.length; i++) if (rows[i].amount > 2000) over.push(i + 1);
    if (ok) {
      banner(over.length ? "warn" : "ok",
        "Assurance renseignée : " + fmtEur(value) + " HT" + split + ".",
        (totalText ? totalText + ". " : "") +
        (over.length ? "Attention : 37 Express ne couvre que 2 000 € par colis (colis " + over.join(", ") + "). " : "") +
        "Vérifiez puis cliquez « Suivant ».");
      window.postMessage({ source: "x37-regroup", type: "X37_DONE" }, ORIGIN);
    } else {
      banner("warn", "Valeur à assurer saisie (" + fmtEur(value) + " HT)" + split + ", mais 37 Express n'a pas confirmé le calcul.",
        "Vérifiez le message de la page puis cliquez « Confirmation ».");
    }
  }
})();
