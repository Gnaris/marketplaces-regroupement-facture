(function () {
  const HOST_PFS = "wholesaler.parisfashionshops.com";
  const HOST_EFP = "wholesaler.efashion-paris.com";
  const HOST_FAIRE = "www.faire.com";
  const HOST_MC = "web.mc.app";
  const HOST_OC = "www.orderchamp.com";
  const HOST_SHOPIFY = "admin.shopify.com";
  const HOST_BJ = "beliandjolie.com";
  const HOST_BM = "www.bijouxmysteres.fr";
  const HOST_ISSYMA = "issyma.fr";
  const host = location.hostname;
  let site = null;
  if (host === HOST_PFS) site = "pfs";
  else if (host === HOST_EFP) site = "efp";
  else if (host.endsWith(".ankorstore.com")) site = "aks";
  else if (host === HOST_FAIRE) site = "faire";
  else if (host === HOST_MC || host.endsWith(".dokkr.net")) site = "mc";
  else if (host === HOST_OC) site = "oc";
  else if (host === HOST_SHOPIFY) site = "shopify";
  else if (host === HOST_BJ || host === "www." + HOST_BJ || host === "localhost") site = "bj";
  else if (host === HOST_ISSYMA || host === "www." + HOST_ISSYMA) site = "issyma";
  else if (host === HOST_BM) site = "bm";
  if (!site) return;

  const isTopFrame = window.top === window.self;

  let cachedToken = null;
  let cachedFaireCustomer = null;
  let cachedShopifyCsrf = null;

  if (site === "faire") {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("injected-faire.js");
    s.onload = function () { s.remove(); };
    (document.head || document.documentElement).appendChild(s);

    window.addEventListener("message", function (event) {
      if (event.source !== window) return;
      const d = event.data;
      if (d && d.source === "faire-regroup" && d.type === "FAIRE_CUSTOMER" && d.data) {
        cachedFaireCustomer = d.data;
      }
    });
  }

  // Faire : `cachedFaireCustomer` est alimenté par `injected-faire.js` quand
  // Faire émet /api/crm/brands/customer-details (déclenché à l'ouverture d'une
  // commande depuis le brand portal — un F5 brut ne le rejoue pas forcément).
  // Lors d'un clic sur « Regrouper la facture » juste après l'arrivée sur la
  // page, la requête peut encore être en vol : on patiente ici avant de rendre
  // le modal pour ne pas afficher un regroupement sans bloc livraison (= pas
  // de bouton Easy-Express). Timeout 8 s puis on continue sans adresses.
  function waitForFaireCustomer(timeoutMs) {
    return new Promise(function (resolve) {
      if (cachedFaireCustomer) return resolve(cachedFaireCustomer);
      const start = Date.now();
      const interval = setInterval(function () {
        if (cachedFaireCustomer) {
          clearInterval(interval);
          resolve(cachedFaireCustomer);
        } else if (Date.now() - start >= timeoutMs) {
          clearInterval(interval);
          resolve(null);
        }
      }, 200);
    });
  }

  if (site === "pfs") {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("injected.js");
    s.onload = function () { s.remove(); };
    (document.head || document.documentElement).appendChild(s);

    window.addEventListener("message", function (event) {
      if (event.source !== window) return;
      const d = event.data;
      if (d && d.source === "pfs-regroup" && d.type === "AUTH_TOKEN" && d.token) {
        cachedToken = d.token;
      }
    });
  }

  if (site === "mc") {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("injected-mc.js");
    s.onload = function () { s.remove(); };
    (document.head || document.documentElement).appendChild(s);

    window.addEventListener("message", function (event) {
      if (event.source !== window) return;
      const d = event.data;
      if (d && d.source === "mc-regroup" && d.type === "MC_ORDER" && d.data) {
        chrome.runtime.sendMessage({ type: "SAVE_MC_ORDER", data: d.data });
      }
    });

    if (!isTopFrame) return;
  }

  if (site === "shopify") {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("injected-shopify.js");
    s.onload = function () { s.remove(); };
    (document.head || document.documentElement).appendChild(s);

    window.addEventListener("message", function (event) {
      if (event.source !== window) return;
      const d = event.data;
      if (d && d.source === "shopify-regroup" && d.type === "CSRF_TOKEN" && d.token) {
        cachedShopifyCsrf = d.token;
      }
    });
  }

  const bmPendingFetches = new Map();
  if (site === "bm") {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("injected-bm.js");
    s.onload = function () { s.remove(); };
    (document.head || document.documentElement).appendChild(s);

    window.addEventListener("message", function (event) {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== "bm-regroup" || d.type !== "FETCH_ORDER_RESULT") return;
      const pending = bmPendingFetches.get(d.requestId);
      if (!pending) return;
      bmPendingFetches.delete(d.requestId);
      pending(d);
    });
  }

  function getOrderId() {
    if (site === "pfs") {
      const m = location.pathname.match(/\/orders\/([^\/]+)\/details/);
      return m ? m[1] : null;
    }
    if (site === "efp") {
      const m = location.pathname.match(/\/orderdetails\/(\d+)/);
      return m ? m[1] : null;
    }
    if (site === "aks") {
      const m = location.pathname.match(/\/account\/orders\/([^\/\?]+)/);
      return m ? m[1] : null;
    }
    if (site === "faire") {
      const m = location.pathname.match(/\/brand-portal\/orders\/(bo_[^\/\?]+)/);
      return m ? m[1] : null;
    }
    if (site === "mc") return "mc";
    if (site === "oc") {
      const m = location.pathname.match(/\/backoffice\/orders\/(\d+)/);
      return m ? m[1] : null;
    }
    if (site === "shopify") {
      const m = location.pathname.match(/^\/store\/[^\/]+\/orders\/(\d+)/);
      return m ? m[1] : null;
    }
    if (site === "bj" || site === "bm" || site === "issyma") {
      const m = location.pathname.match(/^\/admin\/commandes\/([^\/\?]+)/);
      return m ? m[1] : null;
    }
    return null;
  }

  function getShopifyStoreName() {
    const m = location.pathname.match(/^\/store\/([^\/]+)\/orders\/\d+/);
    return m ? m[1] : null;
  }

  function getShopifyCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    const input = document.querySelector('input[name="authenticity_token"], input[name="csrf_token"]');
    if (input && input.value) return input.value;
    return null;
  }

  function isOrderPage() {
    if (site === "pfs") return /\/orders\/[^\/]+\/details/.test(location.pathname);
    if (site === "efp") return /\/orderdetails\/\d+/.test(location.pathname);
    if (site === "aks") return /\/account\/orders\/[^\/]+/.test(location.pathname);
    if (site === "faire") return /\/brand-portal\/orders\/bo_[^\/\?]+/.test(location.pathname);
    if (site === "mc") return host === HOST_MC;
    if (site === "oc") return /^\/[a-z]{2}\/backoffice\/orders\/\d+\/?$/.test(location.pathname);
    if (site === "shopify") return /^\/store\/[^\/]+\/orders\/\d+\/?$/.test(location.pathname);
    if (site === "bj" || site === "bm" || site === "issyma") return /^\/admin\/commandes\/[^\/\?]+\/?$/.test(location.pathname);
    return false;
  }

  function ensureButton() {
    if (!isOrderPage()) {
      const existing = document.getElementById("pfs-regroup-btn");
      if (existing) existing.remove();
      return;
    }
    if (document.getElementById("pfs-regroup-btn")) return;
    if (!document.body) return;
    const btn = document.createElement("button");
    btn.id = "pfs-regroup-btn";
    btn.type = "button";
    btn.textContent = "Regrouper la facture";
    btn.addEventListener("click", onRegroupClick);
    document.body.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureButton);
  } else {
    ensureButton();
  }
  const observer = new MutationObserver(ensureButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  function isExtensionContextAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  const CONTEXT_LOST_MSG = "L'extension a été rechargée. Rechargez la page (F5) pour continuer.";

  async function onRegroupClick() {
    if (!isExtensionContextAlive()) {
      showModal({ error: CONTEXT_LOST_MSG });
      return;
    }
    if (site === "mc") {
      return onRegroupClickMc();
    }
    if (site === "oc") {
      return onRegroupClickOc();
    }
    const orderId = getOrderId();
    if (!orderId) {
      showModal({ error: "Impossible de détecter l'ID de la commande dans l'URL." });
      return;
    }
    if (site === "pfs" && !cachedToken) {
      showModal({
        error:
          "Connexion non détectée. Rechargez la page (F5) pendant que vous êtes connecté(e), puis recliquez sur le bouton."
      });
      return;
    }

    let shopifyStoreName = null;
    let shopifyCsrfToken = null;
    if (site === "shopify") {
      shopifyStoreName = getShopifyStoreName();
      shopifyCsrfToken = cachedShopifyCsrf || getShopifyCsrfToken();
      if (!shopifyCsrfToken) {
        showModal({
          error:
            "Jeton CSRF Shopify pas encore capté. Naviguez dans le menu Shopify (ou rechargez la page) puis recliquez sur le bouton."
        });
        return;
      }
    }

    showModal({ loading: true });
    try {
      let result;
      if (site === "bm") {
        result = await fetchBmFromPage(orderId);
      } else {
        result = await new Promise(function (resolve) {
          try {
            chrome.runtime.sendMessage(
              {
                type: "FETCH_ORDER",
                site: site,
                orderId: orderId,
                token: cachedToken,
                apiBase: site === "aks" || site === "bj" || site === "issyma" ? location.origin : undefined,
                storeName: shopifyStoreName,
                csrfToken: shopifyCsrfToken
              },
              function (response) {
                if (chrome.runtime.lastError) {
                  resolve({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                  resolve(response || { ok: false, error: "Pas de réponse du service worker." });
                }
              }
            );
          } catch (e) {
            resolve({ ok: false, error: CONTEXT_LOST_MSG });
          }
        });
      }
      if (!result.ok) {
        throw new Error(result.error || "Erreur inconnue");
      }
      if (site === "faire" && !cachedFaireCustomer) {
        showModal({
          loading: true,
          loadingText: "Récupération de l'adresse de livraison Faire…"
        });
        await waitForFaireCustomer(8000);
      }
      let parsed;
      if (site === "pfs") parsed = parsePfs(result.data);
      else if (site === "efp") parsed = parseEfp(result.data);
      else if (site === "aks") parsed = parseAks(result.data, orderId);
      else if (site === "shopify") parsed = parseShopify(result.data);
      else if (site === "bj" || site === "issyma") parsed = parseBj(result.data);
      else if (site === "bm") parsed = parseBm(result.data);
      else parsed = parseFaire(result.data, cachedFaireCustomer);
      showModal({ rows: parsed.rows, orderInfo: parsed.orderInfo });
    } catch (e) {
      showModal({ error: e && e.message ? e.message : String(e) });
    }
  }

  function onRegroupClickOc() {
    showModal({ loading: true });
    try {
      const parsed = parseOc();
      if (!parsed.rows.length) {
        showModal({
          error:
            "Aucun produit détecté sur la page. Attendez que la commande soit entièrement chargée, puis recliquez."
        });
        return;
      }
      showModal({ rows: parsed.rows, orderInfo: parsed.orderInfo });
    } catch (e) {
      showModal({ error: e && e.message ? e.message : String(e) });
    }
  }

  async function onRegroupClickMc() {
    if (!isExtensionContextAlive()) {
      showModal({ error: CONTEXT_LOST_MSG });
      return;
    }
    showModal({ loading: true });
    const result = await new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: "GET_MC_ORDER" }, function (response) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { ok: false, error: "Pas de réponse du service worker." });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: CONTEXT_LOST_MSG });
      }
    });
    if (!result.ok || !result.data) {
      showModal({
        error:
          "Aucune commande détectée. Cliquez d'abord sur « Détail » d'une commande dans Microstore, puis recliquez sur ce bouton."
      });
      return;
    }
    try {
      const parsed = parseMc(result.data);
      showModal({ rows: parsed.rows, orderInfo: parsed.orderInfo });
    } catch (e) {
      showModal({ error: e && e.message ? e.message : String(e) });
    }
  }

  function fetchBmFromPage(orderId) {
    return new Promise(function (resolve) {
      const requestId = "bm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
      const timer = setTimeout(function () {
        if (bmPendingFetches.has(requestId)) {
          bmPendingFetches.delete(requestId);
          resolve({
            ok: false,
            error:
              "Le script de la page n'a pas répondu. Rechargez la page (F5) puis recliquez."
          });
        }
      }, 15000);
      bmPendingFetches.set(requestId, function (result) {
        clearTimeout(timer);
        resolve(result);
      });
      window.postMessage(
        {
          source: "bm-regroup",
          type: "FETCH_ORDER",
          orderId: orderId,
          requestId: requestId
        },
        "*"
      );
    });
  }

  function pushField(fields, label, value) {
    if (value == null) return;
    const v = String(value).replace(/\s+/g, " ").trim();
    if (!v) return;
    fields.push({ label: label || null, value: v });
  }

  const CATEGORY_FAMILIES = [
    { name: "Robe", pattern: /\brobes?\b/i },
    { name: "T-shirt", pattern: /\b(?:t[\s-]?shirts?|tee[\s-]?shirts?)\b/i },
    { name: "Débardeur", pattern: /\bd[ée]bardeurs?\b/i },
    { name: "Pantalon", pattern: /\bpantalons?\b/i },
    { name: "Short", pattern: /\bshorts?\b/i },
    { name: "Top", pattern: /\btops?\b/i }
  ];

  function normalizeCategory(raw) {
    if (!raw) return "Sans catégorie";
    for (const fam of CATEGORY_FAMILIES) {
      if (fam.pattern.test(raw)) return fam.name;
    }
    return raw;
  }

  function addRow(map, cat, price, qty, meta) {
    const normalized = normalizeCategory(cat);
    const key = normalized + "||" + price.toFixed(4);
    if (!map.has(key)) {
      map.set(key, { categorie: normalized, prixUnitaire: price, quantite: 0, items: [] });
    }
    const row = map.get(key);
    row.quantite += qty;
    row.items.push({
      quantite: qty,
      ref: meta && meta.ref ? String(meta.ref).trim() : null,
      name: meta && meta.name ? String(meta.name).trim() : null,
      image: meta && meta.image ? String(meta.image) : null,
      color: meta && meta.color ? String(meta.color).trim() : null
    });
  }

  // Couleur depuis un SKU marketplace de la forme {REF}_{COULEUR}[_{TAILLE}]
  // (Ankorstore : "A1720_VERT_DEAU" → "VERT DEAU"). Pour Faire, le SKU se
  // termine par _{UNIT|PACK}_{idSuffix} : on coupe à partir de UNIT/PACK.
  function colorFromSku(sku, isFaire) {
    if (!sku) return null;
    let parts = String(sku).split("_").filter(Boolean);
    if (parts.length < 2) return null;
    parts = parts.slice(1);
    if (isFaire) {
      const upIdx = parts.findIndex(function (p) { return /^(UNIT|PACK)$/i.test(p); });
      if (upIdx >= 0) parts = parts.slice(0, upIdx);
      else if (parts.length > 1) parts = parts.slice(0, parts.length - 1);
    }
    const joined = parts.join(" ").trim();
    return joined || null;
  }

  // Premier argument non vide (pour extraire réf / nom sans connaître le
  // nom exact du champ selon la marketplace).
  function firstNonEmpty() {
    for (let i = 0; i < arguments.length; i++) {
      const v = arguments[i];
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return null;
  }

  // Première URL d'image exploitable parmi des candidats de formes variées
  // (string, tableau, objet {url|src|path|original|thumbnail}).
  function firstImageUrl() {
    for (let i = 0; i < arguments.length; i++) {
      const v = arguments[i];
      if (!v) continue;
      if (typeof v === "string") {
        if (/^https?:\/\//i.test(v)) return v;
        continue;
      }
      if (Array.isArray(v)) {
        const found = firstImageUrl(v[0]);
        if (found) return found;
        continue;
      }
      if (typeof v === "object") {
        const found = firstImageUrl(v.url, v.src, v.path, v.original, v.thumbnail, v.image);
        if (found) return found;
      }
    }
    return null;
  }

  function sortRows(map) {
    const rows = Array.from(map.values());
    rows.sort(function (a, b) {
      const c = a.categorie.localeCompare(b.categorie, "fr", { sensitivity: "base" });
      if (c !== 0) return c;
      return a.prixUnitaire - b.prixUnitaire;
    });
    return rows;
  }

  function parsePfs(json) {
    if (!json || !json.data) throw new Error("Réponse API invalide.");
    const order = json.data;
    const map = new Map();
    const brands = Array.isArray(order.items_by_brand) ? order.items_by_brand : [];
    for (const brand of brands) {
      const products = Array.isArray(brand.products) ? brand.products : [];
      for (const product of products) {
        const cat =
          (product.category && product.category.labels && product.category.labels.fr) ||
          "Sans catégorie";
        // Vérifié sur capture réelle : product.reference = référence Beli & Jolie
        // (ex "PRT-OREILLE170"), item.sku = "{REF}_{COULEUR}_{TAILLE}",
        // item.image = URL, item.name = nom produit.
        const prodRef = firstNonEmpty(product.reference);
        const items = Array.isArray(product.items) ? product.items : [];
        for (const item of items) {
          const price =
            item.price_sale && item.price_sale.unit && typeof item.price_sale.unit.value === "number"
              ? item.price_sale.unit.value
              : 0;
          const isPack = item.type === "PACK";
          const piecesPerPack = typeof item.pieces === "number" ? item.pieces : 1;
          const qtyBase =
            typeof item.qty_validated === "number"
              ? item.qty_validated
              : typeof item.qty_ordered === "number"
              ? item.qty_ordered
              : 0;
          const qty = isPack ? qtyBase * piecesPerPack : qtyBase;
          if (qty <= 0) continue;
          const pfsColorObj = item.color;
          addRow(map, cat, price, qty, {
            ref: prodRef || (item.sku ? String(item.sku).split("_")[0] : null),
            name: firstNonEmpty(item.name, prodRef),
            image: firstImageUrl(item.image),
            color: firstNonEmpty(
              pfsColorObj && typeof pfsColorObj === "object"
                ? (pfsColorObj.labels && pfsColorObj.labels.fr) || pfsColorObj.label || pfsColorObj.name
                : pfsColorObj,
              item.sku_without_ref ? String(item.sku_without_ref).split("_")[0] : null
            )
          });
        }
      }
    }
    const pfsAddresses = [];
    const c = order.customer || {};
    const b = c.billing_address || {};
    const idn = c.identification_numbers || {};
    const pfsBilling = [];
    pushField(pfsBilling, "Nom de société", c.shop);
    pushField(pfsBilling, "Nom du contact", c.name);
    pushField(pfsBilling, "Adresse", b.street);
    pushField(pfsBilling, "Code postal", b.postal_code);
    pushField(pfsBilling, "Ville", b.city);
    pushField(pfsBilling, "Pays", b.country);
    pushField(pfsBilling, "Téléphone", c.phone);
    pushField(pfsBilling, "SIRET", idn.siret);
    pushField(pfsBilling, "N° TVA", idn.vat);
    pushField(pfsBilling, "EORI", idn.eori);
    if (pfsBilling.length) pfsAddresses.push({ title: "Adresse de facturation", fields: pfsBilling });

    // TTC fourni par la plateforme : PFS expose `summary.total_incl_tax`
    // (nom explicite TVA incluse). On ne retombe PAS sur `validated_vat` /
    // `order_vat` même si c'est parfois non-null — ces champs sont des
    // montants de TVA (tax amount), pas des totaux, et varient selon le
    // régime de taxation de la commande.
    const pfsSummary = order.summary || {};
    const pfsTotalTTC =
      typeof pfsSummary.total_incl_tax === "number" && isFinite(pfsSummary.total_incl_tax)
        ? pfsSummary.total_incl_tax
        : null;

    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: order.order_no || "",
        totalTTC: pfsTotalTTC,
        addresses: pfsAddresses
      }
    };
  }

  function parseEfp(json) {
    if (!json || !json.data || !json.data.commandeById) {
      if (json && json.errors && json.errors.length) {
        throw new Error("GraphQL : " + json.errors.map(function (e) { return e.message; }).join(" | "));
      }
      throw new Error("Réponse API invalide.");
    }
    const order = json.data.commandeById;
    const map = new Map();
    const lignes = Array.isArray(order.lignes) ? order.lignes : [];
    for (const ligne of lignes) {
      if (ligne.corbeille === 1) continue;
      const cat = ligne.categorie || "Sans catégorie";
      const qty = typeof ligne.quantite_total === "number" ? ligne.quantite_total : 0;
      if (qty <= 0) continue;
      const price = ligne.prixLigne / qty;
      // Vérifié sur capture réelle : reference_base = référence Beli & Jolie
      // (ex "A1006"), reference = "A1006-ARGENT", imageUrl = URL miniature.
      addRow(map, cat, price, qty, {
        ref: firstNonEmpty(ligne.reference_base, ligne.reference),
        name: firstNonEmpty([ligne.reference, ligne.couleur_FR].filter(Boolean).join(" — ")),
        image: firstImageUrl(ligne.imageUrl),
        color: firstNonEmpty(ligne.couleur_FR)
      });
    }
    const efpAddresses = [];
    const a = order.acheteur || {};
    const f = order.adresseFacturation || {};
    const efpBilling = [];
    const efpCompany = (f.Societe || a.nomSociete || "").trim();
    pushField(efpBilling, "Nom de société", efpCompany);
    const efpName = [a.prenomContact, a.nomContact].filter(function (x) { return x && String(x).trim(); }).join(" ");
    pushField(efpBilling, "Nom du contact", efpName);
    pushField(efpBilling, "Adresse", f.adresse);
    pushField(efpBilling, "Code postal", f.codePostal);
    pushField(efpBilling, "Ville", f.ville);
    pushField(efpBilling, "Pays", f.pays && f.pays.texte_fr);
    pushField(efpBilling, "Téléphone", f.telephone || f.mobile);
    pushField(efpBilling, "Email", a.email);
    pushField(efpBilling, "N° TVA", a.tva_intra);
    pushField(efpBilling, "EORI", a.eori);
    if (efpBilling.length) efpAddresses.push({ title: "Adresse de facturation", fields: efpBilling });

    // TTC EFP : la query GraphQL ne demande actuellement que `montantApresRemise`
    // (montant HT après remise). Le champ TTC n'est pas récupéré car on n'a pas
    // encore vérifié son nom exact dans le schéma Efashion-Paris — étendre
    // EFP_QUERY avec le bon champ TTC (ex. `montantTTC`) et le remonter ici
    // dès que le schéma est confirmé.
    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: order.id_commande_name || "",
        totalTTC: null,
        addresses: efpAddresses
      }
    };
  }

  function detectCategory(name) {
    if (!name) return "Sans catégorie";
    const lower = name.toLowerCase();
    if (/boucles?\s*d['’]?\s*oreilles?/.test(lower)) {
      if (/cr[ée]ole/.test(lower)) return "Boucles d'oreilles créoles";
      return "Boucles d'oreilles";
    }
    if (/cha[îi]nes?\s+de\s+chevilles?/.test(lower)) return "Chaîne de cheville";
    if (/cha[îi]nes?\s+de\s+tailles?/.test(lower)) return "Chaîne de taille";
    if (/(?:cha[îi]nes?|bracelets?)\s+de\s+mains?/.test(lower)) return "Chaîne de main";
    if (/bracelet/.test(lower)) {
      if (/jonc/.test(lower)) return "Bracelet jonc";
      if (/charm/.test(lower)) return "Bracelet rigide à charms";
      return "Bracelet";
    }
    if (/bague/.test(lower)) {
      if (/d['’]?\s*orteil/.test(lower)) return "Bague d'orteil";
      return "Bague";
    }
    if (/porte[\s-]?cl[ée]/.test(lower)) return "Porte clé";
    if (/pendentif/.test(lower)) return "Pendentif";
    if (/\brobes?\b/.test(lower)) return "Robes";
    if (/\bensembles?\b/.test(lower)) {
      if (/\bjupes?\b/.test(lower)) return "Ensembles haut et jupe";
      if (/\bpantalons?\b/.test(lower)) return "Ensembles haut et pantalon";
      if (/\bshorts?\b/.test(lower)) return "Ensembles haut et short";
      return "Ensembles";
    }
    if (/\b(?:t[\s-]?shirts?|tee[\s-]?shirts?)\b/.test(lower)) return "T-shirts";
    if (/\bpantalons?\b/.test(lower)) return "Pantalons";
    if (/\bjupes?\b/.test(lower)) return "Jupes";
    if (/\bshorts?\b/.test(lower)) return "Shorts";
    if (/\bchemisiers?\b/.test(lower)) return "Chemisiers";
    if (/\bchemises?\b/.test(lower)) return "Chemises";
    if (/\btops?\b/.test(lower)) return "Tops";
    if (/\bblazers?\b/.test(lower)) return "Blazers";
    if (/\bvestes?\b/.test(lower)) return "Vestes";
    if (/colliers?|sautoirs?/.test(lower)) return "Collier";
    const idx = name.indexOf(" - ");
    if (idx > 0) return name.slice(0, idx).trim();
    return name;
  }

  function parseAks(payload, orderId) {
    const itemsJson = payload && payload.items ? payload.items : payload;
    const detailJson = payload && payload.detail ? payload.detail : null;
    if (!itemsJson || !Array.isArray(itemsJson.data)) throw new Error("Réponse API invalide.");
    const productsById = new Map();
    const included = Array.isArray(itemsJson.included) ? itemsJson.included : [];
    for (const inc of included) {
      if (inc.type === "ordered-products" && inc.id && inc.attributes) {
        productsById.set(inc.id, inc.attributes);
      }
    }
    const map = new Map();
    for (const item of itemsJson.data) {
      if (item.type !== "order-items" || !item.attributes) continue;
      const a = item.attributes;
      const qty = typeof a.unitQuantity === "number" ? a.unitQuantity : 0;
      if (qty <= 0) continue;
      const priceCents =
        a.unitPrice && typeof a.unitPrice.amount === "number" ? a.unitPrice.amount : 0;
      const price = priceCents / 100;
      const prodId =
        item.relationships &&
        item.relationships.orderedProduct &&
        item.relationships.orderedProduct.data &&
        item.relationships.orderedProduct.data.id;
      const prod = prodId ? productsById.get(prodId) : null;
      const name = prod && prod.name ? prod.name : "";
      const cat = detectCategory(name);
      const aksSku = prod ? firstNonEmpty(prod.sku, prod.reference, prod.variantSku, a.sku) : firstNonEmpty(a.sku);
      addRow(map, cat, price, qty, {
        ref: aksSku,
        name: name || null,
        image: prod ? firstImageUrl(prod.images, prod.image, prod.imageUrl, prod.picture) : null,
        color: colorFromSku(aksSku, false)
      });
    }

    // Diagnostic : si le produit ne porte aucune référence reconnue, afficher
    // sa structure en console pour identifier le bon champ.
    try {
      const sample = productsById.values().next().value;
      if (sample && !firstNonEmpty(sample.sku, sample.reference, sample.variantSku)) {
        console.log("[Regroupement][AKS] Référence introuvable — attributs du 1er produit :", sample);
      }
    } catch (e) { /* noop */ }

    const aksAddresses = [];
    let orderNo = "";
    // Ankorstore expose les totaux sur `data.attributes.*` en **centimes**
    // ({ amount, currency }). Candidats défensifs car on n'a pas de capture
    // live : `totalIncludingTaxes`, `totalInclTax`, `grandTotal`, `total`.
    // Si aucun ne matche, totalTTC reste null (affiché « — » dans le modal).
    let aksTotalTTC = null;
    if (detailJson && detailJson.data && detailJson.data.attributes) {
      const attr = detailJson.data.attributes;
      if (attr.reference) orderNo = String(attr.reference);
      const ttcCandidates = [
        attr.totalIncludingTaxes,
        attr.totalInclTax,
        attr.grandTotal,
        attr.total
      ];
      for (const c of ttcCandidates) {
        if (c && typeof c === "object" && typeof c.amount === "number") {
          aksTotalTTC = c.amount / 100;
          break;
        }
      }
      const ship = attr.shipping && attr.shipping.shippingAddress;
      if (ship) {
        const addr = ship.address || {};
        const cp = ship.contactPerson || {};
        const shipFields = [];
        pushField(shipFields, "Nom de société", ship.company);
        const fullName = cp.fullName || [cp.firstName, cp.lastName].filter(function (x) { return x && String(x).trim(); }).join(" ");
        if (fullName && fullName !== ship.company) pushField(shipFields, "Nom du contact", fullName);
        pushField(shipFields, "Adresse", addr.addressLine);
        pushField(shipFields, "Code postal", addr.postalCode);
        pushField(shipFields, "Ville", addr.city);
        pushField(shipFields, "Pays", addr.countryCode);
        pushField(shipFields, "Téléphone", cp.phoneNumber);
        pushField(shipFields, "Email", cp.email);
        const retailer = attr.retailer || {};
        const biz = retailer.business || {};
        pushField(shipFields, "N° TVA", biz.vat_number);
        pushField(shipFields, "SIRET", biz.tax_number);
        if (shipFields.length) aksAddresses.push({ title: "Adresse de livraison", fields: shipFields });
      }
    }
    if (!orderNo) {
      orderNo = orderId && orderId.length > 8 ? orderId.slice(0, 8) + "…" : orderId || "";
    }
    return {
      rows: sortRows(map),
      orderInfo: { orderNo: orderNo, totalTTC: aksTotalTTC, addresses: aksAddresses }
    };
  }

  function parseMc(json) {
    if (!json || !json.data || !json.data.doc_info) {
      throw new Error("Réponse API invalide.");
    }
    const doc = json.data.doc_info;
    const items = Array.isArray(doc.goods_info) ? doc.goods_info : [];
    const map = new Map();
    for (const item of items) {
      if (item.disable === "1") continue;
      if (item.status === "0") continue;
      const qty = parseInt(item.quantity, 10) || 0;
      if (qty <= 0) continue;
      const price = parseFloat(item.price) || 0;
      const cat = detectCategory(item.name);
      // Vérifié sur capture réelle : item_ref = référence Beli & Jolie
      // (ex "A2678"), img = URL, imgs = tableau d'URLs, name = nom produit.
      addRow(map, cat, price, qty, {
        ref: firstNonEmpty(item.item_ref, item.item_ref_search_code),
        name: item.name || null,
        image: firstImageUrl(item.img, item.imgs, item.image, item.pic),
        color: firstNonEmpty(item.pure_color_name, item.color_name)
      });
    }
    // Microstore : `doc.total_price` est le total affiché côté vendeur,
    // en pratique TVA incluse (= TTC) sur les commandes passées par les
    // retailers européens. Candidats défensifs si le champ principal manque.
    let mcTotalTTC = null;
    const mcCandidates = [doc.total_price, doc.total_amount, doc.pay_price];
    for (const c of mcCandidates) {
      const v = parseFloat(c);
      if (isFinite(v) && v > 0) { mcTotalTTC = v; break; }
    }

    const addresses = [];
    const ci = doc.client_info || {};
    const shipFields = [];
    const mcCompany = (ci.company_name || "").trim();
    const mcFullName = [ci.first_name, ci.last_name].filter(function (x) { return x && String(x).trim(); }).join(" ").trim();
    pushField(shipFields, "Nom de société", mcCompany);
    if (mcFullName && mcFullName !== mcCompany) pushField(shipFields, "Nom du contact", mcFullName);
    pushField(shipFields, "Adresse", ci.address);
    pushField(shipFields, "Code postal", ci.zip);
    pushField(shipFields, "Ville", ci.city);
    pushField(shipFields, "Pays", ci.country);
    pushField(shipFields, "Téléphone", ci.address_phone || ci.phone);
    pushField(shipFields, "Email", ci.email);
    pushField(shipFields, "N° TVA", ci.vat_num);
    if (shipFields.length) addresses.push({ title: "Adresse de livraison", fields: shipFields });
    addresses.push({ title: "Adresse de facturation", fields: [{ label: null, value: "Voir l'iPad" }] });

    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: doc.number || doc.id || "",
        totalTTC: mcTotalTTC,
        addresses: addresses
      }
    };
  }

  function normalizeFaireCategory(cat) {
    if (!cat) return cat;
    const lower = cat.toLowerCase();
    if (/boucles?\s*d['’]?\s*oreilles?|cr[ée]oles?|clous?\s*d['’]?\s*oreilles?/.test(lower)) return "Boucles d'oreilles";
    if (/bracelets?/.test(lower)) return "Bracelet";
    if (/parures?/.test(lower)) return "Parure de bijoux";
    if (/colliers?|sautoirs?/.test(lower)) return "Collier";
    if (/bagues?|anneaux?|solitaires?/.test(lower)) return "Bague";
    return cat;
  }

  // Retrouve la UGS Faire complète : "{ref}_{couleur}[_{taille}]_{UNIT|PACK}_{idSuffix}".
  // Vérifié en live sur la capture d'une commande Faire : la UGS est exposée sur
  // `item.brand_code` (et dupliquée dans `item.brand_codes[0]` +
  // `item.product_option_brand_code`), jamais sur `item.sku` (qui n'existe pas).
  // Fallbacks défensifs pour d'éventuelles anciennes réponses.
  function findFaireSku(item, prod) {
    let s = firstNonEmpty(
      item.brand_code,
      Array.isArray(item.brand_codes) ? item.brand_codes[0] : null,
      item.product_option_brand_code,
      item.sku, item.brand_sku, item.maker_sku, item.variant_sku
    );
    if (s) return s;
    if (prod && item.product_option_token) {
      const optArrays = [
        Array.isArray(prod.options) ? prod.options : null,
        Array.isArray(prod.variants) ? prod.variants : null,
        Array.isArray(prod.product_options) ? prod.product_options : null
      ];
      for (const opts of optArrays) {
        if (!opts) continue;
        for (const opt of opts) {
          if (!opt) continue;
          if (opt.token === item.product_option_token || opt.id === item.product_option_token) {
            s = firstNonEmpty(opt.brand_code, opt.sku, opt.brand_sku);
            if (s) return s;
          }
        }
      }
    }
    if (prod) {
      s = firstNonEmpty(prod.brand_code, prod.sku, prod.brand_sku);
      if (s) return s;
    }
    return null;
  }

  function parseFaire(json, customerData) {
    if (!json || !Array.isArray(json.items)) throw new Error("Réponse API invalide.");
    const products = json.products && typeof json.products === "object" ? json.products : {};
    const map = new Map();
    let faireFirstItemLogged = false;
    for (const item of json.items) {
      if (item.is_sample === true) continue;
      if (item.includes_tester === true) continue;
      if (item.state === "CANCELED") continue;
      if (item.order_item_type && item.order_item_type !== "PRODUCT") continue;
      const priceCents =
        item.wholesale_price && typeof item.wholesale_price.amount_cents === "number"
          ? item.wholesale_price.amount_cents
          : 0;
      const price = priceCents / 100;
      const multiplier =
        typeof item.unit_multiplier === "number" && item.unit_multiplier > 0
          ? item.unit_multiplier
          : 1;
      const baseQty = typeof item.item_quantity === "number" ? item.item_quantity : 0;
      const qty = baseQty * multiplier;
      if (qty <= 0) continue;
      const prod = item.product_token ? products[item.product_token] : null;
      const groupName =
        prod && prod.taxonomy_type && prod.taxonomy_type.group_name
          ? String(prod.taxonomy_type.group_name).trim()
          : "";
      const rawCat = groupName || detectCategory(item.product_name);
      const cat = normalizeFaireCategory(rawCat);
      const faireSku = findFaireSku(item, prod);
      if (!faireFirstItemLogged) {
        faireFirstItemLogged = true;
        try {
          console.log(
            "[Regroupement][Faire] 1er item — UGS résolue :", faireSku,
            "\n  item :", item,
            "\n  produit lié :", prod
          );
        } catch (e) { /* noop */ }
      }
      // UGS Faire = "{ref}_{couleur}[_{taille}]_{UNIT|PACK}_{idSuffix}" ; on
      // garde la référence nue (avant le premier « _ »), en majuscules, pour
      // matcher celle de la boutique BJ ("A2425") — sinon le lookup échoue
      // et la Description RTF affiche la UGS brute.
      const faireRef = faireSku ? String(faireSku).split("_")[0].toUpperCase() : null;
      // Couleur : `item.style_name` est déjà formaté (« Doré ») ; on ne
      // retombe sur le parsing de la UGS que si le champ est absent.
      const faireColor = firstNonEmpty(item.style_name, colorFromSku(faireSku, true));
      addRow(map, cat, price, qty, {
        ref: faireRef,
        name: item.product_name || null,
        image: firstImageUrl(item.image, prod && prod.images, prod && prod.image_url, item.image_url),
        color: faireColor
      });
    }
    const token =
      json.brand_order && json.brand_order.token ? json.brand_order.token : "";
    const orderNo = token.replace(/^bo_/, "").toUpperCase();
    // Faire B2B : la plateforme facture en HT (le retailer est redevable
    // de la TVA à l'import / en auto-liquidation). Candidats défensifs
    // au cas où une commande ferait apparaître un `total_incl_tax` /
    // `total_amount` TTC — sinon `totalTTC` reste null.
    let faireTotalTTC = null;
    const faireCandidates = [
      json.total_incl_tax,
      json.order_total,
      json.total_amount,
      json.brand_order && json.brand_order.total_amount
    ];
    for (const c of faireCandidates) {
      if (c && typeof c === "object" && typeof c.amount_cents === "number") {
        faireTotalTTC = c.amount_cents / 100;
        break;
      }
      if (typeof c === "number" && isFinite(c)) { faireTotalTTC = c; break; }
    }

    const faireAddresses = [];
    function faireAddrToFields(addr, storeName, contactName) {
      if (!addr || typeof addr !== "object") return null;
      const fields = [];
      pushField(fields, "Nom de société", storeName);
      const displayName = addr.name || contactName || "";
      if (displayName && displayName !== storeName) pushField(fields, "Nom du contact", displayName);
      pushField(fields, "Adresse", addr.address1);
      if (addr.address2) pushField(fields, "Complément", addr.address2);
      pushField(fields, "Code postal", addr.postal_code);
      pushField(fields, "Ville", addr.city);
      pushField(fields, "Pays", addr.country || addr.iso3_country_code || addr.country_code);
      pushField(fields, "Téléphone", addr.phone_number || addr.phone);
      pushField(fields, "Email", addr.email);
      return fields.length ? fields : null;
    }
    // Bloc facturation Faire : la réponse `customer-details` (vérifiée live)
    // ne contient PAS de `retailer_details.address` séparée — l'adresse
    // légale du détaillant est en pratique la même que `default_shipping_address`.
    // On construit donc le bloc à partir de l'adresse d'expédition, complété
    // par les infos entreprise disponibles au niveau `retailer_details` /
    // `brand_customer_view` (nom société, contact, téléphone). SIRET / TVA /
    // EORI ne sont PAS exposés par cet endpoint — champs candidats laissés
    // à titre défensif au cas où l'API les ajouterait plus tard.
    function faireBillingFields(rd, bcv, shipping, storeName, contactName) {
      if (!rd && !bcv) return null;
      const rdAddr = (rd && rd.address) || {};
      const shipAddr = shipping || {};
      const pick = function () {
        for (let i = 0; i < arguments.length; i++) {
          const v = arguments[i];
          if (v == null) continue;
          const s = String(v).trim();
          if (s) return s;
        }
        return null;
      };
      const fields = [];
      const legalName = pick(
        rd && rd.business_name, rd && rd.legal_business_name,
        rd && rd.legal_entity_name, rd && rd.company_name, rd && rd.name,
        bcv && bcv.legal_business_name, bcv && bcv.business_name, storeName
      );
      pushField(fields, "Nom de société", legalName);
      const displayName = pick(rdAddr.name, shipAddr.name, contactName, rd && rd.contact_name);
      if (displayName && displayName !== legalName) {
        pushField(fields, "Nom du contact", displayName);
      }
      pushField(fields, "Adresse", pick(rdAddr.address1, shipAddr.address1));
      const complement = pick(rdAddr.address2, shipAddr.address2);
      if (complement) pushField(fields, "Complément", complement);
      pushField(fields, "Code postal", pick(rdAddr.postal_code, shipAddr.postal_code));
      pushField(fields, "Ville", pick(rdAddr.city, shipAddr.city, rd && rd.city));
      pushField(fields, "Pays", pick(
        rdAddr.country, rdAddr.iso3_country_code, rdAddr.country_code,
        shipAddr.country, shipAddr.iso3_country_code, shipAddr.country_code
      ));
      pushField(fields, "Téléphone", pick(
        rd && rd.phone_number, rd && rd.phone,
        rdAddr.phone_number, rdAddr.phone,
        shipAddr.phone_number, shipAddr.phone,
        bcv && bcv.phone_number, bcv && bcv.phone
      ));
      pushField(fields, "Email", pick(
        rd && rd.email, rd && rd.contact_email, rdAddr.email,
        shipAddr.email, bcv && bcv.email
      ));
      pushField(fields, "SIRET", pick(
        rd && rd.siret, rd && rd.siret_number, rd && rd.registration_number,
        rd && rd.business_registration_number, rd && rd.company_registration_number
      ));
      pushField(fields, "N° TVA", pick(
        rd && rd.vat_number, rd && rd.eu_vat_number, rd && rd.tax_registration_number,
        rd && rd.tax_id_number, rd && rd.tax_number, rd && rd.tax_id
      ));
      return fields.length ? fields : null;
    }
    if (customerData) {
      try {
        console.log(
          "[Regroupement][Faire] customerData interceptée — clés racine :",
          Object.keys(customerData || {}),
          "\n  payload complet :", customerData
        );
      } catch (e) { /* noop */ }
      const bcv = customerData.brand_customer_view || {};
      const storeName = bcv.store_name || "";
      const contactName = bcv.contact_name || "";
      // Faire a déjà renommé cette route une fois (31/08/2026). La forme du
      // payload peut dériver : on cherche l'adresse d'expédition à plusieurs
      // emplacements plausibles avant d'abandonner.
      const rdRaw = customerData.retailer_details || {};
      const shipping =
        customerData.default_shipping_address
        || customerData.shipping_address
        || customerData.shippingAddress
        || rdRaw.default_shipping_address
        || rdRaw.shipping_address
        || rdRaw.address
        || null;
      const shipFields = faireAddrToFields(shipping, storeName, contactName);
      if (shipFields) {
        faireAddresses.push({ title: "Adresse de livraison", fields: shipFields });
      } else {
        try {
          console.warn(
            "[Regroupement][Faire] Aucune adresse de livraison trouvée dans customerData — la forme du payload a probablement changé. Clés disponibles :",
            Object.keys(customerData || {}),
            "retailer_details :", rdRaw
          );
        } catch (e) { /* noop */ }
      }
      const billFields = faireBillingFields(rdRaw, bcv, shipping, storeName, contactName);
      if (billFields) faireAddresses.push({ title: "Adresse de facturation", fields: billFields });
    } else {
      console.log("[Faire] Aucune donnée customer interceptée (timeout 8 s). Rechargez la page de la commande pour que la requête soit captée.");
    }

    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: orderNo,
        totalTTC: faireTotalTTC,
        addresses: faireAddresses
      }
    };
  }

  function parseShopify(json) {
    if (json && json.errors && json.errors.length) {
      throw new Error("GraphQL : " + json.errors.map(function (e) { return e.message; }).join(" | "));
    }
    if (!json || !json.data || !json.data.order) throw new Error("Réponse API invalide.");
    const order = json.data.order;
    const map = new Map();
    const edges =
      order.lineItems && Array.isArray(order.lineItems.edges) ? order.lineItems.edges : [];
    for (const edge of edges) {
      const node = edge && edge.node;
      if (!node) continue;
      const qty =
        typeof node.currentQuantity === "number"
          ? node.currentQuantity
          : typeof node.quantity === "number"
          ? node.quantity
          : 0;
      if (qty <= 0) continue;
      const money =
        node.originalUnitPriceSet && node.originalUnitPriceSet.shopMoney
          ? node.originalUnitPriceSet.shopMoney
          : null;
      const price = money ? parseFloat(money.amount) || 0 : 0;
      const cat = detectCategory(node.title);
      addRow(map, cat, price, qty, {
        ref: firstNonEmpty(node.sku),
        name: node.title || null,
        image: firstImageUrl(node.image),
        color: firstNonEmpty(node.variantTitle)
      });
    }

    function shopifyAddrToFields(addr) {
      if (!addr || typeof addr !== "object") return null;
      const fields = [];
      pushField(fields, "Nom de société", addr.company);
      const fullName =
        addr.name ||
        [addr.firstName, addr.lastName].filter(function (x) { return x && String(x).trim(); }).join(" ");
      if (fullName && fullName !== addr.company) pushField(fields, "Nom du contact", fullName);
      pushField(fields, "Adresse", addr.address1);
      if (addr.address2) pushField(fields, "Complément", addr.address2);
      pushField(fields, "Code postal", addr.zip);
      pushField(fields, "Ville", addr.city);
      pushField(fields, "Pays", addr.country || addr.countryCodeV2);
      pushField(fields, "Téléphone", addr.phone);
      return fields.length ? fields : null;
    }

    const addresses = [];
    const shipFields = shopifyAddrToFields(order.shippingAddress);
    if (shipFields) addresses.push({ title: "Adresse de livraison", fields: shipFields });
    if (order.billingAddressMatchesShippingAddress && shipFields) {
      addresses.push({
        title: "Adresse de facturation",
        fields: [{ label: null, value: "Identique à l'adresse de livraison" }]
      });
    } else {
      const billFields = shopifyAddrToFields(order.billingAddress);
      if (billFields) addresses.push({ title: "Adresse de facturation", fields: billFields });
    }

    // Shopify : `totalPriceSet` = total TTC (TVA, livraison, remises inclus) ;
    // `currentTotalPriceSet` = total post-refund (plus pertinent quand des
    // lignes ont été remboursées — on le préfère si disponible).
    function shopifyMoney(set) {
      if (!set || !set.shopMoney || set.shopMoney.amount == null) return null;
      const v = parseFloat(set.shopMoney.amount);
      return isFinite(v) ? v : null;
    }
    const shopifyCurrent = shopifyMoney(order.currentTotalPriceSet);
    const shopifyTotalTTC = shopifyCurrent != null ? shopifyCurrent : shopifyMoney(order.totalPriceSet);

    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: order.name || "",
        totalTTC: shopifyTotalTTC,
        addresses: addresses
      }
    };
  }

  // L'API /regroup ne dit pas si une ligne est un PACK. Mais la page admin
  // affiche la composition dans la colonne « Taille » : « Pack × N », ou
  // « TU × N », ou « S × 2 · M × 3 · L × 1 » (multi-tailles, sommées). On
  // scanne les <tr>, on additionne les nombres après chaque « × » de la
  // cellule taille (en excluant la cellule qtyTotal qui contient « 12 (3×4) »),
  // et on matche par (qty, prix) avec les items de l'API.
  function extractBjPackQtyFromCell(text) {
    if (!text) return 0;
    // Cellule prix ou totaux HT/TTC → contient €.
    if (text.indexOf("€") !== -1) return 0;
    // Cellule qtyTotal → un chiffre est collé avant le « × » (ex : « (3×4) »).
    if (/\d\s*×/.test(text)) return 0;
    const matches = text.match(/×\s*(\d+)/g);
    if (!matches) return 0;
    let total = 0;
    for (const chunk of matches) {
      const n = chunk.match(/(\d+)/);
      if (n) total += parseInt(n[1], 10);
    }
    return total;
  }

  function readBjPackInfoFromDom() {
    const infos = [];
    const tds = document.querySelectorAll("td");
    for (const td of tds) {
      const packQty = extractBjPackQtyFromCell(td.textContent || "");
      if (packQty < 2) continue;
      const row = td.closest("tr");
      if (!row) continue;
      const rowTds = Array.from(row.children).filter(function (el) {
        return el.tagName === "TD";
      });
      const idx = rowTds.indexOf(td);
      if (idx < 0) continue;
      // Après la cellule taille : qty (idx+1), qtyTotal (idx+2), prix unitaire (idx+3).
      const qtyCell = rowTds[idx + 1];
      const priceCell = rowTds[idx + 3];
      if (!qtyCell || !priceCell) continue;
      // En cas de modif, la cellule affiche « ancien → nouveau ». On prend le dernier.
      const qtyNums = (qtyCell.textContent || "").match(/\d+/g);
      if (!qtyNums) continue;
      const qty = parseInt(qtyNums[qtyNums.length - 1], 10);
      const euroMatches = Array.from(
        (priceCell.textContent || "").matchAll(/(\d[\d\s.,]*)\s*€/g)
      );
      if (!euroMatches.length) continue;
      const lastEuro = euroMatches[euroMatches.length - 1][1];
      const price = parseEuroAmount(lastEuro + " €");
      if (!qty || price == null) continue;
      infos.push({ qty: qty, price: price, packQty: packQty, used: false });
    }
    try {
      console.log("[Regroupement] Beli & Jolie — PACK détectés dans le DOM :", infos);
    } catch (e) { /* noop */ }
    return infos;
  }

  function findBjPackMatch(packInfos, qty, price) {
    for (const info of packInfos) {
      if (info.used) continue;
      if (info.qty !== qty) continue;
      if (Math.abs(info.price - price) > 0.01) continue;
      info.used = true;
      return info.packQty;
    }
    return null;
  }

  function parseBj(json) {
    if (!json || !Array.isArray(json.items)) throw new Error("Réponse API invalide.");
    const packInfos = readBjPackInfoFromDom();
    const map = new Map();
    for (const it of json.items) {
      const qtyRaw = typeof it.quantite === "number" ? it.quantite : parseInt(it.quantite, 10);
      const priceRaw = typeof it.prixUnitaire === "number" ? it.prixUnitaire : parseFloat(it.prixUnitaire);
      if (!qtyRaw || qtyRaw <= 0 || !isFinite(priceRaw)) continue;
      const packQty = findBjPackMatch(packInfos, qtyRaw, priceRaw);
      const qty = packQty ? qtyRaw * packQty : qtyRaw;
      const price = packQty ? priceRaw / packQty : priceRaw;
      // Réf / couleur / nom / image lus défensivement : l'endpoint /regroup
      // doit exposer ces champs pour permettre l'export Sage 50 (réf en gras
      // + détail des couleurs dans la Description RTF).
      addRow(map, it.categorie || "Sans catégorie", price, qty, {
        ref: firstNonEmpty(it.reference, it.ref, it.productRef),
        name: firstNonEmpty(it.name, it.productName, it.designation),
        image: firstImageUrl(it.image, it.imageUrl, it.thumbnail),
        color: firstNonEmpty(it.color, it.colorName, it.couleur, it.couleurNom)
      });
    }

    function bjAddrToFields(addr, kind) {
      if (!addr || typeof addr !== "object") return null;
      const fields = [];
      pushField(fields, "Nom de société", addr.company);
      const fullName = [addr.firstName, addr.lastName]
        .filter(function (x) { return x && String(x).trim(); })
        .join(" ");
      if (fullName && fullName !== addr.company) pushField(fields, "Nom du contact", fullName);
      pushField(fields, "Adresse", addr.address1);
      if (addr.address2) pushField(fields, "Complément", addr.address2);
      pushField(fields, "Code postal", addr.zipCode);
      pushField(fields, "Ville", addr.city);
      pushField(fields, "Pays", addr.country);
      pushField(fields, "Téléphone", addr.phone);
      pushField(fields, "Email", addr.email);
      if (kind === "billing") pushField(fields, "SIRET", addr.siret);
      pushField(fields, "N° TVA", addr.vatNumber);
      return fields.length ? fields : null;
    }

    const addresses = [];
    const shipFields = bjAddrToFields(json.shipping, "shipping");
    if (shipFields) addresses.push({ title: "Adresse de livraison", fields: shipFields });
    const billFields = bjAddrToFields(json.billing, "billing");
    if (billFields) addresses.push({ title: "Adresse de facturation", fields: billFields });

    // Beli & Jolie / Issyma : l'endpoint `/api/admin/commandes/{id}/regroup`
    // n'expose actuellement que `subtotalHT`. Pour afficher le TTC confirmé
    // par la plateforme, étendre la route (app/api/admin/commandes/[id]/regroup/route.ts)
    // pour renvoyer `totalTTC` (ou `totalTTC` + `tva`), puis le mapper ici.
    const bjTotalTTC =
      typeof json.totalTTC === "number" && isFinite(json.totalTTC)
        ? json.totalTTC
        : null;

    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: json.orderNo || "",
        totalTTC: bjTotalTTC,
        addresses: addresses
      }
    };
  }

  function parseBm(json) {
    if (!json || !json.data) throw new Error("Réponse API invalide.");
    const order = json.data;
    const items = Array.isArray(order.items) ? order.items : [];
    const map = new Map();
    for (const it of items) {
      const qty = typeof it.quantity === "number" ? it.quantity : parseInt(it.quantity, 10);
      const price = typeof it.unitPrice === "number" ? it.unitPrice : parseFloat(it.unitPrice);
      if (!qty || qty <= 0 || !isFinite(price)) continue;
      const cat = it.categoryName || detectCategory(it.name) || "Sans catégorie";
      addRow(map, cat, price, qty, {
        ref: firstNonEmpty(it.reference, it.sku, it.ref, it.productRef),
        name: it.name || null,
        image: firstImageUrl(it.image, it.imageUrl, it.imagePath),
        color: firstNonEmpty(it.colorName, it.color)
      });
    }

    const customer = order.customer || {};
    function bmAddrToFields(addr) {
      if (!addr || typeof addr !== "object") return null;
      const fields = [];
      const company = customer.companyName || addr.label;
      pushField(fields, "Nom de société", company);
      const contactName = customer.contactName || "";
      if (contactName && contactName !== company) {
        pushField(fields, "Nom du contact", contactName);
      }
      pushField(fields, "Adresse", addr.street);
      pushField(fields, "Code postal", addr.zip);
      pushField(fields, "Ville", addr.city);
      pushField(fields, "Pays", addr.country);
      pushField(fields, "Téléphone", addr.phone || customer.phone);
      pushField(fields, "Email", customer.email);
      pushField(fields, "SIRET", customer.siret);
      pushField(fields, "N° TVA", customer.vatNumber);
      return fields.length ? fields : null;
    }

    const addresses = [];
    const shipFields = bmAddrToFields(order.shippingAddress);
    if (shipFields) addresses.push({ title: "Adresse de livraison", fields: shipFields });

    const ship = order.shippingAddress || {};
    const bill = order.billingAddress || {};
    const sameAddress =
      shipFields &&
      ship.street === bill.street &&
      ship.zip === bill.zip &&
      ship.city === bill.city &&
      ship.country === bill.country;
    if (sameAddress) {
      addresses.push({
        title: "Adresse de facturation",
        fields: [{ label: null, value: "Identique à l'adresse de livraison" }]
      });
    } else {
      const billFields = bmAddrToFields(order.billingAddress);
      if (billFields) addresses.push({ title: "Adresse de facturation", fields: billFields });
    }

    // Bijoux Mystères : l'endpoint expose `totalHT` et `totalTTC` séparément.
    const bmTotalTTC =
      typeof order.totalTTC === "number" && isFinite(order.totalTTC)
        ? order.totalTTC
        : null;

    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: order.orderNumber || "",
        totalTTC: bmTotalTTC,
        addresses: addresses
      }
    };
  }

  function parseEuroAmount(text) {
    if (!text) return null;
    const m = text.match(/([\d\s.,]+)\s*€/);
    if (!m) return null;
    const cleaned = m[1]
      .replace(/\s/g, "")
      .replace(/\.(?=\d{3}(?:[.,]|$))/g, "")
      .replace(",", ".");
    const val = parseFloat(cleaned);
    return isFinite(val) ? val : null;
  }

  function parseOc() {
    let orderNo = "";
    const titleMatch = document.title.match(/OC\d+/i);
    if (titleMatch) orderNo = titleMatch[0].toUpperCase();
    if (!orderNo) {
      const h1 = document.querySelector("h1");
      if (h1) {
        const m = h1.textContent.match(/OC\d+/i);
        if (m) orderNo = m[0].toUpperCase();
      }
    }

    const map = new Map();
    const seenRows = new Set();

    let links = document.querySelectorAll(
      'a[href*="/backoffice/products/"]'
    );
    console.log("[OC] liens /backoffice/products/ trouvés :", links.length);

    for (const link of links) {
      const tr = link.closest("tr");
      if (!tr || seenRows.has(tr)) continue;
      const tds = tr.children;
      if (tds.length < 4) continue;
      let qtyPriceText = "";
      let name = "";
      for (const td of tds) {
        const t = td.textContent || "";
        if (/\d+\s*x\s*[\d\s.,]+\s*€/.test(t)) {
          qtyPriceText = t;
          break;
        }
      }
      if (!qtyPriceText) continue;
      name = (link.textContent || "").replace(/\s+/g, " ").trim();
      if (!name) continue;
      const m = qtyPriceText.match(/(\d+)\s*x\s*([\d\s.,]+)\s*€/);
      if (!m) continue;
      const qty = parseInt(m[1], 10);
      const price = parseEuroAmount(m[2] + " €");
      if (!qty || price == null) continue;
      seenRows.add(tr);
      const cat = detectCategory(name);
      const rowImg = tr.querySelector("img");
      const skuMatch = (tr.textContent || "").match(/SKU\s*:?\s*([A-Za-z0-9][\w-]*)/i);
      addRow(map, cat, price, qty, {
        ref: skuMatch ? skuMatch[1] : null,
        name: name,
        image: rowImg && /^https?:\/\//i.test(rowImg.src || "") ? rowImg.src : null
      });
    }

    console.log("[OC] lignes regroupées :", map.size, "numéro :", orderNo);

    // Orderchamp affiche en bas de la commande les lignes « Sous-total »,
    // « Frais de port », « Taxes » et « Total ». La ligne « Total » est la
    // valeur TVA incluse facturée au retailer (= TTC). On priorise un libellé
    // explicitement TTC s'il existe (« Total TTC », « Total incl. VAT »…) et
    // on retombe sur le simple « Total » sinon.
    let ocTotalTTC = null;
    const totalTrs = document.querySelectorAll("table tr");
    for (const tr of totalTrs) {
      const tds = tr.children;
      if (tds.length !== 2) continue;
      const label = (tds[0].textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (/^total\s+ttc$/i.test(label) || /^total\s+incl/i.test(label)) {
        const val = parseEuroAmount(tds[1].textContent);
        if (val != null) { ocTotalTTC = val; break; }
      }
    }
    if (ocTotalTTC == null) {
      for (const tr of totalTrs) {
        const tds = tr.children;
        if (tds.length !== 2) continue;
        const label = (tds[0].textContent || "").replace(/\s+/g, " ").trim();
        if (label === "Total") {
          const val = parseEuroAmount(tds[1].textContent);
          if (val != null) { ocTotalTTC = val; break; }
        }
      }
    }

    const ocAddresses = parseOcAddresses();

    return {
      rows: sortRows(map),
      orderInfo: { orderNo: orderNo, totalTTC: ocTotalTTC, addresses: ocAddresses }
    };
  }

  function parseOcAddresses() {
    const addresses = [];
    const strongs = document.querySelectorAll("strong");
    for (const strong of strongs) {
      const title = (strong.textContent || "").replace(/\s+/g, " ").trim();
      if (title !== "Adresse de livraison" && title !== "Adresse de facturation") continue;
      const lines = [];
      let buf = "";
      let n = strong.nextSibling;
      while (n) {
        if (n.nodeType === 1) {
          const tag = n.tagName;
          if (tag === "HR" || tag === "STRONG") break;
          if (tag === "BR") {
            if (buf.trim()) lines.push(buf.replace(/\s+/g, " ").trim());
            buf = "";
          } else {
            buf += n.textContent || "";
          }
        } else if (n.nodeType === 3) {
          buf += n.textContent;
        }
        n = n.nextSibling;
      }
      if (buf.trim()) lines.push(buf.replace(/\s+/g, " ").trim());
      const cleaned = lines.filter(function (l) { return l && l.length; });
      if (cleaned.length) addresses.push({ title: title, fields: ocLinesToFields(cleaned) });
    }
    return addresses;
  }

  function ocLinesToFields(lines) {
    const fields = [];
    const nonSpecial = [];
    let vat = "";
    let registration = "";
    for (const line of lines) {
      let m;
      if ((m = line.match(/^Num[ée]ro\s+de\s+TVA\s*[:\-]?\s*(.+)$/i))) {
        vat = m[1].trim();
      } else if ((m = line.match(/^Num[ée]ro\s+d['’]enregistrement\s*[:\-]?\s*(.+)$/i))) {
        registration = m[1].trim();
      } else {
        nonSpecial.push(line);
      }
    }
    const cpRegex = /^(\d{2,6}[A-Za-z]{0,3})\s+(.+)$/;
    let cpIdx = -1;
    for (let i = 0; i < nonSpecial.length; i++) {
      if (cpRegex.test(nonSpecial[i])) { cpIdx = i; break; }
    }
    let company = "", contactName = "", address1 = "", postalCode = "", city = "", country = "";
    if (cpIdx >= 0) {
      const m = nonSpecial[cpIdx].match(cpRegex);
      postalCode = m[1];
      city = m[2].trim();
      if (cpIdx + 1 < nonSpecial.length) country = nonSpecial[cpIdx + 1];
      const before = nonSpecial.slice(0, cpIdx);
      if (before.length === 1) {
        company = before[0];
      } else if (before.length === 2) {
        company = before[0];
        address1 = before[1];
      } else if (before.length >= 3) {
        company = before[0];
        contactName = before[1];
        address1 = before.slice(2).join(", ");
      }
    }
    pushField(fields, "Nom de société", company);
    pushField(fields, "Nom du contact", contactName);
    pushField(fields, "Adresse", address1);
    pushField(fields, "Code postal", postalCode);
    pushField(fields, "Ville", city);
    pushField(fields, "Pays", country);
    pushField(fields, "N° TVA", vat);
    pushField(fields, "N° d'enregistrement", registration);
    if (!fields.length) {
      for (const l of nonSpecial) fields.push({ label: null, value: l });
    }
    return fields;
  }

  function fmtEuro(n) {
    return n.toFixed(2).replace(".", ",") + " €";
  }

  // Pour afficher le TTC, on ne calcule JAMAIS côté client (certaines commandes
  // sont exonérées, soumises à auto-liquidation, à un taux réduit, etc.) : on
  // affiche uniquement la valeur renvoyée par la plateforme (`orderInfo.totalTTC`)
  // et on tombe sur « — » si l'API ne l'expose pas.

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function buildCopyIcon() {
    const svg = svgEl("svg", {
      width: "14", height: "14", viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", "stroke-width": "2",
      "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true"
    });
    svg.appendChild(svgEl("rect", { x: "9", y: "9", width: "13", height: "13", rx: "2", ry: "2" }));
    svg.appendChild(svgEl("path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }));
    return svg;
  }

  function buildCheckIcon() {
    const svg = svgEl("svg", {
      width: "14", height: "14", viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", "stroke-width": "2.5",
      "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true"
    });
    svg.appendChild(svgEl("polyline", { points: "20 6 9 17 4 12" }));
    return svg;
  }

  function replaceIcon(btn, iconNode) {
    while (btn.firstChild) btn.removeChild(btn.firstChild);
    btn.appendChild(iconNode);
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function flashCopyOk(btn) {
    btn.classList.add("pfs-copy-ok");
    replaceIcon(btn, buildCheckIcon());
    btn.setAttribute("aria-label", "Copié");
    btn.title = "Copié !";
    clearTimeout(btn._pfsTimer);
    btn._pfsTimer = setTimeout(function () {
      btn.classList.remove("pfs-copy-ok");
      replaceIcon(btn, buildCopyIcon());
      btn.setAttribute("aria-label", "Copier");
      btn.title = "Copier";
    }, 1200);
  }

  function makeCopyButton(value) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pfs-copy-btn";
    btn.title = "Copier";
    btn.setAttribute("aria-label", "Copier");
    btn.appendChild(buildCopyIcon());
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(function () {
          flashCopyOk(btn);
        }).catch(function () {
          if (fallbackCopy(value)) flashCopyOk(btn);
        });
      } else {
        if (fallbackCopy(value)) flashCopyOk(btn);
      }
    });
    return btn;
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === "className") node.className = props[k];
        else if (k === "text") node.textContent = props[k];
        else if (k === "onClick") node.addEventListener("click", props[k]);
        else node.setAttribute(k, props[k]);
      }
    }
    if (children) {
      for (const c of children) {
        if (c == null) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  let _originalRows = [];
  let _currentOrderInfo = null;
  let _secretClickCount = 0;

  function getSecretFactor(clicks) {
    if (clicks < 3) return 1;
    return 2 + Math.floor((clicks - 3) / 2);
  }

  function onSecretImgClick() {
    if (!_originalRows.length) return;
    _secretClickCount++;
    renderRowsTable();
  }

  function ensureOverlay() {
    let overlay = document.getElementById("pfs-modal-overlay");
    if (overlay) return overlay;

    overlay = el("div", { id: "pfs-modal-overlay" });
    const modal = el("div", { id: "pfs-modal", role: "dialog", "aria-modal": "true" });

    const header = el("div", { id: "pfs-modal-header" }, [
      el("h2", { text: "Regroupement par catégorie et prix" }),
      el("button", {
        id: "pfs-modal-close",
        type: "button",
        "aria-label": "Fermer",
        text: "×",
        onClick: hideModal
      })
    ]);

    const body = el("div", { id: "pfs-modal-body" });

    const imgNames = ["z.png", "img1.png", "img2.png", "img3.png", "img4.png", "img5.png", "img6.png"];
    for (let i = imgNames.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = imgNames[i]; imgNames[i] = imgNames[j]; imgNames[j] = tmp;
    }
    const imgStrip = el("div", { id: "pfs-img-strip" });
    for (const name of imgNames) {
      const img = el("img", {
        className: "pfs-mini-img",
        src: chrome.runtime.getURL(name),
        alt: "",
        "aria-hidden": "true",
        draggable: "false"
      });
      if (name === "z.png") {
        img.id = "pfs-secret-img";
        img.addEventListener("click", onSecretImgClick);
      }
      imgStrip.appendChild(img);
    }

    const footer = el("div", { id: "pfs-modal-footer" }, [
      imgStrip,
      el("button", { id: "pfs-ee-btn", type: "button", text: "Bordereau Easy-Express", onClick: function () { openEasyExpressFromOrder(); } }),
      el("button", { id: "pfs-sage-btn", type: "button", text: "Exporter CSV Sage", onClick: exportToSageCsv }),
      el("button", { id: "pfs-pdf-btn", type: "button", text: "Exporter en PDF", onClick: exportToPdf }),
      el("button", { id: "pfs-close-btn", type: "button", text: "Fermer", onClick: hideModal })
    ]);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) hideModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") hideModal();
    });
    return overlay;
  }

  function buildRowsTable(rows, orderInfo) {
    const totalQty = rows.reduce(function (s, r) { return s + r.quantite; }, 0);
    const totalHT = rows.reduce(function (s, r) { return s + r.quantite * r.prixUnitaire; }, 0);
    const platformTTC =
      orderInfo && typeof orderInfo.totalTTC === "number" && isFinite(orderInfo.totalTTC)
        ? orderInfo.totalTTC
        : null;

    const table = el("table", { id: "pfs-table" });
    const thead = el("thead", null, [
      el("tr", null, [
        el("th", { text: "Catégorie" }),
        el("th", { className: "r", text: "Quantité" }),
        el("th", { text: "Prix unitaire" }),
        el("th", { className: "r", text: "Sous-total HT" })
      ])
    ]);
    table.appendChild(thead);

    const tbody = el("tbody");
    let prevCat = null;
    let groupIdx = -1;
    for (const r of rows) {
      if (r.categorie !== prevCat) {
        groupIdx++;
        prevCat = r.categorie;
      }
      const catCell = el("td");
      catCell.appendChild(el("strong", { text: r.categorie }));
      const tr = el("tr", { className: groupIdx % 2 === 0 ? "pfs-cat-a" : "pfs-cat-b" }, [
        catCell,
        el("td", { className: "r", text: String(r.quantite) }),
        el("td", { text: fmtEuro(r.prixUnitaire) }),
        el("td", { className: "r", text: fmtEuro(r.prixUnitaire * r.quantite) })
      ]);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    const tfootRows = [
      el("tr", { className: "pfs-total-ht" }, [
        (function () {
          const td = el("td");
          td.appendChild(el("strong", { text: "Total HT" }));
          return td;
        })(),
        (function () {
          const td = el("td", { className: "r" });
          td.appendChild(el("strong", { text: String(totalQty) }));
          return td;
        })(),
        el("td"),
        (function () {
          const td = el("td", { className: "r" });
          td.appendChild(el("strong", { text: fmtEuro(totalHT) }));
          return td;
        })()
      ])
    ];
    // Ligne TTC affichée uniquement si la plateforme nous donne le montant —
    // sinon on reste muet (pas de « — » bruité sur les marketplaces qui
    // n'exposent pas le TTC via API).
    if (platformTTC != null) {
      const ttcCell = el("td", { className: "r" });
      ttcCell.appendChild(el("strong", { text: fmtEuro(platformTTC) }));
      tfootRows.push(
        el("tr", { className: "pfs-total-ttc" }, [
          (function () {
            const td = el("td");
            td.appendChild(el("strong", { text: "Total TTC (plateforme)" }));
            return td;
          })(),
          el("td"),
          el("td"),
          ttcCell
        ])
      );
    }
    const tfoot = el("tfoot", null, tfootRows);
    table.appendChild(tfoot);
    return table;
  }

  function renderRowsTable() {
    const body = document.getElementById("pfs-modal-body");
    if (!body) return;
    const factor = getSecretFactor(_secretClickCount);
    const rows = _originalRows.map(function (r) {
      return {
        categorie: r.categorie,
        prixUnitaire: r.prixUnitaire / factor,
        quantite: r.quantite * factor
      };
    });
    const oldTable = document.getElementById("pfs-table");
    const table = buildRowsTable(rows, _currentOrderInfo);
    if (oldTable && oldTable.parentNode) {
      oldTable.parentNode.replaceChild(table, oldTable);
    } else {
      body.appendChild(table);
    }
  }

  function showModal(state) {
    const overlay = ensureOverlay();
    overlay.style.display = "flex";

    const body = document.getElementById("pfs-modal-body");
    const footer = document.getElementById("pfs-modal-footer");
    while (body.firstChild) body.removeChild(body.firstChild);

    _originalRows = [];
    _currentOrderInfo = null;
    _secretClickCount = 0;
    const pdfBtn = document.getElementById("pfs-pdf-btn");
    const sageBtn = document.getElementById("pfs-sage-btn");
    const eeBtn = document.getElementById("pfs-ee-btn");

    if (state.loading) {
      body.appendChild(el("p", { className: "pfs-info", text: state.loadingText || "Chargement de la commande…" }));
      footer.style.display = "none";
      return;
    }
    if (state.error) {
      body.appendChild(el("p", { className: "pfs-error", text: state.error }));
      footer.style.display = "flex";
      if (pdfBtn) pdfBtn.style.display = "none";
      if (sageBtn) sageBtn.style.display = "none";
      if (eeBtn) eeBtn.style.display = "none";
      return;
    }
    if (pdfBtn) pdfBtn.style.display = "";
    if (sageBtn) sageBtn.style.display = "";
    // Easy-Express : visible seulement si on a au moins une adresse à proposer.
    const hasAddress = Array.isArray(state.orderInfo && state.orderInfo.addresses)
      && state.orderInfo.addresses.some(function (a) { return a && Array.isArray(a.fields) && a.fields.length; });
    if (eeBtn) eeBtn.style.display = hasAddress ? "" : "none";

    const rows = state.rows || [];
    const orderInfo = state.orderInfo || {};

    const info = el("p", { className: "pfs-order-info" });
    info.appendChild(document.createTextNode("Commande "));
    info.appendChild(el("strong", { text: orderInfo.orderNo || "" }));
    info.appendChild(
      document.createTextNode(
        " — " +
        rows.length +
        " ligne" + (rows.length > 1 ? "s" : "") +
        " regroupée" + (rows.length > 1 ? "s" : "")
      )
    );
    body.appendChild(info);

    const addresses = Array.isArray(orderInfo.addresses) ? orderInfo.addresses : [];
    if (addresses.length) {
      const wrap = el("div", { className: "pfs-addresses" });
      for (const addr of addresses) {
        const block = el("div", { className: "pfs-address-block" });
        block.appendChild(el("h3", { text: addr.title || "" }));
        const dl = el("dl", { className: "pfs-address-fields" });
        const fields = addr.fields || [];
        if (!fields.length) {
          dl.appendChild(el("dd", { className: "pfs-address-empty", text: "—" }));
        } else {
          for (const f of fields) {
            const row = el("div", { className: "pfs-address-row" });
            if (f.label) {
              // Toutes les infos entreprise (société, contact, adresse, CP,
              // ville, pays, téléphone, email, SIRET, TVA…) sont affichées et
              // copiées en majuscules — demande explicite pour préparer des
              // étiquettes / factures homogènes quel que soit le marketplace.
              const upper = String(f.value || "").toLocaleUpperCase("fr-FR");
              row.appendChild(el("dt", { text: f.label + " :" }));
              row.appendChild(el("dd", { text: upper }));
              row.appendChild(makeCopyButton(upper));
            } else {
              row.appendChild(el("dd", { className: "pfs-address-note", text: f.value }));
            }
            dl.appendChild(row);
          }
        }
        block.appendChild(dl);
        wrap.appendChild(block);
      }
      body.appendChild(wrap);
    }

    body.appendChild(buildVerifEntrepriseSection(orderInfo));

    _originalRows = rows.slice();
    _currentOrderInfo = orderInfo;
    _secretClickCount = 0;
    body.appendChild(buildRowsTable(rows, orderInfo));

    footer.style.display = "flex";
  }

  function hideModal() {
    const overlay = document.getElementById("pfs-modal-overlay");
    if (overlay) overlay.style.display = "none";
  }

  // ─── Easy-Express : pré-remplissage depuis l'adresse de livraison ────
  // La commande expose orderInfo.addresses = [{ title, fields: [{label, value}] }].
  // On cherche d'abord un bloc "livraison", à défaut on retombe sur le premier bloc
  // (certains marketplaces — PFS, EFP — n'exposent que la facturation).
  function eeFieldByLabel(fields, patterns) {
    for (const f of fields || []) {
      if (!f || !f.label) continue;
      const label = String(f.label).toLowerCase();
      for (const p of patterns) {
        if (label.indexOf(p) !== -1) return (f.value == null ? "" : String(f.value).trim());
      }
    }
    return "";
  }

  function eeSplitContact(contact) {
    const parts = String(contact || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { firstName: "", lastName: "" };
    if (parts.length === 1) return { firstName: "", lastName: parts[0] };
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  }

  function eeExtractReceiverFromOrder(orderInfo) {
    const addresses = (orderInfo && orderInfo.addresses) || [];
    const livraison = addresses.find(function (a) { return a && /livraison/i.test(a.title || ""); });
    const addr = livraison || addresses[0];
    if (!addr) return null;
    const fields = addr.fields || [];

    const company = eeFieldByLabel(fields, ["société", "societe", "shop", "boutique"]);
    const contact = eeFieldByLabel(fields, ["contact", "nom du contact"]);
    const names = eeSplitContact(contact);

    return {
      firstName: names.firstName,
      lastName: names.lastName,
      company: company,
      street: eeFieldByLabel(fields, ["adresse", "rue"]),
      complement: eeFieldByLabel(fields, ["complément", "complement"]),
      postalCode: eeFieldByLabel(fields, ["code postal", "cp"]),
      city: eeFieldByLabel(fields, ["ville"]),
      country: eeFieldByLabel(fields, ["pays"]) || "France",
      phone: eeFieldByLabel(fields, ["téléphone", "telephone", "tél", "tel"]),
      email: eeFieldByLabel(fields, ["email", "e-mail", "courriel"]),
      sourceTitle: addr.title || ""
    };
  }

  function openEasyExpressFromOrder() {
    if (!isExtensionContextAlive()) { alert(CONTEXT_LOST_MSG); return; }
    const orderInfo = _currentOrderInfo || {};
    const receiver = eeExtractReceiverFromOrder(orderInfo);
    if (!receiver) {
      alert("Aucune adresse de livraison détectée sur cette commande.");
      return;
    }
    const payload = {
      receiver: receiver,
      orderNo: orderInfo.orderNo || "",
      source: "order"
    };
    try {
      chrome.runtime.sendMessage({ type: "OPEN_EE_FROM_ORDER", payload: payload }, function (res) {
        if (chrome.runtime.lastError) {
          alert("Impossible d'ouvrir le bordereau : " + chrome.runtime.lastError.message);
          return;
        }
        if (!res || !res.ok) {
          alert("Erreur : " + ((res && res.error) || "impossible d'ouvrir la fenêtre."));
        }
      });
    } catch (e) {
      alert(CONTEXT_LOST_MSG);
    }
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildPrintHtml(rows, info) {
    const totalQty = rows.reduce(function (s, r) { return s + r.quantite; }, 0);
    const totalHT = rows.reduce(function (s, r) { return s + r.quantite * r.prixUnitaire; }, 0);
    const platformTTC =
      info && typeof info.totalTTC === "number" && isFinite(info.totalTTC)
        ? info.totalTTC
        : null;
    const ttcRowHtml = platformTTC != null
      ? '<tr class="total-ttc">'
        + '<td><strong>Total TTC (plateforme)</strong></td>'
        + '<td></td>'
        + '<td></td>'
        + '<td class="r"><strong>' + escapeHtml(fmtEuro(platformTTC)) + '</strong></td>'
        + '</tr>'
      : '';

    let addressesHtml = "";
    const addresses = Array.isArray(info.addresses) ? info.addresses : [];
    if (addresses.length) {
      addressesHtml += '<div class="addresses">';
      for (const addr of addresses) {
        addressesHtml += '<div class="address-block">';
        addressesHtml += '<h3>' + escapeHtml(addr.title || "") + '</h3>';
        const fields = addr.fields || [];
        if (fields.length) {
          addressesHtml += '<dl>';
          for (const f of fields) {
            if (f.label) {
              addressesHtml += '<div class="row"><dt>' + escapeHtml(f.label) + ' :</dt><dd>' + escapeHtml(f.value) + '</dd></div>';
            } else {
              addressesHtml += '<div class="row"><dd class="note">' + escapeHtml(f.value) + '</dd></div>';
            }
          }
          addressesHtml += '</dl>';
        }
        addressesHtml += '</div>';
      }
      addressesHtml += '</div>';
    }

    let rowsHtml = "";
    let prevCat = null;
    let groupIdx = -1;
    for (const r of rows) {
      if (r.categorie !== prevCat) {
        groupIdx++;
        prevCat = r.categorie;
      }
      const cls = groupIdx % 2 === 0 ? "cat-a" : "cat-b";
      rowsHtml += '<tr class="' + cls + '">';
      rowsHtml += '<td><strong>' + escapeHtml(r.categorie) + '</strong></td>';
      rowsHtml += '<td class="r">' + r.quantite + '</td>';
      rowsHtml += '<td>' + escapeHtml(fmtEuro(r.prixUnitaire)) + '</td>';
      rowsHtml += '<td class="r">' + escapeHtml(fmtEuro(r.prixUnitaire * r.quantite)) + '</td>';
      rowsHtml += '</tr>';
    }

    const nbLines = rows.length;
    const orderNo = info.orderNo || "";
    const title = "Regroupement facture " + orderNo;

    return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title><style>'
      + '@page { size: A4; margin: 15mm; }'
      + '* { box-sizing: border-box; }'
      + 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; padding: 0; font-size: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }'
      + 'h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: -0.01em; }'
      + '.subtitle { color: #5b6470; margin: 0 0 20px; font-size: 12px; }'
      + '.addresses { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }'
      + '.address-block { background: #fafbfc; border: 1px solid #eceef1; border-radius: 8px; padding: 10px 14px; page-break-inside: avoid; }'
      + '.address-block h3 { margin: 0 0 8px; padding-bottom: 6px; border-bottom: 1px solid #eceef1; font-size: 10px; font-weight: 700; color: #5b6470; text-transform: uppercase; letter-spacing: 0.08em; }'
      + '.address-block dl { margin: 0; padding: 0; font-size: 11.5px; line-height: 1.45; }'
      + '.row { display: flex; gap: 6px; padding: 2px 0; }'
      + '.row dt { margin: 0; font-weight: 600; color: #4b5563; flex: 0 0 110px; }'
      + '.row dd { margin: 0; color: #111; word-break: break-word; }'
      + '.note { font-style: italic; color: #6b7280; }'
      + 'table { width: 100%; border-collapse: collapse; font-size: 12px; }'
      + 'thead { display: table-header-group; }'
      + 'tr { page-break-inside: avoid; }'
      + 'th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #f3f4f6; }'
      + 'th { font-weight: 600; color: #5b6470; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; background: #fafbfc; border-bottom: 1px solid #eceef1; }'
      + 'th.r, td.r { text-align: right; font-variant-numeric: tabular-nums; }'
      + 'tr.cat-a td { background: #ffffff; }'
      + 'tr.cat-b td { background: #f3f4f6; }'
      + 'tfoot td { border-top: none; border-bottom: none; padding-top: 6px; padding-bottom: 6px; font-weight: 700; background: #ffffff; font-size: 13px; }'
      + 'tfoot tr.total-ht td { border-top: 2px solid #111; padding-top: 10px; }'
      + 'tfoot tr.total-ttc td { padding-bottom: 10px; color: #5b6470; }'
      + '.ttc-missing { color: #9ca3af; font-weight: 500; }'
      + '</style></head><body>'
      + '<h1>Regroupement facture — ' + escapeHtml(orderNo) + '</h1>'
      + '<p class="subtitle">' + nbLines + ' ligne' + (nbLines > 1 ? 's' : '') + ' regroupée' + (nbLines > 1 ? 's' : '') + '</p>'
      + addressesHtml
      + '<table><thead><tr>'
      + '<th>Catégorie</th><th class="r">Quantité</th><th>Prix unitaire</th><th class="r">Sous-total HT</th>'
      + '</tr></thead><tbody>' + rowsHtml + '</tbody>'
      + '<tfoot><tr class="total-ht">'
      + '<td><strong>Total HT</strong></td>'
      + '<td class="r"><strong>' + totalQty + '</strong></td>'
      + '<td></td>'
      + '<td class="r"><strong>' + escapeHtml(fmtEuro(totalHT)) + '</strong></td>'
      + '</tr>'
      + ttcRowHtml
      + '</tfoot></table></body></html>';
  }

  // ---- Export CSV Sage 50 ----
  // Format = celui de l'import paramétrable « Import des pièces » du dossier
  // Sage de l'utilisateur : 9 colonnes séparées par « ; », décimale virgule,
  // date JJ/MM/AAAA, 1 ligne de titres à ignorer. Une ligne E (en-tête,
  // client SAGE_CLIENT_CODE par défaut, N° de pièce vide = numérotation auto)
  // puis une ligne L par ligne regroupée du modal.
  const SAGE_CLIENT_CODE = "003";
  const SAGE_TVA_RATE = "20,00";

  // Les 19 articles du dossier Sage (liste déroulante de l'écran d'attribution).
  const SAGE_ARTICLES = [
    { code: "ART0001", label: "Collier" },
    { code: "ART0002", label: "Bracelet" },
    { code: "ART0003", label: "Boucles d'oreilles" },
    { code: "ART0004", label: "Bague" },
    { code: "ART0005", label: "Parure de bijoux" },
    { code: "ART0006", label: "Chaîne de cheville" },
    { code: "ART0007", label: "Lot de colliers" },
    { code: "ART0008", label: "Lot de bracelets" },
    { code: "ART0009", label: "Lot de boucles d'oreilles" },
    { code: "ART0010", label: "Lot de bagues" },
    { code: "ART0011", label: "Lot de parures de bijoux" },
    { code: "ART0012", label: "Lot de chaînes de cheville" },
    { code: "ART0013", label: "Présentoir" },
    { code: "ART0014", label: "Pendentif" },
    { code: "ART0015", label: "Lot de bagues et de bracelet" },
    { code: "ART0016", label: "Jonc" },
    { code: "ART0017", label: "Sac" },
    { code: "ART0018", label: "Broche" },
    { code: "ART0019", label: "Piercing" }
  ];

  // Libellé (catégorie marketplace, catégorie Beli & Jolie, ou nom de produit
  // en repli) → code article Sage, en 5 temps :
  //   1. lots explicites (« Lot de 16 boucles d'oreilles… ») → article LOT ;
  //   2. présentoir GARNI (« Présentoir de 16 boucles d'oreilles ») → article
  //      LOT du bijou concerné (décision Boris, 27/08/2026) ;
  //   3. « lot » sans contenu identifiable (« Lots avec présentoir » chez PFS)
  //      → "" : résolution par référence via l'API, puis écran manuel — ne
  //      JAMAIS retomber sur un article à l'unité ni sur ART0013 ;
  //   4. présentoir seul (vide) → ART0013 ;
  //   5. articles à l'unité (jonc avant bracelet, chaîne de cheville avant
  //      bracelet).
  const SAGE_LOT_RULES = [
    { code: "ART0015", pattern: /lots?\s+de\s+(?:\d+\s+)?bagues?\s+et\s+(?:de\s+)?bracelets?/i },
    { code: "ART0007", pattern: /lots?\s+de\s+(?:\d+\s+)?colliers?/i },
    { code: "ART0008", pattern: /lots?\s+de\s+(?:\d+\s+)?bracelets?/i },
    { code: "ART0009", pattern: /lots?\s+de\s+(?:\d+\s+)?(?:paires?\s+de\s+)?boucles?/i },
    { code: "ART0010", pattern: /lots?\s+de\s+(?:\d+\s+)?bagues?/i },
    { code: "ART0011", pattern: /lots?\s+de\s+(?:\d+\s+)?parures?/i },
    { code: "ART0012", pattern: /lots?\s+de\s+(?:\d+\s+)?cha[îi]nes?\s+de\s+chevilles?/i }
  ];
  const SAGE_LOT_BY_TYPE = [
    { code: "ART0009", pattern: /boucles?/i },
    { code: "ART0012", pattern: /cha[îi]nes?\s+de\s+chevilles?/i },
    { code: "ART0008", pattern: /bracelets?|joncs?/i },
    { code: "ART0015", pattern: /bagues?\s+et\s+bracelets?/i },
    { code: "ART0010", pattern: /bagues?/i },
    { code: "ART0011", pattern: /parures?/i },
    { code: "ART0007", pattern: /colliers?|sautoirs?/i }
  ];
  const SAGE_UNIT_RULES = [
    { code: "ART0003", pattern: /boucles?\s*d['’]?\s*oreilles?|cr[ée]oles?|clous?\s*d['’]?\s*oreilles?/i },
    { code: "ART0006", pattern: /cha[îi]nes?\s+de\s+chevilles?/i },
    { code: "ART0016", pattern: /joncs?/i },
    { code: "ART0002", pattern: /bracelets?|cha[îi]nes?\s+de\s+mains?/i },
    { code: "ART0004", pattern: /bagues?|anneaux?|solitaires?/i },
    { code: "ART0005", pattern: /parures?/i },
    { code: "ART0014", pattern: /pendentifs?/i },
    { code: "ART0001", pattern: /colliers?|sautoirs?/i },
    // Un pochon est facturé comme un sac (même code Sage ART0017) — mais la
    // Description RTF affichera « POCHON » car on privilégie la catégorie
    // réelle du produit sur le libellé Sage (cf. buildSageCsvFromItems).
    { code: "ART0017", pattern: /\bpochons?\b/i },
    { code: "ART0017", pattern: /\bsacs?\b/i },
    { code: "ART0018", pattern: /broches?/i },
    { code: "ART0019", pattern: /piercings?/i }
  ];

  // Sage lit le CSV en ANSI (Windows-1252) : un Blob JS encode en UTF-8, ce
  // qui casse les accents (« DORÃ‰ »). On encode donc les octets nous-mêmes.
  const CP1252_EXTRA = {
    8364: 128, 8218: 130, 402: 131, 8222: 132, 8230: 133, 8224: 134,
    8225: 135, 710: 136, 8240: 137, 352: 138, 8249: 139, 338: 140,
    381: 142, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149,
    8211: 150, 8212: 151, 732: 152, 8482: 153, 353: 154, 8250: 155,
    339: 156, 382: 158, 376: 159
  };

  function encodeCp1252(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      out[i] = c <= 0xff ? c : (CP1252_EXTRA[c] || 63); // 63 = "?"
    }
    return out;
  }

  // Texte → RTF : le champ description de Sage interprète le RTF à l'import
  // (vérifié le 27/08/2026 : gras et \line rendus, HTML non). Échappe \ { }
  // et code les accents en \'xx (octet Windows-1252).
  function rtfEscape(s) {
    let out = "";
    const str = String(s == null ? "" : s);
    for (let i = 0; i < str.length; i++) {
      const ch = str.charAt(i);
      const c = str.charCodeAt(i);
      if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
      else if (c > 127) {
        const b = c <= 0xff ? c : (CP1252_EXTRA[c] || 63);
        out += "\\'" + b.toString(16);
      } else out += ch;
    }
    return out;
  }

  // Couleur affichée en français, Capitalisée (« DORÉ » → « Doré »,
  // « vert-deau » → « Vert deau », « Golden » → « Doré »).
  const SAGE_COLOR_FR = {
    golden: "Doré", gold: "Doré", silver: "Argenté", red: "Rouge",
    blue: "Bleu", green: "Vert", black: "Noir", white: "Blanc",
    pink: "Rose", purple: "Violet", yellow: "Jaune", orange: "Orange",
    brown: "Marron", grey: "Gris", gray: "Gris", beige: "Beige",
    ivory: "Ivoire", turquoise: "Turquoise", champagne: "Champagne",
    multicolor: "Multicolore", multicolore: "Multicolore",
    "rose gold": "Or rose", "rose-gold": "Or rose"
  };

  function formatColorFr(raw) {
    if (!raw) return null;
    const cleaned = String(raw).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) return null;
    const lower = cleaned.toLowerCase();
    if (SAGE_COLOR_FR[lower]) return SAGE_COLOR_FR[lower];
    const firstWord = lower.split(" ")[0];
    if (SAGE_COLOR_FR[firstWord]) {
      const rest = lower.slice(firstWord.length).trim();
      return rest ? SAGE_COLOR_FR[firstWord] + " " + rest : SAGE_COLOR_FR[firstWord];
    }
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  // Champ CSV : guillemets obligatoires si le texte contient le séparateur,
  // un guillemet ou un retour à la ligne (délimiteur de texte « " » à
  // déclarer dans le format d'import Sage).
  function csvField(v) {
    const s = String(v == null ? "" : v);
    if (/[";\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // Libellé (désignation) d'un article Sage — colonne Description du CSV,
  // mappée sur la rubrique « Lg Description » du format d'import.
  function sageArticleLabel(code) {
    if (!code) return "";
    for (const a of SAGE_ARTICLES) {
      if (a.code === code) return a.label;
    }
    return "";
  }

  function sageArticleForCategory(cat) {
    if (!cat) return "";
    for (const rule of SAGE_LOT_RULES) {
      if (rule.pattern.test(cat)) return rule.code;
    }
    const hasDisplay = /pr[ée]sentoirs?|supports?/i.test(cat);
    if (hasDisplay) {
      for (const rule of SAGE_LOT_BY_TYPE) {
        if (rule.pattern.test(cat)) return rule.code;
      }
    }
    if (/lots?\b/i.test(cat)) return "";
    if (hasDisplay) return "ART0013";
    for (const rule of SAGE_UNIT_RULES) {
      if (rule.pattern.test(cat)) return rule.code;
    }
    return "";
  }

  function fmtSageDate(d) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return dd + "/" + mm + "/" + d.getFullYear();
  }

  function fmtSagePrice(n) {
    return n.toFixed(2).replace(".", ",");
  }

  // Clé de mémorisation d'un choix manuel : site + référence (ou nom, ou
  // catégorie) — le même produit ne sera demandé qu'une seule fois.
  function sageStorageKey(item) {
    return site + "|" + (item.ref || item.name || item.categorie || "?");
  }

  function sageLoadManualMap() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get("sageManualMap", function (r) {
          resolve((r && r.sageManualMap) || {});
        });
      } catch (e) {
        resolve({});
      }
    });
  }

  function sageSaveManualMap(map) {
    try {
      chrome.storage.local.set({ sageManualMap: map });
    } catch (e) { /* noop */ }
  }

  // Interroge l'API publique Beli & Jolie (via le service worker) pour
  // retrouver la catégorie boutique de chaque référence marketplace.
  function sageLookupRefs(refs) {
    return new Promise(function (resolve) {
      if (!refs.length) return resolve({});
      try {
        chrome.runtime.sendMessage({ type: "SAGE_LOOKUP_REFS", refs: refs }, function (resp) {
          if (chrome.runtime.lastError || !resp || !resp.ok) resolve({});
          else resolve(resp.data || {});
        });
      } catch (e) {
        resolve({});
      }
    });
  }

  function buildSageCsvFromItems(items) {
    // Une ligne par (article Sage, prix, référence produit), avec le détail
    // des couleurs commandées dans la description et la quantité totale.
    // Ex : "Lot de boucles d'oreilles - PRT-OREILLE170 - ROUGE x3 - BLEU x8",
    // Qté = 11.
    const agg = new Map();
    const missing = [];
    for (const it of items) {
      const code = it.code || "";
      const refKey = it.ref || it.name || "";
      const key = code + "||" + it.prixUnitaire.toFixed(4) + "||" + refKey;
      if (!agg.has(key)) {
        agg.set(key, {
          code: code,
          prixUnitaire: it.prixUnitaire,
          quantite: 0,
          ref: it.ref || null,
          // Libellé de la Description RTF : on privilégie la catégorie réelle
          // du produit (boutique BJ d'abord, sinon marketplace) sur le label
          // officiel de l'article Sage. Sans ça un « Pochon » facturé sur
          // ART0017 s'afficherait « SAC » (le label Sage), pas « POCHON ».
          descLabel: firstNonEmpty(it.bjCategory, it.categorie, sageArticleLabel(code)),
          colors: new Map()
        });
      }
      const g = agg.get(key);
      g.quantite += it.quantite;
      const colorFr = formatColorFr(it.color);
      if (colorFr) {
        g.colors.set(colorFr, (g.colors.get(colorFr) || 0) + it.quantite);
      }
      if (!code) {
        const label = it.name || it.bjCategory || it.categorie || "Produit inconnu";
        if (missing.indexOf(label) === -1) missing.push(label);
      }
    }
    const list = Array.from(agg.values());
    list.sort(function (a, b) {
      if (a.code !== b.code) return a.code < b.code ? -1 : 1;
      if ((a.ref || "") !== (b.ref || "")) return (a.ref || "") < (b.ref || "") ? -1 : 1;
      return a.prixUnitaire - b.prixUnitaire;
    });
    const lines = ["TypeLigne;TypePiece;NumPiece;DatePiece;CodeClient;CodeArticle;Quantite;PUHT;TauxTVA;Description"];
    lines.push(["E", "Facture", "", fmtSageDate(new Date()), SAGE_CLIENT_CODE, "", "", "", "", ""].join(";"));
    for (const l of list) {
      // Description en RTF, sur UNE ligne du fichier (l'import Sage lit ligne
      // à ligne — un vrai retour à la ligne casse l'import, mais le champ
      // interprète le RTF) : « LIBELLÉ EN MAJUSCULES - <réf en gras> », puis
      // \line par couleur (« Doré x1 »).
      const label = l.descLabel || sageArticleLabel(l.code);
      let head = label ? rtfEscape(label.toUpperCase()) : "";
      if (l.ref) head += (head ? " - " : "") + "\\b " + rtfEscape(l.ref) + "\\b0";
      let body = "";
      for (const entry of l.colors.entries()) {
        body += "\\line " + rtfEscape(entry[0] + " x" + entry[1]);
      }
      const desc = head || body
        ? ("{\\rtf1\\ansi\\deff0 " + head + body + "}").replace(/;/g, ",")
        : "";
      lines.push(["L", "", "", "", "", l.code, String(l.quantite), fmtSagePrice(l.prixUnitaire), SAGE_TVA_RATE, csvField(desc)].join(";"));
    }
    return { csv: lines.join("\r\n") + "\r\n", missing: missing };
  }

  function downloadSageCsv(csv) {
    const orderNo =
      String((_currentOrderInfo && _currentOrderInfo.orderNo) || "commande").replace(/[^\w.-]+/g, "_") ||
      "commande";
    const blob = new Blob([encodeCp1252(csv)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sage_facture_" + orderNo + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function finishSageExport(items) {
    const built = buildSageCsvFromItems(items);
    downloadSageCsv(built.csv);
    const body = document.getElementById("pfs-modal-body");
    const oldWarn = document.getElementById("pfs-sage-warn");
    if (oldWarn) oldWarn.remove();
    if (built.missing.length && body) {
      body.appendChild(
        el("p", {
          id: "pfs-sage-warn",
          className: "pfs-warn",
          text:
            "CSV exporté, mais sans code article Sage pour : " +
            built.missing.join(", ") +
            ". Complétez la colonne CodeArticle de ces lignes dans Excel avant l'import."
        })
      );
      body.scrollTop = body.scrollHeight;
    }
  }

  async function exportToSageCsv() {
    if (!_originalRows.length || !_currentOrderInfo) return;
    const btn = document.getElementById("pfs-sage-btn");
    const factor = getSecretFactor(_secretClickCount);

    // Une entrée par produit (pas par ligne regroupée) : deux produits
    // fusionnés dans la même ligne du tableau peuvent avoir des catégories
    // Beli & Jolie différentes.
    const items = [];
    for (const r of _originalRows) {
      const metas = r.items && r.items.length ? r.items : [{ quantite: r.quantite, ref: null, name: null, image: null }];
      for (const m of metas) {
        items.push({
          categorie: r.categorie,
          prixUnitaire: r.prixUnitaire / factor,
          quantite: m.quantite * factor,
          ref: m.ref,
          name: m.name,
          image: m.image,
          color: m.color,
          code: ""
        });
      }
    }

    if (btn) { btn.disabled = true; btn.textContent = "Recherche des catégories…"; }
    let unresolved;
    try {
      // 1. Source de vérité : la boutique Beli & Jolie, interrogée par
      // référence pour TOUT produit qui en a une (la catégorie marketplace
      // n'est jamais prioritaire sur la catégorie boutique).
      // Issyma est un autre tenant sur la même app : l'API publique BJ ne
      // contient pas ses produits (404) et une collision de référence donnerait
      // une fausse catégorie — donc on saute le lookup pour ce site.
      const refs = [];
      if (site !== "issyma") {
        for (const it of items) {
          if (it.ref && refs.indexOf(it.ref) === -1) refs.push(it.ref);
        }
      }
      const found = refs.length ? await sageLookupRefs(refs) : {};
      for (const it of items) {
        const info = it.ref ? found[it.ref] : null;
        if (info) {
          if (info.category) {
            it.bjCategory = info.category;
            it.code = sageArticleForCategory(info.category);
          }
          if (info.name) {
            const codeFromName = sageArticleForCategory(info.name);
            if (!it.code) {
              it.code = codeFromName;
            } else if (it.code === "ART0013" && codeFromName && codeFromName !== "ART0013") {
              // Catégorie boutique « Présentoirs » mais nom « Lot de 16
              // boucles d'oreilles… » : présentoir garni → lot du bijou.
              it.code = codeFromName;
            } else if (it.code === "ART0002" && codeFromName === "ART0016") {
              // Catégorie boutique « Bracelet » mais nom « Bracelet jonc… » :
              // le jonc a son propre article Sage (ART0016).
              it.code = codeFromName;
              it.bjCategory = "Bracelet jonc";
            }
          }
          if (!it.image && info.image) it.image = info.image;
          if (!it.name && info.name) it.name = info.name;
        }
        // 2. Repli local (référence absente ou introuvable sur la boutique) :
        // catégorie marketplace, puis nom du produit.
        if (!it.code) it.code = sageArticleForCategory(it.categorie);
        if (!it.code && it.name) it.code = sageArticleForCategory(it.name);
        // Même exception jonc qu'au niveau boutique : les catégories
        // marketplace génériques (« Bracelet » via normalizeFaireCategory)
        // masquent le jonc, dont l'article Sage est distinct (ART0016).
        if (it.code === "ART0002" && it.name && /joncs?/i.test(it.name)) {
          it.code = "ART0016";
        }
      }

      // 3. Choix manuels mémorisés lors d'exports précédents.
      unresolved = items.filter(function (it) { return !it.code; });
      if (unresolved.length) {
        const manual = await sageLoadManualMap();
        for (const it of unresolved) {
          const saved = manual[sageStorageKey(it)];
          if (saved) it.code = saved;
        }
        unresolved = unresolved.filter(function (it) { return !it.code; });
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Exporter CSV Sage"; }
    }

    if (!unresolved.length) {
      finishSageExport(items);
      return;
    }
    // 3. Dernier recours : attribution manuelle (mémorisée pour la suite).
    showSagePicker(unresolved, items);
  }

  function showSagePicker(unresolved, allItems) {
    const body = document.getElementById("pfs-modal-body");
    if (!body) return;
    const old = document.getElementById("pfs-sage-picker");
    if (old) old.remove();
    const oldWarn = document.getElementById("pfs-sage-warn");
    if (oldWarn) oldWarn.remove();

    // Un même produit (même clé) présent sur plusieurs lignes n'est demandé qu'une fois.
    const groups = new Map();
    for (const it of unresolved) {
      const k = sageStorageKey(it);
      if (!groups.has(k)) groups.set(k, { key: k, items: [], sample: it });
      groups.get(k).items.push(it);
    }

    const panel = el("div", { id: "pfs-sage-picker" });
    panel.appendChild(el("h3", { text: "Avant l'export : attribuez un article Sage à ces produits" }));
    panel.appendChild(
      el("p", {
        className: "pfs-sage-pick-hint",
        text:
          "Ces produits n'ont pas été reconnus (ni par leur catégorie marketplace, ni sur beliandjolie.com). " +
          "Choisissez l'article Sage de chacun — le choix sera mémorisé pour les prochains exports."
      })
    );

    const selects = [];
    for (const g of groups.values()) {
      const row = el("div", { className: "pfs-sage-pick-row" });
      if (g.sample.image) {
        row.appendChild(el("img", { className: "pfs-sage-pick-img", src: g.sample.image, alt: "" }));
      } else {
        row.appendChild(el("div", { className: "pfs-sage-pick-img pfs-sage-pick-noimg", text: "?" }));
      }
      const info = el("div", { className: "pfs-sage-pick-info" });
      info.appendChild(el("div", { className: "pfs-sage-pick-name", text: g.sample.name || g.sample.categorie || "Produit" }));
      const detBits = [];
      if (g.sample.ref) detBits.push("Réf. " + g.sample.ref);
      if (g.sample.bjCategory) detBits.push("Catégorie boutique : " + g.sample.bjCategory);
      else if (g.sample.categorie) detBits.push("Catégorie marketplace : " + g.sample.categorie);
      if (detBits.length) info.appendChild(el("div", { className: "pfs-sage-pick-detail", text: detBits.join(" — ") }));
      row.appendChild(info);

      const sel = document.createElement("select");
      sel.className = "pfs-sage-pick-select";
      sel.appendChild(new Option("— Choisir un article Sage —", ""));
      for (const a of SAGE_ARTICLES) {
        sel.appendChild(new Option(a.code + " — " + a.label, a.code));
      }
      row.appendChild(sel);
      selects.push({ group: g, sel: sel });
      panel.appendChild(row);
    }

    const actions = el("div", { className: "pfs-sage-pick-actions" }, [
      el("button", {
        className: "pfs-sage-pick-cancel",
        type: "button",
        text: "Annuler",
        onClick: function () { panel.remove(); }
      }),
      el("button", {
        className: "pfs-sage-pick-ok",
        type: "button",
        text: "Valider et exporter le CSV",
        onClick: onValidate
      })
    ]);
    panel.appendChild(actions);
    body.appendChild(panel);
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });

    async function onValidate() {
      const manual = await sageLoadManualMap();
      for (const s of selects) {
        const code = s.sel.value;
        for (const it of s.group.items) it.code = code || "";
        if (code) manual[s.group.key] = code;
      }
      sageSaveManualMap(manual);
      panel.remove();
      finishSageExport(allItems);
    }
  }

  function exportToPdf() {
    if (!_originalRows.length || !_currentOrderInfo) return;
    const factor = getSecretFactor(_secretClickCount);
    const rows = _originalRows.map(function (r) {
      return {
        categorie: r.categorie,
        prixUnitaire: r.prixUnitaire / factor,
        quantite: r.quantite * factor
      };
    });

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(buildPrintHtml(rows, _currentOrderInfo));
    doc.close();

    const win = iframe.contentWindow;
    let cleanedUp = false;
    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      setTimeout(function () {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 500);
    }
    win.addEventListener("afterprint", cleanup);

    setTimeout(function () {
      try {
        win.focus();
        win.print();
      } catch (e) {
        console.error("[PFS] Impression impossible :", e);
        cleanup();
      }
      setTimeout(cleanup, 60000);
    }, 200);
  }

  // =========================================================================
  // Vérification entreprise via l'annuaire INSEE / recherche-entreprises
  // -------------------------------------------------------------------------
  // Entreprises FRANÇAISES uniquement. Le SIRET/TVA sont parfois présents
  // sur l'un sans l'autre : l'annuaire permet de reconstituer la pièce
  // manquante (TVA ⇄ SIRET) et de confirmer la raison sociale + l'adresse
  // du siège. Si rien n'est détecté dans la commande, deux champs libres
  // laissent la main à l'utilisateur (facultatif).
  // =========================================================================

  function normalizeDigits(s) {
    return String(s || "").replace(/\D/g, "");
  }

  function normalizeTvaFr(raw) {
    const cleaned = String(raw || "").replace(/\s+/g, "").toUpperCase();
    if (!cleaned) return null;
    if (!cleaned.startsWith("FR")) return null;
    const rest = cleaned.slice(2);
    if (rest.length !== 11) return null;
    if (!/^[0-9A-HJ-NP-Z]{2}\d{9}$/.test(rest)) return null;
    return "FR" + rest;
  }

  function sirenFromTvaFr(raw) {
    const tva = normalizeTvaFr(raw);
    return tva ? tva.slice(-9) : null;
  }

  // Luhn standard — l'exception La Poste (SIRETs 356000000…) utilise la
  // somme des chiffres modulo 5. On accepte les deux ; on reste tolérant
  // sinon et on laisse l'annuaire trancher si la validation locale échoue.
  function isValidSiret(siret) {
    if (!/^\d{14}$/.test(siret)) return false;
    if (siret.startsWith("356000000")) {
      let sum = 0;
      for (let i = 0; i < 14; i++) sum += parseInt(siret[i], 10);
      return sum % 5 === 0;
    }
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      let d = parseInt(siret[13 - i], 10);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return sum % 10 === 0;
  }

  // Scanne orderInfo.addresses pour détecter des champs SIRET / TVA.
  // Pour TVA : accepte uniquement les formats français (FR + 11 chars).
  // Pour SIRET : accepte 14 chiffres (ignore les séparateurs).
  function extractSiretTvaFromOrderInfo(orderInfo) {
    const found = { siret: "", tva: "", isFrench: false };
    if (!orderInfo || !Array.isArray(orderInfo.addresses)) return found;
    const countryHints = [];
    for (const block of orderInfo.addresses) {
      const fields = (block && block.fields) || [];
      for (const f of fields) {
        if (!f || !f.label) continue;
        const label = String(f.label).toLowerCase();
        const value = String(f.value || "");
        if (!found.siret && /siret/.test(label)) {
          const digits = normalizeDigits(value);
          if (digits.length === 14) found.siret = digits;
        }
        if (!found.tva && /tva/.test(label)) {
          const tva = normalizeTvaFr(value);
          if (tva) found.tva = tva;
        }
        if (/pays/.test(label)) countryHints.push(value.toLowerCase());
      }
    }
    found.isFrench =
      !!found.siret ||
      !!found.tva ||
      countryHints.some(function (c) { return /\bfrance\b|^fr$/i.test(c); });
    return found;
  }

  function callAnnuaire(query, kind) {
    if (!isExtensionContextAlive()) {
      return Promise.reject(new Error("Extension rechargée — rechargez la page (F5)."));
    }
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(
          { type: "ANNUAIRE_LOOKUP", query: query, kind: kind },
          function (resp) {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!resp || !resp.ok) {
              reject(new Error((resp && resp.error) || "Annuaire indisponible."));
              return;
            }
            resolve(resp.data || { found: false });
          }
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  function buildVerifEntrepriseSection(orderInfo) {
    const detected = extractSiretTvaFromOrderInfo(orderInfo);

    const box = el("section", { className: "pfs-verif-box" });
    box.appendChild(el("h3", { className: "pfs-verif-title", text: "Vérification entreprise (Annuaire INSEE)" }));

    const hint = el("p", { className: "pfs-verif-hint" });
    hint.textContent = detected.siret || detected.tva
      ? "Pièce détectée dans la commande — interrogation de l'annuaire en cours…"
      : "Aucun SIRET ni n° TVA français détecté. Saisis-les manuellement si besoin.";
    box.appendChild(hint);

    const form = el("div", { className: "pfs-verif-form" });
    const siretInput = el("input", {
      type: "text",
      className: "pfs-verif-input",
      placeholder: "SIRET (14 chiffres)",
      autocomplete: "off",
      spellcheck: "false"
    });
    siretInput.value = detected.siret || "";
    const tvaInput = el("input", {
      type: "text",
      className: "pfs-verif-input",
      placeholder: "N° TVA (ex. FR12123456789)",
      autocomplete: "off",
      spellcheck: "false"
    });
    tvaInput.value = detected.tva || "";
    const btn = el("button", {
      type: "button",
      className: "pfs-verif-btn",
      text: "Vérifier"
    });

    form.appendChild(el("label", { className: "pfs-verif-label", text: "SIRET" }));
    form.appendChild(siretInput);
    form.appendChild(el("label", { className: "pfs-verif-label", text: "N° TVA" }));
    form.appendChild(tvaInput);
    form.appendChild(btn);
    box.appendChild(form);

    const result = el("div", { className: "pfs-verif-result" });
    box.appendChild(result);

    function setStatus(className, text) {
      while (result.firstChild) result.removeChild(result.firstChild);
      result.appendChild(el("p", { className: className, text: text }));
    }

    function clearResult() {
      while (result.firstChild) result.removeChild(result.firstChild);
    }

    function renderResult(data, warnings) {
      clearResult();
      if (!data || !data.found) {
        const msg = (data && data.reason) || "Aucune entreprise trouvée pour cette référence.";
        result.appendChild(el("p", { className: "pfs-verif-empty", text: msg }));
        return;
      }
      const grid = el("dl", { className: "pfs-verif-grid" });

      function addRow(label, value, mono) {
        if (!value) return;
        const row = el("div", { className: "pfs-verif-row" + (mono ? " pfs-verif-mono" : "") });
        row.appendChild(el("dt", { text: label + " :" }));
        row.appendChild(el("dd", { text: value }));
        row.appendChild(makeCopyButton(value));
        grid.appendChild(row);
      }

      const denomination = (data.denomination || "").toLocaleUpperCase("fr-FR");
      addRow("Dénomination", denomination, false);
      const adresseFull = [data.adresse, [data.codePostal, data.commune].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
        .toLocaleUpperCase("fr-FR");
      addRow("Adresse siège", adresseFull, false);
      addRow("SIRET siège", data.siret || "", true);
      addRow("SIREN", data.siren || "", true);
      addRow("N° TVA", data.tva || "", true);
      if (data.activiteLibelle) {
        const act = data.activiteCode
          ? data.activiteLibelle + " (" + data.activiteCode + ")"
          : data.activiteLibelle;
        addRow("Activité", act, false);
      }
      if (data.etatAdministratif) {
        const etatLabel = data.etatAdministratif === "A"
          ? "Active"
          : data.etatAdministratif === "F"
          ? "Fermée (cessée)"
          : String(data.etatAdministratif);
        const row = el("div", { className: "pfs-verif-row" });
        row.appendChild(el("dt", { text: "État :" }));
        const dd = el("dd");
        const badge = el("span", {
          className: data.etatAdministratif === "A" ? "pfs-verif-badge-ok" : "pfs-verif-badge-ko",
          text: etatLabel
        });
        dd.appendChild(badge);
        row.appendChild(dd);
        grid.appendChild(row);
      }
      result.appendChild(grid);

      if (warnings && warnings.length) {
        for (const w of warnings) {
          const cls = w && w.level === "alert" ? "pfs-verif-alert" : "pfs-verif-warn";
          result.appendChild(el("p", { className: cls, text: w && w.text ? w.text : String(w) }));
        }
      }
    }

    function runLookup(siretRaw, tvaRaw) {
      const siretDigits = normalizeDigits(siretRaw);
      const tvaNorm = normalizeTvaFr(tvaRaw);
      const warnings = [];

      let query = "";
      let kind = "";

      if (siretDigits.length === 14) {
        if (!isValidSiret(siretDigits)) {
          warnings.push({ level: "warn", text: "Clé SIRET invalide (Luhn) — recherche lancée malgré tout." });
        }
        query = siretDigits;
        kind = "siret";
      } else if (tvaNorm) {
        const siren = sirenFromTvaFr(tvaNorm);
        if (!siren) {
          setStatus("pfs-verif-error", "N° TVA français invalide.");
          return;
        }
        query = siren;
        kind = "siren";
      } else {
        setStatus("pfs-verif-error", "Saisissez un SIRET (14 chiffres) ou un n° TVA français (FR + 11 caractères).");
        return;
      }

      // Croisement local SIRET ⇄ TVA : si les deux sont fournis, le SIREN
      // extrait du SIRET (9 premiers chiffres) doit correspondre à celui
      // du n° TVA (9 derniers chars). On alerte avant même l'annuaire.
      if (siretDigits.length === 14 && tvaNorm) {
        const sirenFromSiret = siretDigits.slice(0, 9);
        const sirenFromTva = sirenFromTvaFr(tvaNorm);
        if (sirenFromSiret !== sirenFromTva) {
          warnings.push({
            level: "alert",
            text: "⚠ Incohérence : le SIRET (" + siretDigits + ") et le n° TVA (" + tvaNorm + ") n'appartiennent pas à la même entreprise (SIREN différent)."
          });
        }
      }

      setStatus("pfs-verif-loading", "Interrogation de l'annuaire…");

      callAnnuaire(query, kind)
        .then(function (data) {
          if (data && data.found) {
            // TVA saisi ⇄ TVA recalculée depuis l'annuaire
            if (tvaNorm && data.tva && data.tva !== tvaNorm) {
              warnings.push({
                level: "alert",
                text: "⚠ Le n° TVA saisi (" + tvaNorm + ") ne correspond pas à celui de l'annuaire (" + data.tva + ")."
              });
            }
            // SIRET saisi ⇄ SIRET renvoyé par l'annuaire
            if (siretDigits.length === 14 && data.siret && data.siret !== siretDigits) {
              const sirenFromSiret = siretDigits.slice(0, 9);
              if (data.siren && sirenFromSiret === data.siren) {
                warnings.push({
                  level: "warn",
                  text: "Le SIRET saisi correspond à un établissement secondaire — siège : " + data.siret + "."
                });
              } else {
                warnings.push({
                  level: "alert",
                  text: "⚠ Le SIRET saisi (" + siretDigits + ") ne correspond pas à l'entreprise trouvée dans l'annuaire (SIRET siège : " + data.siret + ")."
                });
              }
            }
          }
          renderResult(data, warnings);
        })
        .catch(function (err) {
          setStatus("pfs-verif-error", "Erreur : " + ((err && err.message) || err));
        });
    }

    btn.addEventListener("click", function () {
      runLookup(siretInput.value, tvaInput.value);
    });
    [siretInput, tvaInput].forEach(function (inp) {
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          runLookup(siretInput.value, tvaInput.value);
        }
      });
    });

    if (detected.siret || detected.tva) {
      setTimeout(function () { runLookup(detected.siret, detected.tva); }, 0);
    }

    return box;
  }
})();
