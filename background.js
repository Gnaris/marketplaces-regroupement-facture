const SHOPIFY_QUERY = `query OrderRegroup($id: ID!) {
  order(id: $id) {
    name
    subtotalPriceSet { shopMoney { amount currencyCode } }
    billingAddressMatchesShippingAddress
    shippingAddress {
      name firstName lastName company
      address1 address2 city zip
      provinceCode countryCodeV2 country
      phone
    }
    billingAddress {
      name firstName lastName company
      address1 address2 city zip
      provinceCode countryCodeV2 country
      phone
    }
    lineItems(first: 250) {
      edges {
        node {
          title
          quantity
          currentQuantity
          variantTitle
          sku
          image { url }
          originalUnitPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
}`;

const EFP_QUERY = `query GetOrderDetail($id: Int!) {
  commandeById(id: $id) {
    id_commande
    id_commande_name
    montantApresRemise
    acheteur {
      nomContact
      prenomContact
      email
      nomSociete
      tva_intra
      eori
    }
    adresseFacturation {
      adresse
      codePostal
      ville
      telephone
      mobile
      NomContact
      Societe
      pays {
        texte_fr
      }
    }
    lignes {
      prixLigne
      quantite_total
      corbeille
      categorie
      reference
      reference_base
      couleur_FR
      imageUrl
    }
  }
}`;

const lastMcOrders = new Map();

chrome.tabs && chrome.tabs.onRemoved && chrome.tabs.onRemoved.addListener(function (tabId) {
  lastMcOrders.delete(tabId);
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message) return;

  if (message.type === "SAVE_MC_ORDER") {
    if (sender.tab && sender.tab.id != null && message.data) {
      lastMcOrders.set(sender.tab.id, message.data);
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "GET_MC_ORDER") {
    const tabId = sender.tab && sender.tab.id;
    const data = tabId != null ? lastMcOrders.get(tabId) : null;
    sendResponse({ ok: !!data, data: data || null });
    return;
  }

  if (message.type === "SAGE_LOOKUP_REFS") {
    const refs = Array.isArray(message.refs) ? message.refs.slice(0, 60) : [];
    Promise.all(
      refs.map(function (ref) {
        return lookupBjRef(String(ref));
      })
    )
      .then(function (results) {
        const out = {};
        refs.forEach(function (ref, i) {
          if (results[i]) out[ref] = results[i];
        });
        sendResponse({ ok: true, data: out });
      })
      .catch(function (err) {
        sendResponse({ ok: false, error: (err && err.message) || String(err) });
      });
    return true;
  }

  if (message.type !== "FETCH_ORDER") return;

  const site = message.site;
  const orderId = message.orderId;
  const token = message.token;

  if (site === "pfs") {
    if (!orderId || !token) {
      sendResponse({ ok: false, error: "Paramètres manquants (orderId / token)." });
      return;
    }
    const url = "https://wholesaler-api.parisfashionshops.com/api/v1/orders/" + orderId;
    fetch(url, {
      method: "GET",
      headers: {
        Authorization: token,
        Accept: "application/json, text/plain, */*"
      }
    })
      .then(handleResponse(sendResponse))
      .catch(handleError(sendResponse));
    return true;
  }

  if (site === "efp") {
    const idNum = parseInt(orderId, 10);
    if (!idNum) {
      sendResponse({ ok: false, error: "ID commande invalide." });
      return;
    }
    const body = JSON.stringify({
      query: EFP_QUERY,
      variables: { id: idNum }
    });
    fetch("https://wapi.efashion-paris.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*"
      },
      body: body,
      credentials: "include"
    })
      .then(handleResponse(sendResponse))
      .catch(handleError(sendResponse));
    return true;
  }

  if (site === "aks") {
    if (!orderId) {
      sendResponse({ ok: false, error: "ID commande manquant." });
      return;
    }
    const apiBase = message.apiBase || "https://fr.ankorstore.com";
    const headers = {
      Accept: "application/vnd.api+json, application/json, */*",
      "X-Requested-With": "XMLHttpRequest"
    };
    const itemsUrl =
      apiBase +
      "/api/internal/v1/ordering/orders/" +
      encodeURIComponent(orderId) +
      "/order-items?include=orderedProduct";
    const detailUrl =
      apiBase +
      "/api/internal/v1/ordering/orders/" +
      encodeURIComponent(orderId);
    Promise.all([
      fetch(itemsUrl, { method: "GET", headers: headers, credentials: "include" }),
      fetch(detailUrl, { method: "GET", headers: headers, credentials: "include" })
    ])
      .then(function (responses) {
        const itemsResp = responses[0];
        const detailResp = responses[1];
        if (!itemsResp.ok) {
          return itemsResp.text().then(function (body) {
            sendResponse({
              ok: false,
              error: "Erreur API items (" + itemsResp.status + " " + itemsResp.statusText + ")",
              body: body && body.slice ? body.slice(0, 300) : ""
            });
          });
        }
        return Promise.all([
          itemsResp.json(),
          detailResp.ok ? detailResp.json().catch(function () { return null; }) : null
        ]).then(function (parsed) {
          sendResponse({ ok: true, data: { items: parsed[0], detail: parsed[1] } });
        });
      })
      .catch(handleError(sendResponse));
    return true;
  }

  if (site === "faire") {
    if (!orderId) {
      sendResponse({ ok: false, error: "ID commande manquant." });
      return;
    }
    const url =
      "https://www.faire.com/api/brand-order/" +
      encodeURIComponent(orderId) +
      "/details";
    fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, */*"
      },
      credentials: "include"
    })
      .then(handleResponse(sendResponse))
      .catch(handleError(sendResponse));
    return true;
  }

  if (site === "shopify") {
    if (!orderId) {
      sendResponse({ ok: false, error: "ID commande manquant." });
      return;
    }
    const storeName = message.storeName;
    const csrfToken = message.csrfToken;
    if (!storeName) {
      sendResponse({ ok: false, error: "Nom de boutique Shopify manquant." });
      return;
    }
    if (!csrfToken) {
      sendResponse({
        ok: false,
        error:
          "Jeton CSRF Shopify introuvable. Rechargez la page (F5) et recliquez sur le bouton."
      });
      return;
    }
    const url =
      "https://admin.shopify.com/api/shopify/" +
      encodeURIComponent(storeName) +
      "?operation=OrderRegroup";
    const body = JSON.stringify({
      query: SHOPIFY_QUERY,
      operationName: "OrderRegroup",
      operationType: "query",
      variables: { id: "gid://shopify/Order/" + orderId }
    });
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-CSRF-Token": csrfToken,
        "Shopify-Proxy-Api-Enable": "true",
        "Apollographql-Client-Name": "core"
      },
      body: body,
      credentials: "include"
    })
      .then(handleResponse(sendResponse))
      .catch(handleError(sendResponse));
    return true;
  }

  if (site === "bj" || site === "issyma") {
    if (!orderId) {
      sendResponse({ ok: false, error: "ID commande manquant." });
      return;
    }
    // Beli & Jolie et Issyma partagent la même app Next.js multi-tenant :
    // même endpoint, même contrat, apiBase (location.origin) sélectionne
    // simplement le domaine — le middleware côté serveur résout le tenant
    // par le host de la requête.
    const defaultBase = site === "issyma" ? "https://issyma.fr" : "https://beliandjolie.com";
    const apiBase = message.apiBase || defaultBase;
    const url =
      apiBase +
      "/api/admin/commandes/" +
      encodeURIComponent(orderId) +
      "/regroup";
    fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, */*"
      },
      credentials: "include"
    })
      .then(handleResponse(sendResponse))
      .catch(handleError(sendResponse));
    return true;
  }

  sendResponse({ ok: false, error: "Site inconnu : " + site });
});

