// Page world de www.smarty365.com/dashboard/* (injecté par smarty-content.js).
// Smarty365 est une application Vue 2 + Vuetify + Vuex (base /dashboard/) ;
// la création d'un envoi de colis est la route « parcel.create »
// (/dashboard/parcel/create), découpée en étapes (store parcel.step) :
// 1 Adresses · 2 Colis · 3 Transporteurs · 4 Douane · 5 Assurance · 6 Point
// relais · 7 Enlèvement · 8 Livraison · 9 Suppléments.
//
// Toujours (même sans commande) — étape 3, liste des transporteurs
// (composant « rate-table ») : la case « Assurance » (rate.insured) est cochée
// sur chaque transporteur assurable. La page décoche normalement les autres
// lignes dès qu'on touche à une ligne (amendCheckbox) : on garde les cases
// cochées, et le store (checkInsurance / insuranceConfig) suit toujours la
// ligne du transporteur choisi.
//
// Si l'onglet a été ouvert depuis le modal (Transporteurs ▾ → Smarty365) :
//   - étape 1 : cherche le destinataire dans le carnet « Adresse de
//     destination » (composant address-autocomplete type receiver ; recherche
//     serveur par code postal) avec le même pays, CP, ville, rue et société
//     (ou nom) ; trouvé → sélectionné ; absent → créé via le formulaire
//     « + Nouvelle adresse » (address-edit-dialog, save()) ; infos
//     obligatoires manquantes ou création refusée → formulaire laissé ouvert
//     pré-rempli, la suite reprend dès qu'un destinataire est enregistré.
//     Puis « Continuer » → étape « Colis » (Boris saisit le poids).
//   - étape 5 (Assurance, composant add-insurance) : valeur à assurer = total
//     HT du regroupement, répartie au poids s'il y a plusieurs colis ; les
//     frais sont calculés par la page (insuranceChange). Boris vérifie et
//     clique « Continuer ».
(function () {
  "use strict";
  if (window.__s365RegroupLoaded) return;
  window.__s365RegroupLoaded = true;

  const ORIGIN = location.origin;
  let data = null;               // { receiver, orderNo, parcelValue, addressDone }
  let addressState = "idle";     // idle | running | done
  let loginNotified = false;
  let started = false;
  const autoInsured = new WeakSet();   // tarifs déjà pré-cochés une fois
  const insuranceDone = new WeakSet(); // composants add-insurance déjà traités

  window.addEventListener("message", function (ev) {
    if (ev.source !== window || !ev.data || ev.data.source !== "s365-regroup-ext") return;
    if (ev.data.type !== "S365_PREFILL" || started) return;
    started = true;
    data = ev.data.data || null;
    if (!data || data.addressDone) addressState = "done";
    setInterval(tick, 500);
    tick();
  });
  window.postMessage({ source: "s365-regroup", type: "S365_READY" }, ORIGIN);

  // ─── Vue / Vuex ───
  function rootVm() {
    const el = document.querySelector("[data-app]") || document.querySelector(".v-application");
    return el && el.__vue__ ? el.__vue__.$root : null;
  }
  function findVms(name, from) {
    const out = [];
    (function walk(vm) {
      if (!vm) return;
      if (vm.$options && vm.$options.name === name) out.push(vm);
      const ch = vm.$children || [];
      for (let i = 0; i < ch.length; i++) walk(ch[i]);
    })(from || rootVm());
    return out;
  }
  function parcelState() {
    const root = rootVm();
    return root && root.$store && root.$store.state ? root.$store.state.parcel : null;
  }
  function onCreatePage() {
    const root = rootVm();
    return !!(root && root.$route && root.$route.name === "parcel.create");
  }
  function currentReceiverId() {
    const st = parcelState();
    const id = st && st.command ? st.command.receiverAddressId : null;
    return id && id !== -1 ? id : null;
  }
  function receiverPicker() {
    const list = findVms("address-autocomplete");
    for (let i = 0; i < list.length; i++) if (list[i].type === "receiver") return list[i];
    return null;
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

  // ─── Boucle principale (navigation interne de l'application) ───
  function tick() {
    try {
      const root = rootVm();
      if (!root) return;
      const path = (root.$route && root.$route.path) || location.pathname;
      if (data && addressState === "idle" && /auth\/login/.test(path) && !loginNotified) {
        loginNotified = true;
        banner("info", "Connectez-vous à Smarty365.", "Le destinataire de la commande sera sélectionné ensuite automatiquement.");
      }
      if (!onCreatePage()) return;
      const st = parcelState();
      if (!st) return;
      if (data && addressState === "idle" && st.step === 1) {
        addressState = "running";
        runAddress().catch(function (err) {
          banner("err", "Smarty365 : " + ((err && err.message) || String(err)));
        }).then(function () { addressState = "done"; });
      }
      if (st.step === 3) insuranceDefaults(st);
      if (st.step === 5 && data) fillInsurance();
    } catch (e) { /* page en cours de rendu : on réessaie au tour suivant */ }
  }

  // ─── Étape 3 : « Assurance » cochée par défaut ───
  function ratesOf(rt) {
    const l = rt.pricingRates || rt.rates;
    return Array.isArray(l) ? l : [];
  }
  function canInsure(rt, rate) {
    try { return typeof rt.canBeInsured === "function" ? rt.canBeInsured(rate) : !!(rate.rates && rate.rates[0] && rate.rates[0].insurancePrice); }
    catch (e) { return false; }
  }
  function isChosen(rt, rate) {
    try { return typeof rt.isChoosed === "function" && rt.isChoosed(rate); } catch (e) { return false; }
  }
  // La page décoche « Assurance » sur toutes les autres lignes dès qu'une
  // ligne change (amendCheckbox) : on remet les cases qui étaient cochées.
  function patchRateTable(rt) {
    if (rt.__s365Patched || typeof rt.amendCheckbox !== "function") return;
    rt.__s365Patched = true;
    const orig = rt.amendCheckbox;
    rt.amendCheckbox = function (t) {
      const list = ratesOf(rt);
      const keep = list.map(function (r) { return !!(r && r.insured); });
      orig.call(rt, t);
      for (let i = 0; i < list.length; i++) {
        if (keep[i] && !list[i].insured) rt.$set(list[i], "insured", true);
      }
    };
  }
  function insuranceDefaults(st) {
    const tables = findVms("rate-table");
    for (let k = 0; k < tables.length; k++) {
      const rt = tables[k];
      patchRateTable(rt);
      const list = ratesOf(rt);
      for (let i = 0; i < list.length; i++) {
        const rate = list[i];
        if (!rate || typeof rate !== "object" || autoInsured.has(rate)) continue;
        autoInsured.add(rate);
        if (rate.disabled || rate.insured || !canInsure(rt, rate)) continue;
        rt.$set(rate, "insured", true);
      }
      // Le store suit la ligne du transporteur choisi (sa case « Assurance »).
      for (let i = 0; i < list.length; i++) {
        const rate = list[i];
        if (!rate || !isChosen(rt, rate)) continue;
        const want = !!rate.insured;
        if (!!st.checkInsurance !== want) {
          rt.$store.commit("parcel/setValue", ["checkInsurance", want]);
          const cfg = rate.rates && rate.rates[0] && rate.rates[0].insurancePrice;
          rt.$store.commit("parcel/setValue", ["insuranceConfig", cfg || { range: [] }]);
        }
        break;
      }
    }
  }

  // ─── Étape 5 : valeur à assurer ───
  function fmtEur(n) { return Number(n || 0).toFixed(2).replace(".", ",") + " €"; }

  function fillInsurance() {
    const ai = findVms("add-insurance")[0];
    if (!ai || insuranceDone.has(ai)) return;
    const parcels = ai.parcels;
    if (!Array.isArray(parcels) || !parcels.length) return;
    insuranceDone.add(ai);
    if (!ai.checkInsurance) return;
    const value = Number(data.parcelValue);
    if (!(value > 0)) {
      banner("warn", "Assurance : montant de la commande inconnu.", "Saisissez la valeur à assurer à la main.");
      return;
    }
    // Valeurs déjà saisies (retour sur l'étape) : on ne les écrase pas.
    for (let i = 0; i < parcels.length; i++) {
      if (Number(parcels[i].insuredValue) > 0) {
        banner("info", "Assurance déjà renseignée : rien n'a été modifié.", "Valeur de la commande : " + fmtEur(value) + " HT.");
        return;
      }
    }
    // Répartition au poids (parts égales si les poids manquent), en
    // centimes, le reste sur le dernier colis.
    const cents = Math.round(value * 100);
    let totalW = 0;
    const w = parcels.map(function (p) {
      const x = Number(p.weight) || Number(p.declaredWeight) || 0;
      totalW += x;
      return x;
    });
    let given = 0;
    const amounts = [];
    for (let i = 0; i < parcels.length; i++) {
      let c;
      if (i === parcels.length - 1) c = cents - given;
      else c = Math.floor(cents * (totalW > 0 ? w[i] / totalW : 1 / parcels.length));
      given += c;
      amounts.push(c / 100);
    }
    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      if (p.isInsurance === false) ai.$set(p, "isInsurance", true);
      ai.$set(p, "insuredValue", amounts[i]);
      try { ai.insuranceChange(p); } catch (e) { /* ignore */ }
    }
    const over = [];
    for (let i = 0; i < amounts.length; i++) if (amounts[i] > 5000) over.push(i + 1);
    const split = parcels.length > 1 ? " (répartie au poids sur " + parcels.length + " colis)" : "";
    const fee = Number(ai.totalInsuredFee);
    banner(over.length ? "warn" : "ok",
      "Assurance renseignée : " + fmtEur(value) + " HT" + split + ".",
      (fee > 0 ? "Frais d'assurance : " + fmtEur(fee) + " HT. " : "") +
      (over.length ? "Attention : Smarty365 ne couvre que 5 000 € par colis (colis " + over.join(", ") + "). " : "") +
      "Vérifiez puis cliquez « Continuer ».");
    window.postMessage({ source: "s365-regroup", type: "S365_DONE" }, ORIGIN);
  }

  // ─── Normalisation ───
  function norm(s) {
    return String(s == null ? "" : s)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function compact(s) { return norm(s).replace(/ /g, ""); }
  function clean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

  // ─── Pays : nom (FR/EN) ou code ISO → code Smarty365 ───
  const COUNTRY_ALIASES = {
    "france": "FR", "france metropolitaine": "FR", "belgique": "BE", "belgium": "BE",
    "allemagne": "DE", "germany": "DE", "deutschland": "DE", "espagne": "ES", "spain": "ES",
    "espana": "ES", "italie": "IT", "italy": "IT", "italia": "IT", "pays bas": "NL",
    "netherlands": "NL", "the netherlands": "NL", "holland": "NL", "hollande": "NL",
    "nederland": "NL", "suisse": "CH", "switzerland": "CH", "schweiz": "CH",
    "luxembourg": "LU", "portugal": "PT", "autriche": "AT", "austria": "AT",
    "royaume uni": "GB", "united kingdom": "GB", "uk": "GB", "great britain": "GB",
    "angleterre": "GB", "england": "GB", "irlande": "IE", "ireland": "IE",
    "etats unis": "US", "united states": "US", "united states of america": "US", "usa": "US",
    "suede": "SE", "sweden": "SE", "danemark": "DK", "denmark": "DK", "pologne": "PL",
    "poland": "PL", "grece": "GR", "greece": "GR", "republique tcheque": "CZ",
    "czech republic": "CZ", "czechia": "CZ", "tchequie": "CZ", "finlande": "FI",
    "finland": "FI", "norvege": "NO", "norway": "NO", "croatie": "HR", "croatia": "HR",
    "hongrie": "HU", "hungary": "HU", "roumanie": "RO", "romania": "RO", "bulgarie": "BG",
    "bulgaria": "BG", "slovaquie": "SK", "slovakia": "SK", "slovenie": "SI", "slovenia": "SI",
    "lituanie": "LT", "lithuania": "LT", "lettonie": "LV", "latvia": "LV", "estonie": "EE",
    "estonia": "EE", "chypre": "CY", "cyprus": "CY", "malte": "MT", "malta": "MT",
    "monaco": "MC", "reunion": "RE", "la reunion": "RE", "guadeloupe": "GP",
    "martinique": "MQ", "guyane": "GF", "mayotte": "YT", "maroc": "MA", "morocco": "MA",
    "tunisie": "TN", "tunisia": "TN", "algerie": "DZ", "algeria": "DZ", "senegal": "SN",
    "cote d ivoire": "CI", "ivory coast": "CI", "turquie": "TR", "turkey": "TR",
    "emirats arabes unis": "AE", "united arab emirates": "AE", "canada": "CA"
  };
  // Liste des pays de l'application (sélecteurs « XX - Nom »), si présente.
  function countryList() {
    const out = [];
    const sels = findVms("i-select");
    for (let i = 0; i < sels.length; i++) {
      const items = sels[i].items;
      if (!Array.isArray(items) || items.length < 100) continue;
      const first = items[0];
      if (!first || !/^[A-Z]{2} - /.test(String(first.text || ""))) continue;
      for (let j = 0; j < items.length; j++) {
        const it = items[j];
        if (it && it.value) out.push({ code: String(it.value).toUpperCase(), label: String(it.text || "").replace(/^[A-Z]{2} - /, "") });
      }
      break;
    }
    return out;
  }
  function toCode(country) {
    const raw = clean(country);
    if (!raw) return "FR";
    if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase() === "UK" ? "GB" : raw.toUpperCase();
    const n = norm(raw);
    if (COUNTRY_ALIASES[n]) return COUNTRY_ALIASES[n];
    const list = countryList();
    for (let i = 0; i < list.length; i++) if (norm(list[i].label) === n) return list[i].code;
    for (let i = 0; i < list.length; i++) {
      const l = norm(list[i].label);
      if (l.length >= 4 && (" " + n + " ").indexOf(" " + l + " ") !== -1) return list[i].code;
    }
    const m = raw.match(/^([A-Z]{2})\s*-/);
    return m ? m[1] : null;
  }

  // ─── Bandeau d'information (DOM pur, pas d'innerHTML) ───
  let bannerNode = null;
  function banner(kind, text, sub) {
    if (!document.body) return;
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

  // ─── Commande → champs d'adresse Smarty365 ───
  function phoneFields(phone, country) {
    let p = String(phone || "").replace(/[^\d+]/g, "");
    if (!p) return { phoneNumber: null, mobileNumber: null };
    if (country === "FR") {
      if (/^\+33/.test(p)) p = "0" + p.slice(3);
      else if (/^0033/.test(p)) p = "0" + p.slice(4);
      if (/^[67]\d{8}$/.test(p)) p = "0" + p;
      if (/^0[67]\d{8}$/.test(p)) return { phoneNumber: null, mobileNumber: p };
      return { phoneNumber: p, mobileNumber: null };
    }
    return { phoneNumber: null, mobileNumber: p };
  }

  function buildFields(r) {
    const company = clean(r.company);
    let first = clean(r.firstName);
    let last = clean(r.lastName);
    // « Nom » est obligatoire sur Smarty365 : prénom seul → nom ; sinon société.
    if (!last) { last = first || company; first = last === first ? "" : first; }
    const countryCode = toCode(r.country);
    const tel = phoneFields(r.phone, countryCode);
    return {
      company: company,
      shopName: "",
      firstName: first,
      lastName: last,
      street: clean(r.street),
      complement: clean(r.complement).slice(0, 35),
      postalCode: clean(r.postalCode),
      city: clean(r.city),
      countryCode: countryCode,
      phoneNumber: tel.phoneNumber,
      mobileNumber: tel.mobileNumber,
      email: clean(r.email),
      siret: String(r.siret || "").replace(/\D/g, ""),
      vatNumber: String(r.vat || "").replace(/\s+/g, "").toUpperCase(),
      EORI: "",
      instructions: "",
      comment: ""
    };
  }

  function findInBook(list, f, r) {
    const who = [f.company, [r.firstName, r.lastName].filter(Boolean).join(" "), r.lastName]
      .map(compact).filter(Boolean);
    if (!who.length) return null;
    const cp = compact(f.postalCode);
    const city = compact(f.city);
    const street = compact(f.street);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || !a.id || a.id === -1) continue;
      if (a.type && a.type !== "receiver") continue;
      if (String(a.countryCode || "").toUpperCase() !== f.countryCode) continue;
      if (cp && compact(a.postalCode) !== cp) continue;
      const ac = compact(a.city);
      if (city && ac !== city && ac.indexOf(city) === -1 && city.indexOf(ac) === -1) continue;
      const as = compact(a.street);
      if (street && (!as || (as.indexOf(street) === -1 && street.indexOf(as) === -1))) continue;
      const hay = compact([a.company, a.shopName, a.firstName, a.lastName].join(" "));
      let ok = false;
      for (let j = 0; j < who.length; j++) if (hay.indexOf(who[j]) !== -1) ok = true;
      if (!ok) continue;
      return a;
    }
    return null;
  }

  function missingFields(f) {
    const miss = [];
    if (!f.lastName) miss.push("nom ou société");
    if (!f.street) miss.push("adresse");
    if (!f.postalCode) miss.push("code postal");
    if (!f.city) miss.push("ville");
    if (!f.countryCode) miss.push("pays");
    if (!f.phoneNumber && !f.mobileNumber) miss.push("téléphone");
    return miss;
  }

  function addDialogOf(ac) {
    const ch = findVms("address-edit-dialog", ac);
    for (let i = 0; i < ch.length; i++) if (ch[i].operate === "add" && ch[i].$parent === ac) return ch[i];
    for (let i = 0; i < ch.length; i++) if (ch[i].operate === "add") return ch[i];
    return null;
  }

  // Ouvre « + Nouvelle adresse » (destination) pré-rempli.
  async function openPrefilledDialog(ac, f) {
    const d = addDialogOf(ac);
    if (!d) return null;
    await d.open();
    d.openDialog();
    await sleep(500);
    if (!d.address.clientId) d.$set(d.address, "clientId", ac.clientId);
    if (!d.address.type) d.$set(d.address, "type", "receiver");
    const keys = Object.keys(f);
    for (let i = 0; i < keys.length; i++) d.$set(d.address, keys[i], f[keys[i]]);
    await sleep(300);
    return d;
  }

  function continueButton() {
    const pc = findVms("parcel-create")[0];
    const scope = (pc && pc.$el) || document;
    const btns = scope.querySelectorAll("button");
    for (let i = 0; i < btns.length; i++) {
      if (btns[i].offsetParent && /^continuer$/i.test((btns[i].innerText || "").trim())) return btns[i];
    }
    return null;
  }

  async function finish(id, label, how) {
    const ok = await waitFor(function () {
      const st = parcelState();
      return currentReceiverId() === id && st && st.receiverAddress && st.receiverAddress.id === id;
    }, 15000);
    if (!ok) {
      banner("warn", "Destinataire " + how + " : " + label, "Vérifiez-le puis cliquez « Continuer ».");
      return;
    }
    if (data) data.addressDone = true;
    window.postMessage({ source: "s365-regroup", type: "S365_ADDRESS_DONE" }, ORIGIN);
    banner("ok", "Destinataire " + how + " : " + label, "Passage à l'étape « Colis » : saisissez le poids, « Ajouter », puis « Continuer » pour voir les transporteurs (assurance cochée par défaut).");
    await sleep(1200);
    const btn = continueButton();
    if (!btn || btn.disabled) return;
    btn.click();
    const atColis = await waitFor(function () { const st = parcelState(); return st && st.step === 2; }, 8000);
    if (!atColis) return;
    await sleep(500);
    const inputs = document.querySelectorAll("input[type=number]");
    for (let i = 0; i < inputs.length; i++) {
      const lab = inputs[i].id ? document.querySelector('label[for="' + inputs[i].id + '"]') : null;
      if (inputs[i].offsetParent && lab && /poid/i.test(lab.textContent || "")) {
        inputs[i].scrollIntoView({ block: "center" });
        inputs[i].focus();
        break;
      }
    }
  }

  function addressLabel(a) {
    if (!a) return "";
    return [a.company || [a.firstName, a.lastName].filter(Boolean).join(" "), [a.postalCode, a.city].filter(Boolean).join(" ")]
      .filter(Boolean).join(" — ");
  }

  // Formulaire laissé à Boris : dès qu'un destinataire est enregistré ou
  // choisi (15 min max), on passe à l'étape « Colis ».
  async function watchManual(before) {
    const id = await waitFor(function () {
      const v = currentReceiverId();
      return v && v !== before ? v : null;
    }, 15 * 60 * 1000, 500);
    if (!id) return;
    const st = parcelState();
    return finish(id, addressLabel(st && st.receiverAddress), "enregistré");
  }

  async function runAddress() {
    const r = (data && data.receiver) || {};
    const title = [r.company || [r.firstName, r.lastName].filter(Boolean).join(" "), [r.postalCode, r.city].filter(Boolean).join(" ")]
      .filter(Boolean).join(" — ");
    banner("info", "Smarty365 : recherche du client dans le carnet d'adresses…", title);

    // Carnet « Adresse de destination » chargé et stable.
    let stable = 0;
    const ac = await waitFor(function () {
      const st = parcelState();
      if (!onCreatePage() || !st || st.step !== 1) { stable = 0; return null; }
      const a = receiverPicker();
      if (a && !a.loading && Array.isArray(a.addresses)) stable++; else stable = 0;
      return stable >= 4 ? a : null;
    }, 30000, 300);
    if (!ac) {
      banner("warn", "Page « Envois de colis » de Smarty365 introuvable.",
        "Ouvrez Envois de colis (www.smarty365.com/dashboard/parcel/create).");
      return;
    }

    const f = buildFields(r);
    const before = currentReceiverId();
    if (!f.countryCode) {
      banner("warn", "Pays « " + (r.country || "?") + " » non reconnu.",
        "Le formulaire « Nouvelle adresse » s'ouvre pré-rempli : choisissez le pays puis enregistrez.");
      f.countryCode = "";
      await openPrefilledDialog(ac, f);
      return watchManual(before);
    }

    // Recherche côté serveur (complète la liste du sélecteur) : code postal,
    // puis société / nom si besoin.
    const searches = [f.postalCode, f.company || f.lastName];
    let found = null;
    for (let i = 0; i < searches.length && !found; i++) {
      const q = clean(searches[i]);
      if (q && typeof ac.querySelections === "function" && typeof ac.buildSearchQuery === "function") {
        try { await ac.querySelections(ac.buildSearchQuery(q)); } catch (e) { /* ignore */ }
      }
      found = findInBook(ac.addresses || [], f, r);
    }
    if (found) {
      ac.selectedAddressId = found.id;
      ac.syncValue(found.id);
      return finish(found.id, addressLabel(found), "sélectionné");
    }

    const miss = missingFields(f);
    const d = await openPrefilledDialog(ac, f);
    if (!d) {
      banner("warn", "Formulaire « Nouvelle adresse » introuvable.", "Ajoutez le destinataire à la main.");
      return watchManual(before);
    }
    if (miss.length) {
      banner("warn", "Client absent du carnet — informations manquantes : " + miss.join(", ") + ".",
        "Complétez le formulaire puis « Enregistrer l'adresse » ; la suite se fera automatiquement.");
      return watchManual(before);
    }

    banner("info", "Client absent du carnet : création dans Smarty365…", title);
    let err = null;
    try { await d.save(); } catch (e) { err = e; }
    const id = await waitFor(function () {
      const v = currentReceiverId();
      return !d.dialog && v && v !== before ? v : null;
    }, err ? 1000 : 15000);
    if (id) {
      const st = parcelState();
      return finish(id, addressLabel(st && st.receiverAddress) || title, "créé et sélectionné");
    }
    const msg = err && (err.response && err.response.data && err.response.data.message || err.message);
    banner("warn", "Smarty365 n'a pas accepté la création automatique" + (msg ? " (" + String(msg).slice(0, 160) + ")" : "") + ".",
      "Corrigez le formulaire pré-rempli puis « Enregistrer l'adresse » ; la suite se fera automatiquement.");
    return watchManual(before);
  }
})();
