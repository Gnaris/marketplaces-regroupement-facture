(function () {
  const HOST_PFS = "wholesaler.parisfashionshops.com";
  const HOST_EFP = "wholesaler.efashion-paris.com";
  const HOST_FAIRE = "www.faire.com";
  const HOST_MC = "web.mc.app";
  const host = location.hostname;
  let site = null;
  if (host === HOST_PFS) site = "pfs";
  else if (host === HOST_EFP) site = "efp";
  else if (host.endsWith(".ankorstore.com")) site = "aks";
  else if (host === HOST_FAIRE) site = "faire";
  else if (host === HOST_MC || host.endsWith(".dokkr.net")) site = "mc";
  if (!site) return;

  const isTopFrame = window.top === window.self;

  let cachedToken = null;

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
    return null;
  }

  function isOrderPage() {
    if (site === "pfs") return /\/orders\/[^\/]+\/details/.test(location.pathname);
    if (site === "efp") return /\/orderdetails\/\d+/.test(location.pathname);
    if (site === "aks") return /\/account\/orders\/[^\/]+/.test(location.pathname);
    if (site === "faire") return /\/brand-portal\/orders\/bo_[^\/\?]+/.test(location.pathname);
    if (site === "mc") return host === HOST_MC;
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

  async function onRegroupClick() {
    if (site === "mc") {
      return onRegroupClickMc();
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

    showModal({ loading: true });
    try {
      const result = await new Promise(function (resolve) {
        chrome.runtime.sendMessage(
          {
            type: "FETCH_ORDER",
            site: site,
            orderId: orderId,
            token: cachedToken,
            apiBase: site === "aks" ? location.origin : undefined
          },
          function (response) {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response || { ok: false, error: "Pas de réponse du service worker." });
            }
          }
        );
      });
      if (!result.ok) {
        throw new Error(result.error || "Erreur inconnue");
      }
      let parsed;
      if (site === "pfs") parsed = parsePfs(result.data);
      else if (site === "efp") parsed = parseEfp(result.data);
      else if (site === "aks") parsed = parseAks(result.data, orderId);
      else parsed = parseFaire(result.data);
      showModal({ rows: parsed.rows, orderInfo: parsed.orderInfo });
    } catch (e) {
      showModal({ error: e && e.message ? e.message : String(e) });
    }
  }

  async function onRegroupClickMc() {
    showModal({ loading: true });
    const result = await new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: "GET_MC_ORDER" }, function (response) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { ok: false, error: "Pas de réponse du service worker." });
        }
      });
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
    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: order.order_no || "",
        totalVerif: typeof order.validated_vat === "number" ? order.validated_vat : null
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
      const price =
        typeof ligne.prixReduit === "number" && ligne.prixReduit > 0
          ? ligne.prixReduit
          : typeof ligne.prix === "number"
          ? ligne.prix
          : 0;
      const qty = typeof ligne.quantite_total === "number" ? ligne.quantite_total : 0;
      if (qty <= 0) continue;
      addRow(map, cat, price, qty);
    }
    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: order.id_commande_name || "",
        totalVerif: typeof order.montantApresRemise === "number" ? order.montantApresRemise : null
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

  function parseAks(json, orderId) {
    if (!json || !Array.isArray(json.data)) throw new Error("Réponse API invalide.");
    const productsById = new Map();
    const included = Array.isArray(json.included) ? json.included : [];
    for (const inc of included) {
      if (inc.type === "ordered-products" && inc.id && inc.attributes) {
        productsById.set(inc.id, inc.attributes);
      }
    }
    const map = new Map();
    for (const item of json.data) {
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
    const shortId = orderId && orderId.length > 8 ? orderId.slice(0, 8) + "…" : orderId || "";
    return {
      rows: sortRows(map),
      orderInfo: { orderNo: shortId, totalVerif: null }
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
    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: doc.number || doc.id || "",
        totalVerif: isFinite(totalVerif) ? totalVerif : null
      }
    };
  }

  function parseFaire(json) {
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
    return {
      rows: sortRows(map),
      orderInfo: {
        orderNo: orderNo,
        totalVerif: totalCents != null ? totalCents / 100 : null
      }
    };
  }

  function fmtEuro(n) {
    return n.toFixed(2).replace(".", ",") + " €";
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
    const footer = el("div", { id: "pfs-modal-footer" }, [
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

  function showModal(state) {
    const overlay = ensureOverlay();
    overlay.style.display = "flex";

    const body = document.getElementById("pfs-modal-body");
    const footer = document.getElementById("pfs-modal-footer");
    while (body.firstChild) body.removeChild(body.firstChild);

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
    const totalQty = rows.reduce(function (s, r) { return s + r.quantite; }, 0);
    const totalHT = rows.reduce(function (s, r) { return s + r.quantite * r.prixUnitaire; }, 0);

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

    const table = el("table", { id: "pfs-table" });
    const thead = el("thead", null, [
      el("tr", null, [
        el("th", { text: "Catégorie" }),
        el("th", { text: "Prix unitaire" }),
        el("th", { className: "r", text: "Quantité" }),
        el("th", { className: "r", text: "Sous-total HT" })
      ])
    ]);
    table.appendChild(thead);

    const tbody = el("tbody");
    let prevCat = null;
    for (const r of rows) {
      const showCat = r.categorie !== prevCat;
      prevCat = r.categorie;
      const catCell = el("td");
      if (showCat) catCell.appendChild(el("strong", { text: r.categorie }));
      tbody.appendChild(el("tr", null, [
        catCell,
        el("td", { text: fmtEuro(r.prixUnitaire) }),
        el("td", { className: "r", text: String(r.quantite) }),
        el("td", { className: "r", text: fmtEuro(r.prixUnitaire * r.quantite) })
      ]));
    }
    table.appendChild(tbody);

    const tfoot = el("tfoot", null, [
      el("tr", null, [
        (function () {
          const td = el("td", { colspan: "2" });
          td.appendChild(el("strong", { text: "Total" }));
          return td;
        })(),
        (function () {
          const td = el("td", { className: "r" });
          td.appendChild(el("strong", { text: String(totalQty) }));
          return td;
        })(),
        (function () {
          const td = el("td", { className: "r" });
          td.appendChild(el("strong", { text: fmtEuro(totalHT) }));
          return td;
        })()
      ])
    ]);
    table.appendChild(tfoot);
    body.appendChild(table);

    footer.style.display = "flex";
  }

  function hideModal() {
    const overlay = document.getElementById("pfs-modal-overlay");
    if (overlay) overlay.style.display = "none";
  }
})();