// ---- Résolution catégorie via l'API publique Beli & Jolie ----
// GET /api/public/products avec le header x-product-reference renvoie le
// produit (catégorie + images). Les SKU marketplace de la forme
// {REFERENCE}_{COULEUR} (Ankorstore, etc.) sont retentés avec la partie
// avant le premier « _ » si la référence complète est introuvable.
const BJ_PUBLIC_API = "https://beliandjolie.com/api/public/products";
const BJ_PUBLIC_API_KEY = "kebab";

function fetchBjProduct(reference) {
  return fetch(BJ_PUBLIC_API, {
    method: "GET",
    headers: {
      "x-api-key": BJ_PUBLIC_API_KEY,
      "x-product-reference": reference,
      Accept: "application/json"
    }
  })
    .then(function (resp) {
      return resp.ok ? resp.json() : null;
    })
    .catch(function () {
      return null;
    });
}

function shapeBjLookup(p) {
  let image = null;
  if (Array.isArray(p.colors)) {
    for (const c of p.colors) {
      if (c && Array.isArray(c.imageUrls) && c.imageUrls.length) {
        image = c.imageUrls[0];
        break;
      }
    }
  }
  return { category: p.category || null, name: p.name || null, image: image };
}

function lookupBjRef(ref) {
  const trimmed = ref.trim();
  if (!trimmed) return Promise.resolve(null);
  return fetchBjProduct(trimmed).then(function (json) {
    if (json && json.product) return shapeBjLookup(json.product);
    const base = trimmed.split("_")[0].trim();
    if (!base || base === trimmed) return null;
    return fetchBjProduct(base).then(function (j2) {
      return j2 && j2.product ? shapeBjLookup(j2.product) : null;
    });
  });
}

function handleResponse(sendResponse) {
  return function (resp) {
    if (!resp.ok) {
      return resp.text().then(function (body) {
        sendResponse({
          ok: false,
          error: "Erreur API (" + resp.status + " " + resp.statusText + ")",
          body: body && body.slice ? body.slice(0, 300) : ""
        });
      });
    }
    return resp.json().then(function (data) {
      sendResponse({ ok: true, data: data });
    });
  };
}

function handleError(sendResponse) {
  return function (err) {
    sendResponse({ ok: false, error: (err && err.message) || String(err) });
  };
}
