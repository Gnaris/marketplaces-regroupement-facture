(function () {
  const $ = function (id) { return document.getElementById(id); };

  const el = {
    token: $("token"),
    toggleToken: $("toggleToken"),
    validateToken: $("validateToken"),
    tokenStatus: $("tokenStatus"),

    siretLookup: $("siretLookup"),
    siretBtn: $("siretBtn"),
    siretStatus: $("siretStatus"),

    s_company: $("s_company"),
    s_shopName: $("s_shopName"),
    s_siret: $("s_siret"),
    s_email: $("s_email"),
    s_phone: $("s_phone"),
    s_street: $("s_street"),
    s_complement: $("s_complement"),
    s_postalCode: $("s_postalCode"),
    s_city: $("s_city"),
    s_country: $("s_country"),

    save: $("save"),
    saveStatus: $("saveStatus")
  };

  // Valeurs par défaut Beli & Jolie (90 rue de la Haie Coq, 93300 Aubervilliers).
  const DEFAULT_SENDER = {
    company: "Beli & Jolie",
    shopName: "Beli & Jolie",
    siret: "",
    email: "",
    phone: "07 82 75 81 58",
    street: "90 rue de la Haie Coq",
    complement: "",
    postalCode: "93300",
    city: "Aubervilliers",
    country: "France"
  };

  function setStatus(node, text, kind) {
    node.textContent = text || "";
    node.classList.remove("ok", "err", "warn", "muted");
    node.classList.add(kind || "muted");
  }

  function readForm() {
    return {
      token: el.token.value.trim(),
      sender: {
        company: el.s_company.value.trim(),
        shopName: el.s_shopName.value.trim(),
        siret: el.s_siret.value.replace(/\s+/g, ""),
        email: el.s_email.value.trim(),
        phone: el.s_phone.value.trim(),
        street: el.s_street.value.trim(),
        complement: el.s_complement.value.trim(),
        postalCode: el.s_postalCode.value.trim(),
        city: el.s_city.value.trim(),
        country: el.s_country.value.trim() || "France"
      }
    };
  }

  function writeSender(s) {
    el.s_company.value = s.company || "";
    el.s_shopName.value = s.shopName || "";
    el.s_siret.value = s.siret || "";
    el.s_email.value = s.email || "";
    el.s_phone.value = s.phone || "";
    el.s_street.value = s.street || "";
    el.s_complement.value = s.complement || "";
    el.s_postalCode.value = s.postalCode || "";
    el.s_city.value = s.city || "";
    el.s_country.value = s.country || "France";
  }

  function load() {
    chrome.storage.sync.get(
      ["easyExpressToken", "easyExpressSender"],
      function (res) {
        el.token.value = res.easyExpressToken || "";
        writeSender(res.easyExpressSender || DEFAULT_SENDER);
        setStatus(el.tokenStatus, res.easyExpressToken ? "Clé enregistrée (non revérifiée)" : "Aucune clé enregistrée", "muted");
      }
    );
  }

  // ─── Toggle visibilité ─────────────────────────────────────────────
  el.toggleToken.addEventListener("click", function () {
    el.token.type = el.token.type === "password" ? "text" : "password";
  });

  // ─── Vérifier le jeton ─────────────────────────────────────────────
  el.validateToken.addEventListener("click", function () {
    const token = el.token.value.trim();
    if (!token) { setStatus(el.tokenStatus, "Saisissez une clé.", "warn"); return; }
    setStatus(el.tokenStatus, "Vérification en cours…", "muted");
    el.validateToken.disabled = true;
    chrome.runtime.sendMessage({ type: "EE_VALIDATE_KEY", token: token }, function (res) {
      el.validateToken.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus(el.tokenStatus, "Erreur : " + chrome.runtime.lastError.message, "err");
        return;
      }
      if (res && res.ok) setStatus(el.tokenStatus, "✓ Clé valide", "ok");
      else setStatus(el.tokenStatus, "✗ " + ((res && res.error) || "Clé refusée"), "err");
    });
  });

  // ─── Lookup SIRET ──────────────────────────────────────────────────
  el.siretBtn.addEventListener("click", function () {
    const q = el.siretLookup.value.replace(/\D/g, "");
    if (q.length !== 14 && q.length !== 9) {
      setStatus(el.siretStatus, "Saisissez un SIRET (14) ou un SIREN (9).", "warn");
      return;
    }
    const kind = q.length === 14 ? "siret" : "siren";
    setStatus(el.siretStatus, "Recherche…", "muted");
    el.siretBtn.disabled = true;
    chrome.runtime.sendMessage({ type: "ANNUAIRE_LOOKUP", query: q, kind: kind }, function (res) {
      el.siretBtn.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus(el.siretStatus, "Erreur : " + chrome.runtime.lastError.message, "err");
        return;
      }
      if (!res || !res.ok) {
        setStatus(el.siretStatus, (res && res.error) || "Erreur annuaire.", "err");
        return;
      }
      const d = res.data || {};
      if (!d.found) {
        setStatus(el.siretStatus, d.reason || "Entreprise introuvable.", "warn");
        return;
      }
      el.s_company.value = d.denomination || el.s_company.value;
      el.s_siret.value = d.siret || el.s_siret.value;
      el.s_street.value = d.adresse || el.s_street.value;
      el.s_postalCode.value = d.codePostal || el.s_postalCode.value;
      el.s_city.value = d.commune || el.s_city.value;
      if (!el.s_country.value) el.s_country.value = "France";
      setStatus(el.siretStatus, "✓ Récupéré : " + (d.denomination || d.siret), "ok");
    });
  });

  // ─── Enregistrer ───────────────────────────────────────────────────
  el.save.addEventListener("click", function () {
    const data = readForm();
    const errors = [];
    if (!data.token) errors.push("clé API vide");
    if (!data.sender.postalCode) errors.push("code postal expéditeur");
    if (!data.sender.city) errors.push("ville expéditeur");
    if (!data.sender.street) errors.push("rue expéditeur");
    if (errors.length) {
      setStatus(el.saveStatus, "Manque : " + errors.join(", "), "warn");
      return;
    }
    chrome.storage.sync.set({
      easyExpressToken: data.token,
      easyExpressSender: data.sender
    }, function () {
      if (chrome.runtime.lastError) {
        setStatus(el.saveStatus, "Erreur stockage : " + chrome.runtime.lastError.message, "err");
      } else {
        setStatus(el.saveStatus, "✓ Enregistré", "ok");
        setTimeout(function () { setStatus(el.saveStatus, "", "muted"); }, 3000);
      }
    });
  });

  load();
})();
