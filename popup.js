(function () {
  const $ = function (id) { return document.getElementById(id); };

  // Helper DOM pour éviter toute utilisation d'innerHTML.
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === "className") node.className = props[k];
        else if (k === "dataset") Object.assign(node.dataset, props[k]);
        else if (k.startsWith("on") && typeof props[k] === "function") node.addEventListener(k.slice(2).toLowerCase(), props[k]);
        else if (k === "text") node.textContent = props[k];
        else node.setAttribute(k, props[k]);
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  const dom = {
    prefillBanner: $("prefillBanner"),
    prefillTitle: $("prefillTitle"),
    prefillMsg: $("prefillMsg"),

    openOptions: $("openOptions"),

    // Étape 1
    step1: $("step1"),
    r_siretLookup: $("r_siretLookup"),
    r_siretBtn: $("r_siretBtn"),
    r_siretStatus: $("r_siretStatus"),
    r_firstName: $("r_firstName"),
    r_lastName: $("r_lastName"),
    r_company: $("r_company"),
    r_street: $("r_street"),
    r_complement: $("r_complement"),
    r_postalCode: $("r_postalCode"),
    r_city: $("r_city"),
    r_country: $("r_country"),
    r_phone: $("r_phone"),
    r_email: $("r_email"),
    p_weight: $("p_weight"),
    p_instructions: $("p_instructions"),
    getRates: $("getRates"),
    step1Status: $("step1Status"),

    // Étape 2
    step2: $("step2"),
    backStep1: $("backStep1"),
    ratesMeta: $("ratesMeta"),
    carriers: $("carriers"),
    checkout: $("checkout"),
    step2Status: $("step2Status"),

    // Étape 3
    step3: $("step3"),
    trackingBlock: $("trackingBlock"),
    openLabel: $("openLabel"),
    newShipment: $("newShipment")
  };

  const state = {
    transactionId: "",
    carriers: [],
    selectedCarrierId: ""
  };

  // ─── Persistance brouillon ────────────────────────────────────────
  const DRAFT_KEY = "eeDraftReceiver";
  function saveDraft() {
    const draft = {
      firstName: dom.r_firstName.value, lastName: dom.r_lastName.value,
      company: dom.r_company.value, street: dom.r_street.value,
      complement: dom.r_complement.value, postalCode: dom.r_postalCode.value,
      city: dom.r_city.value, country: dom.r_country.value,
      phone: dom.r_phone.value, email: dom.r_email.value,
      weight: dom.p_weight.value,
      instructions: dom.p_instructions.value
    };
    chrome.storage.local.set({ [DRAFT_KEY]: draft });
  }
  function loadDraft() {
    chrome.storage.local.get([DRAFT_KEY], function (res) {
      const d = res[DRAFT_KEY];
      if (!d) return;
      dom.r_firstName.value = d.firstName || "";
      dom.r_lastName.value = d.lastName || "";
      dom.r_company.value = d.company || "";
      dom.r_street.value = d.street || "";
      dom.r_complement.value = d.complement || "";
      dom.r_postalCode.value = d.postalCode || "";
      dom.r_city.value = d.city || "";
      dom.r_country.value = d.country || "France";
      dom.r_phone.value = d.phone || "";
      dom.r_email.value = d.email || "";
      if (d.weight) dom.p_weight.value = d.weight;
      dom.p_instructions.value = d.instructions || "";
    });
  }
  function clearDraft() { chrome.storage.local.remove(DRAFT_KEY); }

  ["r_firstName", "r_lastName", "r_company", "r_street", "r_complement", "r_postalCode", "r_city", "r_country", "r_phone", "r_email", "p_weight", "p_instructions"].forEach(function (k) {
    dom[k].addEventListener("input", saveDraft);
  });

  // ─── Helpers UI ───────────────────────────────────────────────────
  function setStatus(node, text, kind) {
    node.textContent = text || "";
    node.classList.remove("ok", "err", "warn", "muted");
    node.classList.add(kind || "muted");
  }
  function showStep(n) {
    dom.step1.classList.toggle("hidden", n !== 1);
    dom.step2.classList.toggle("hidden", n !== 2);
    dom.step3.classList.toggle("hidden", n !== 3);
  }
  function formatEur(v) {
    const n = Number(v) || 0;
    return n.toFixed(2).replace(".", ",") + " €";
  }

  // ─── Options ──────────────────────────────────────────────────────
  dom.openOptions.addEventListener("click", function () {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else chrome.tabs.create({ url: "options.html" });
  });

  // ─── Lookup SIRET / SIREN / N° TVA UE destinataire ────────────────
  dom.r_siretBtn.addEventListener("click", function () {
    const raw = dom.r_siretLookup.value;
    const classified = classifyLookup(raw);
    if (!classified) {
      setStatus(dom.r_siretStatus, "Saisissez un SIRET (14), un SIREN (9) ou un n° TVA UE.", "warn");
      return;
    }
    setStatus(dom.r_siretStatus, classified.route === "vies"
      ? "Vérification VIES (" + classified.country + ")…"
      : "Recherche…", "muted");
    dom.r_siretBtn.disabled = true;

    const msg = classified.route === "vies"
      ? { type: "VIES_LOOKUP", query: classified.query }
      : { type: "ANNUAIRE_LOOKUP", query: classified.query, kind: classified.kind };

    chrome.runtime.sendMessage(msg, function (res) {
      dom.r_siretBtn.disabled = false;
      if (chrome.runtime.lastError) { setStatus(dom.r_siretStatus, "Erreur : " + chrome.runtime.lastError.message, "err"); return; }
      if (!res || !res.ok) { setStatus(dom.r_siretStatus, (res && res.error) || "Erreur de vérification.", "err"); return; }
      const d = res.data || {};
      if (!d.found) {
        setStatus(dom.r_siretStatus, d.reason || "Entreprise introuvable.", "warn");
        return;
      }
      if (classified.route === "vies") {
        if (d.denomination) dom.r_company.value = d.denomination;
        const parsed = parseViesAddressBlock(d.adresseLigne || "");
        if (parsed.street) dom.r_street.value = parsed.street;
        if (parsed.postalCode) dom.r_postalCode.value = parsed.postalCode;
        if (parsed.city) dom.r_city.value = parsed.city;
        const frCountry = isoToCountryFr(d.country);
        if (frCountry) dom.r_country.value = frCountry;
        saveDraft();
        setStatus(dom.r_siretStatus, "✓ VIES — " + (d.denomination || "n° TVA valide (" + d.tva + ")"), "ok");
      } else {
        dom.r_company.value = d.denomination || dom.r_company.value;
        dom.r_street.value = d.adresse || dom.r_street.value;
        dom.r_postalCode.value = d.codePostal || dom.r_postalCode.value;
        dom.r_city.value = d.commune || dom.r_city.value;
        if (!dom.r_country.value) dom.r_country.value = "France";
        saveDraft();
        setStatus(dom.r_siretStatus, "✓ " + (d.denomination || d.siret), "ok");
      }
    });
  });

  // Classification : préfixe pays (2 lettres) d'abord — sinon "DE123456789"
  // (TVA DE, 9 chiffres) serait pris pour un SIREN français.
  function classifyLookup(raw) {
    const cleaned = String(raw || "").replace(/[\s\-.]/g, "").toUpperCase();
    const EU = new Set(["AT","BE","BG","CY","CZ","DE","DK","EE","EL","ES","FI","FR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","XI"]);
    if (/^[A-Z]{2}/.test(cleaned)) {
      let country = cleaned.slice(0, 2);
      if (country === "GR") country = "EL";
      if (!EU.has(country)) return null;
      const number = cleaned.slice(2);
      if (!/^[0-9A-Z+*]{2,13}$/.test(number)) return null;
      if (country === "FR") {
        if (!/^[0-9A-HJ-NP-Z]{2}\d{9}$/.test(number)) return null;
        return { route: "annuaire", kind: "siren", query: number.slice(-9) };
      }
      return { route: "vies", query: country + number, country: country === "EL" ? "GR" : country };
    }
    const digits = cleaned.replace(/\D/g, "");
    if (digits.length === 14) return { route: "annuaire", kind: "siret", query: digits };
    if (digits.length === 9) return { route: "annuaire", kind: "siren", query: digits };
    return null;
  }

  // Parse l'adresse texte libre renvoyée par VIES (souvent multi-lignes
  // avec la dernière ligne au format "CP VILLE"). On ne garantit rien,
  // on fait au mieux — l'utilisateur peut corriger ensuite.
  function parseViesAddressBlock(addr) {
    const out = { street: "", postalCode: "", city: "" };
    if (!addr) return out;
    const lines = String(addr).split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return out;
    // Dernière ligne : essayer "CP VILLE" (CP = 2-6 car. alphanum)
    const last = lines[lines.length - 1];
    const m = last.match(/^\s*([0-9][0-9A-Z\-\s]{1,8}?)\s{1,2}(.+)$/i);
    if (m) {
      out.postalCode = m[1].replace(/\s+/g, "");
      out.city = m[2].trim();
      out.street = lines.slice(0, -1).join(", ");
    } else {
      out.street = lines.join(", ");
    }
    return out;
  }

  function isoToCountryFr(iso) {
    const map = {
      AT: "Autriche", BE: "Belgique", BG: "Bulgarie", CY: "Chypre",
      CZ: "Tchéquie", DE: "Allemagne", DK: "Danemark", EE: "Estonie",
      EL: "Grèce", GR: "Grèce", ES: "Espagne", FI: "Finlande", FR: "France",
      HR: "Croatie", HU: "Hongrie", IE: "Irlande", IT: "Italie",
      LT: "Lituanie", LU: "Luxembourg", LV: "Lettonie", MT: "Malte",
      NL: "Pays-Bas", PL: "Pologne", PT: "Portugal", RO: "Roumanie",
      SE: "Suède", SI: "Slovénie", SK: "Slovaquie", XI: "Royaume-Uni"
    };
    return map[(iso || "").toUpperCase()] || "";
  }

  // ─── Validation étape 1 ───────────────────────────────────────────
  function validateStep1() {
    const errs = [];
    if (!dom.r_lastName.value.trim() && !dom.r_company.value.trim()) errs.push("nom ou société");
    if (!dom.r_street.value.trim()) errs.push("adresse");
    if (!dom.r_postalCode.value.trim()) errs.push("code postal");
    if (!dom.r_city.value.trim()) errs.push("ville");
    if (!dom.r_country.value.trim()) errs.push("pays");
    if (!(Number(dom.p_weight.value) > 0)) errs.push("poids");
    return errs;
  }

  // ─── Récupérer tarifs ─────────────────────────────────────────────
  dom.getRates.addEventListener("click", function () {
    const errs = validateStep1();
    if (errs.length) { setStatus(dom.step1Status, "Manque : " + errs.join(", "), "warn"); return; }

    setStatus(dom.step1Status, "Interrogation d'Easy-Express…", "muted");
    dom.getRates.disabled = true;

    const payload = {
      receiverCountry: dom.r_country.value.trim(),
      receiverZipCode: dom.r_postalCode.value.trim(),
      weightKg: Number(dom.p_weight.value)
    };

    chrome.runtime.sendMessage({ type: "EE_RATES", payload: payload }, function (res) {
      dom.getRates.disabled = false;
      if (chrome.runtime.lastError) { setStatus(dom.step1Status, "Erreur : " + chrome.runtime.lastError.message, "err"); return; }
      if (!res || !res.ok) { setStatus(dom.step1Status, (res && res.error) || "Erreur réseau.", "err"); return; }
      const d = res.data || {};
      if (!d.success) { setStatus(dom.step1Status, d.error || "Easy-Express a refusé la requête.", "err"); return; }
      if (!d.carriers || !d.carriers.length) { setStatus(dom.step1Status, "Aucun transporteur disponible.", "warn"); return; }

      state.transactionId = d.transactionId || "";
      state.carriers = d.carriers;
      state.selectedCarrierId = "";
      renderCarriers(d);
      setStatus(dom.step1Status, "", "muted");
      showStep(2);
    });
  });

  // ─── Rendu transporteurs ──────────────────────────────────────────
  function renderCarriers(d) {
    dom.carriers.replaceChildren();
    dom.checkout.disabled = true;

    dom.ratesMeta.textContent = d.parcelCount + " colis";

    // Tri par prix HT croissant pour aider le choix.
    const sorted = d.carriers.slice().sort(function (a, b) { return a.priceHT - b.priceHT; });

    sorted.forEach(function (c) {
      const li = el("li", { className: "carrier", dataset: { id: c.carrierId } });

      // Logo
      const logo = el("div", { className: "logo" });
      if (c.logo) {
        const img = el("img", { alt: c.name, referrerpolicy: "no-referrer" });
        img.src = c.logo;
        img.onerror = function () { logo.textContent = (c.name || "").slice(0, 3).toUpperCase(); img.remove(); };
        logo.appendChild(img);
      } else {
        logo.textContent = (c.name || "").slice(0, 3).toUpperCase();
      }

      // Infos
      const main = el("div", { className: "main" }, [
        el("div", { className: "name", text: c.name }),
        el("div", { className: "delay", text: c.delay })
      ]);
      const extra = [c.maxSize, c.storage].filter(Boolean).join(" · ");
      if (extra) main.appendChild(el("div", { className: "meta", text: extra }));

      // Prix
      const price = el("div", { className: "price" });

      const ttc = el("div", { className: "ttc" }, [
        document.createTextNode(c.priceTTC.toFixed(2).replace(".", ",") + " "),
        el("span", { className: "cur", text: "€ TTC" })
      ]);
      const ht = el("div", { className: "ht", text: formatEur(c.priceHT) + " HT" });
      price.appendChild(ttc);
      price.appendChild(ht);

      // Assurance : affichée uniquement si l'API Easy-Express la renvoie
      // (détection défensive dans background.js — pas de calcul client-side).
      if (c.priceTTCWithInsurance != null && c.priceTTCWithInsurance > c.priceTTC) {
        const ins = el("div", {
          className: "ins",
          text: "Avec assurance : " + formatEur(c.priceTTCWithInsurance) + " TTC"
        });
        price.appendChild(ins);
      }

      // Réduction défensive si l'API renvoie un prix de référence > prix facturé.
      if (c.discountHT != null && c.discountHT > c.priceHT) {
        const economy = c.discountHT - c.priceHT;
        price.appendChild(el("div", {
          className: "promo",
          text: "Réduction : -" + formatEur(economy),
          title: "Prix public : " + formatEur(c.discountHT) + " HT"
        }));
      }

      li.appendChild(logo);
      li.appendChild(main);
      li.appendChild(price);

      li.addEventListener("click", function () {
        state.selectedCarrierId = c.carrierId;
        Array.prototype.forEach.call(dom.carriers.querySelectorAll(".carrier"), function (node) {
          node.classList.toggle("selected", node.dataset.id === c.carrierId);
        });
        dom.checkout.disabled = false;
      });

      dom.carriers.appendChild(li);
    });
  }

  // ─── Retour étape 1 ───────────────────────────────────────────────
  dom.backStep1.addEventListener("click", function () {
    showStep(1);
  });

  // ─── Checkout ─────────────────────────────────────────────────────
  dom.checkout.addEventListener("click", function () {
    if (!state.selectedCarrierId) return;
    setStatus(dom.step2Status, "Création du bordereau…", "muted");
    dom.checkout.disabled = true;

    const payload = {
      transactionId: state.transactionId,
      carrierId: state.selectedCarrierId,
      weightKg: Number(dom.p_weight.value),
      receiver: {
        firstName: dom.r_firstName.value.trim(),
        lastName: dom.r_lastName.value.trim(),
        company: dom.r_company.value.trim(),
        street: dom.r_street.value.trim(),
        complement: dom.r_complement.value.trim(),
        postalCode: dom.r_postalCode.value.trim(),
        city: dom.r_city.value.trim(),
        country: dom.r_country.value.trim(),
        phone: dom.r_phone.value.trim(),
        email: dom.r_email.value.trim(),
        instructions: dom.p_instructions.value.trim()
      }
    };

    chrome.runtime.sendMessage({ type: "EE_CHECKOUT", payload: payload }, function (res) {
      dom.checkout.disabled = false;
      if (chrome.runtime.lastError) { setStatus(dom.step2Status, "Erreur : " + chrome.runtime.lastError.message, "err"); return; }
      if (!res || !res.ok) { setStatus(dom.step2Status, (res && res.error) || "Erreur réseau.", "err"); return; }
      const d = res.data || {};
      if (!d.success) { setStatus(dom.step2Status, d.error || "Easy-Express a refusé la requête.", "err"); return; }

      dom.openLabel.href = d.labelUrl;
      dom.trackingBlock.textContent = d.trackingId ? "Suivi : " + d.trackingId : "";
      chrome.tabs.create({ url: d.labelUrl, active: true });
      clearDraft();
      showStep(3);
    });
  });

  // ─── Nouveau bordereau ────────────────────────────────────────────
  dom.newShipment.addEventListener("click", function () {
    state.transactionId = "";
    state.carriers = [];
    state.selectedCarrierId = "";
    ["r_firstName", "r_lastName", "r_company", "r_street", "r_complement", "r_postalCode", "r_city", "r_phone", "r_email", "p_instructions"].forEach(function (k) {
      dom[k].value = "";
    });
    dom.r_country.value = "France";
    dom.p_weight.value = 1;
    dom.r_siretLookup.value = "";
    setStatus(dom.r_siretStatus, "", "muted");
    setStatus(dom.step1Status, "", "muted");
    setStatus(dom.step2Status, "", "muted");
    showStep(1);
  });

  // ─── Pré-remplissage depuis une commande marketplace ─────────────
  // Si l'URL comporte ?from=order, on charge le payload stocké dans
  // chrome.storage.local[eePrefill] (déposé par le service worker juste avant
  // l'ouverture de la fenêtre), on remplit les champs et on marque en orange
  // ceux qui restent à compléter manuellement.
  const REQUIRED_FIELDS = ["r_street", "r_postalCode", "r_city", "r_country"];

  function flagMissingFields() {
    const missing = [];
    REQUIRED_FIELDS.forEach(function (k) {
      if (!dom[k].value.trim()) {
        dom[k].classList.add("needs-review");
        missing.push(k);
      } else {
        dom[k].classList.remove("needs-review");
      }
    });
    // Nom OU société obligatoire — on flag les deux si rien n'est fourni.
    const hasName = dom.r_lastName.value.trim() || dom.r_company.value.trim();
    if (!hasName) {
      dom.r_lastName.classList.add("needs-review");
      dom.r_company.classList.add("needs-review");
      missing.push("r_lastName");
    } else {
      dom.r_lastName.classList.remove("needs-review");
      dom.r_company.classList.remove("needs-review");
    }
    return missing;
  }

  // Nettoie le flag dès que l'utilisateur commence à corriger un champ.
  REQUIRED_FIELDS.concat(["r_lastName", "r_company"]).forEach(function (k) {
    dom[k].addEventListener("input", function () { dom[k].classList.remove("needs-review"); });
  });

  function fillReceiver(r) {
    if (!r || typeof r !== "object") return;
    if (r.firstName) dom.r_firstName.value = r.firstName;
    if (r.lastName) dom.r_lastName.value = r.lastName;
    if (r.company) dom.r_company.value = r.company;
    if (r.street) dom.r_street.value = r.street;
    if (r.complement) dom.r_complement.value = r.complement;
    if (r.postalCode) dom.r_postalCode.value = r.postalCode;
    if (r.city) dom.r_city.value = r.city;
    if (r.country) dom.r_country.value = r.country;
    if (r.phone) dom.r_phone.value = r.phone;
    if (r.email) dom.r_email.value = r.email;
  }

  function showBanner(opts) {
    dom.prefillBanner.classList.remove("hidden", "ok");
    if (opts.ok) dom.prefillBanner.classList.add("ok");
    dom.prefillTitle.textContent = opts.title || "";
    dom.prefillMsg.textContent = opts.msg || "";
  }

  function init() {
    const params = new URLSearchParams(location.search);
    const fromOrder = params.get("from") === "order";

    if (!fromOrder) {
      loadDraft();
      showStep(1);
      return;
    }

    chrome.storage.local.get(["eePrefill"], function (res) {
      const prefill = res && res.eePrefill;
      if (!prefill || !prefill.receiver) {
        // Rien à pré-remplir — comportement normal avec brouillon éventuel.
        loadDraft();
        showStep(1);
        return;
      }
      fillReceiver(prefill.receiver);
      saveDraft();
      const missing = flagMissingFields();
      const orderLabel = prefill.orderNo ? " « " + prefill.orderNo + " »" : "";
      if (missing.length) {
        showBanner({
          title: "Pré-rempli depuis la commande" + orderLabel,
          msg: "Champs à compléter : " + missing.map(function (k) {
            return ({
              r_street: "adresse",
              r_postalCode: "code postal",
              r_city: "ville",
              r_country: "pays",
              r_lastName: "nom ou société"
            })[k] || k;
          }).join(", ") + "."
        });
      } else {
        showBanner({
          ok: true,
          title: "Pré-rempli depuis la commande" + orderLabel,
          msg: "Toutes les informations livraison semblent complètes. Vérifiez puis calculez les tarifs."
        });
      }
      // Nettoie le prefill — ouverture suivante repart propre.
      chrome.storage.local.remove("eePrefill");
      showStep(1);
    });
  }

  init();
})();
