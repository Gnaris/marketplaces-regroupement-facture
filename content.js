(function () {
  const HOST_PFS = "wholesaler.parisfashionshops.com";
  const HOST_EFP = "wholesaler.efashion-paris.com";
  const HOST_FAIRE = "www.faire.com";
  const HOST_MC = "web.mc.app";
  const HOST_OC = "www.orderchamp.com";
  const HOST_SHOPIFY = "admin.shopify.com";
  const host = location.hostname;
  let site = null;
  if (host === HOST_PFS) site = "pfs";
  else if (host === HOST_EFP) site = "efp";
  else if (host.endsWith(".ankorstore.com")) site = "aks";
  else if (host === HOST_FAIRE) site = "faire";
  else if (host === HOST_MC || host.endsWith(".dokkr.net")) site = "mc";
  else if (host === HOST_OC) site = "oc";
  else if (host === HOST_SHOPIFY) site = "shopify";
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
      const result = await new Promise(function (resolve) {
        try {
          chrome.runtime.sendMessage(
            {
              type: "FETCH_ORDER",
              site: site,
              orderId: orderId,
              token: cachedToken,
              apiBase: site === "aks" ? location.origin : undefined,
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
      if (!result.ok) {
        throw new Error(result.error || "Erreur inconnue");
      }
      let parsed;
      if (site === "pfs") parsed = parsePfs(result.data);
      else if (site === "efp") parsed = parseEfp(result.data);
      else if (site === "aks") parsed = parseAks(result.data, orderId);
      else if (site === "shopify") parsed = parseShopify(result.data);
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

  function pushField(fields, label, value) {
    if (value == null) return;
    const v = String(value).replace(/\s+/g, " ").trim();
    if (!v) return;
    fields.push({ label: label || null, value: v });
  }

  function addRow(map, cat, price, qty) {
    const key = cat + "||" + price.toFixed(4);
    if (!map.has(key)) {
      map.set(key, { categorie: cat, prixUnitaire: price, quantite: 0 });
    }
    map.get(key).quantite += qty;
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
        const items = Array.isArray(product.items) ? product.items : [];
        for (const item of items) {
          const price =
            item.price_sale && item.price_sale.unit && typeof item.price_sale.unit.value === "number"
              ? item.price_sale.unit.value
              : 0;
          const isPack = item.type === "PACK";
          const piecesPerPack = typeof item.pieces === "number" ? item.pieces : 1;
          const qtyValidated = typeof item.qty_validated === "number" ? item.qty_validated : 0;
          const qty = isPack ? qtyValidated * piecesPerPack : qtyValidated;
          if (qty <= 0) continue;
          addRow(map, cat, price, qty);
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

    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: order.order_no || "",
        totalVerif: typeof order.validated_vat === "number" ? order.validated_vat : null,
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
      addRow(map, cat, price, qty);
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

    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: order.id_commande_name || "",
        totalVerif: typeof order.montantApresRemise === "number" ? order.montantApresRemise : null,
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
    if (/bracelet/.test(lower)) {
      if (/jonc/.test(lower)) return "Bracelet jonc";
      if (/charm/.test(lower)) return "Bracelet rigide à charms";
      return "Bracelet";
    }
    if (/bague/.test(lower)) {
      if (/d['’]?\s*orteil/.test(lower)) return "Bague d'orteil";
      if (/ajustable/.test(lower)) return "Bague ajustable";
      return "Bague";
    }
    if (/collier/.test(lower)) return "Collier";
    if (/porte[\s-]?cl[ée]/.test(lower)) return "Porte clé";
    if (/pendentif/.test(lower)) return "Pendentif";
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
      addRow(map, cat, price, qty);
    }

    const aksAddresses = [];
    let orderNo = "";
    if (detailJson && detailJson.data && detailJson.data.attributes) {
      const attr = detailJson.data.attributes;
      if (attr.reference) orderNo = String(attr.reference);
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
      orderInfo: { orderNo: orderNo, totalVerif: null, addresses: aksAddresses }
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
      addRow(map, cat, price, qty);
    }
    const totalVerif = parseFloat(doc.total_price);

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
        totalVerif: isFinite(totalVerif) ? totalVerif : null,
        addresses: addresses
      }
    };
  }

  function parseFaire(json, customerData) {
    if (!json || !Array.isArray(json.items)) throw new Error("Réponse API invalide.");
    const map = new Map();
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
      const cat = detectCategory(item.product_name);
      addRow(map, cat, price, qty);
    }
    const token =
      json.brand_order && json.brand_order.token ? json.brand_order.token : "";
    const orderNo = token.replace(/^bo_/, "").toUpperCase();
    const totalCents =
      json.item_subtotal && typeof json.item_subtotal.amount_cents === "number"
        ? json.item_subtotal.amount_cents
        : null;

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
    if (customerData) {
      const bcv = customerData.brand_customer_view || {};
      const storeName = bcv.store_name || "";
      const contactName = bcv.contact_name || "";
      const shipping = customerData.default_shipping_address;
      const shipFields = faireAddrToFields(shipping, storeName, contactName);
      if (shipFields) faireAddresses.push({ title: "Adresse de livraison", fields: shipFields });
      const rd = customerData.retailer_details || {};
      const billing = rd.address;
      const billFields = faireAddrToFields(billing, storeName, contactName);
      if (billFields) faireAddresses.push({ title: "Adresse de facturation", fields: billFields });
    } else {
      console.log("[Faire] Aucune donnée customer interceptée. Rechargez la page de la commande pour que la requête soit captée.");
    }

    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: orderNo,
        totalVerif: totalCents != null ? totalCents / 100 : null,
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
      addRow(map, cat, price, qty);
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

    const subtotal =
      order.subtotalPriceSet && order.subtotalPriceSet.shopMoney
        ? parseFloat(order.subtotalPriceSet.shopMoney.amount)
        : NaN;

    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: order.name || "",
        totalVerif: isFinite(subtotal) ? subtotal : null,
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
      addRow(map, cat, price, qty);
    }

    console.log("[OC] lignes regroupées :", map.size, "numéro :", orderNo);

    let totalVerif = null;
    const totalTrs = document.querySelectorAll("table tr");
    for (const tr of totalTrs) {
      const tds = tr.children;
      if (tds.length !== 2) continue;
      const label = (tds[0].textContent || "").replace(/\s+/g, " ").trim();
      if (label === "Total") {
        const val = parseEuroAmount(tds[1].textContent);
        if (val != null) {
          totalVerif = val;
          break;
        }
      }
    }

    const ocAddresses = parseOcAddresses();

    return {
      rows: sortRows(map),
      orderInfo: { orderNo: orderNo, totalVerif: totalVerif, addresses: ocAddresses }
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

  function buildRowsTable(rows) {
    const totalQty = rows.reduce(function (s, r) { return s + r.quantite; }, 0);
    const totalHT = rows.reduce(function (s, r) { return s + r.quantite * r.prixUnitaire; }, 0);

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

    const tfoot = el("tfoot", null, [
      el("tr", null, [
        (function () {
          const td = el("td");
          td.appendChild(el("strong", { text: "Total" }));
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
    ]);
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
    const table = buildRowsTable(rows);
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
    _secretClickCount = 0;

    if (state.loading) {
      body.appendChild(el("p", { className: "pfs-info", text: "Chargement de la commande…" }));
      footer.style.display = "none";
      return;
    }
    if (state.error) {
      body.appendChild(el("p", { className: "pfs-error", text: state.error }));
      footer.style.display = "flex";
      return;
    }

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
              row.appendChild(el("dt", { text: f.label + " :" }));
              row.appendChild(el("dd", { text: f.value }));
              row.appendChild(makeCopyButton(f.value));
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

    _originalRows = rows.slice();
    _secretClickCount = 0;
    body.appendChild(buildRowsTable(rows));

    footer.style.display = "flex";
  }

  function hideModal() {
    const overlay = document.getElementById("pfs-modal-overlay");
    if (overlay) overlay.style.display = "none";
  }
})();
