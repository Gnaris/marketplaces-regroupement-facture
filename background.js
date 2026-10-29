const SHOPIFY_QUERY = `query OrderRegroup($id: ID!) {
  order(id: $id) {
    name
    subtotalPriceSet { shopMoney { amount currencyCode } }
    totalPriceSet { shopMoney { amount currencyCode } }
    currentTotalPriceSet { shopMoney { amount currencyCode } }
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

// Clic sur l'icône de l'extension → page des paramètres (Options).
chrome.action.onClicked.addListener(function () {
  chrome.runtime.openOptionsPage();
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

  if (message.type === "SAGE_BRIDGE_CREATE") {
    // Création directe d'une facture provisoire dans Sage 50 via SageBridge
    // (programme Windows local, http://127.0.0.1:8765 — voir CLAUDE.md).
    // Fetch depuis le service worker : l'origine est déclarée dans
    // host_permissions, donc pas de CORS ni de Private Network Access.
    sageBridgeCreate(message.payload || {})
      .then(function (res) { sendResponse(res); })
      .catch(function (err) { sendResponse({ ok: false, unreachable: true, error: (err && err.message) || String(err) }); });
    return true;
  }

  if (message.type === "SAGE_LIST_ARTICLES") {
    // Récupère la liste des articles enregistrés dans Sage 50 (via la route
    // /articles exposée par SageBridge ≥ 1.3.0). Alimente le dropdown du
    // picker quand un produit n'a pas de code côté boutique. Si SageBridge
    // n'est pas lancé ou est en vieille version → renvoyer ok:false, le
    // content script bascule sur un champ texte libre.
    sageBridgeListArticles()
      .then(function (res) { sendResponse(res); })
      .catch(function (err) { sendResponse({ ok: false, error: (err && err.message) || String(err) }); });
    return true;
  }

  if (message.type === "SAGE_VALIDATE_SHOP_KEY") {
    // Teste la clé contre les tenants connus un par un. Le résultat ne
    // révèle PAS quel tenant a répondu (volonté : opacité côté UI). Pour
    // qu'un 200 soit décisif on envoie le header x-api-key ; si la clé
    // n'est pas la bonne pour ce tenant, le serveur répond 401 et on
    // passe au suivant.
    const trimmed = String(message.key || "").trim();
    if (!trimmed) {
      sendResponse({ ok: false, error: "empty" });
      return false;
    }
    const sites = Object.keys(PUBLIC_API_BY_SITE);
    (function tryNext(i) {
      if (i >= sites.length) return sendResponse({ ok: false });
      const cfg = PUBLIC_API_BY_SITE[sites[i]];
      fetch(cfg.url + "?perPage=1", {
        method: "GET",
        headers: { "x-api-key": trimmed, Accept: "application/json" }
      })
        .then(function (resp) {
          if (resp.ok) return sendResponse({ ok: true });
          tryNext(i + 1);
        })
        .catch(function () { tryNext(i + 1); });
    })(0);
    return true;
  }

  if (message.type === "SAGE_LOOKUP_REFS") {
    const refs = Array.isArray(message.refs) ? message.refs.slice(0, 60) : [];
    const site = message.site || "bj";
    Promise.all(
      refs.map(function (ref) {
        return lookupBjRef(String(ref), site);
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

  if (message.type === "ANNUAIRE_LOOKUP") {
    annuaireLookup(message.query, message.kind)
      .then(function (data) { sendResponse({ ok: true, data: data }); })
      .catch(function (err) { sendResponse({ ok: false, error: (err && err.message) || String(err) }); });
    return true;
  }

  if (message.type === "VIES_LOOKUP") {
    viesLookup(message.query)
      .then(function (data) { sendResponse({ ok: true, data: data }); })
      .catch(function (err) { sendResponse({ ok: false, error: (err && err.message) || String(err) }); });
    return true;
  }

  // Easy-Express (site web, sans API) : ouvre /shipping dans un nouvel onglet
  // et garde le destinataire de la commande pour cet onglet. ee-content.js le
  // récupère (EE_GET_PREFILL) puis le libère une fois le client sélectionné.
  if (message.type === "OPEN_OPTIONS") {
    if (message.hash) {
      chrome.tabs.create({ url: chrome.runtime.getURL("options.html#" + message.hash) }, function () { sendResponse({ ok: true }); });
    } else {
      chrome.runtime.openOptionsPage(function () { sendResponse({ ok: true }); });
    }
    return true;
  }

  if (message.type === "OPEN_EE_SHIPPING") {
    openEasyExpressShipping(message.payload || {})
      .then(function (res) { sendResponse(res); })
      .catch(function (err) { sendResponse({ ok: false, error: (err && err.message) || String(err) }); });
    return true;
  }

  if (message.type === "EE_GET_PREFILL") {
    eeGetPrefill(sender && sender.tab ? sender.tab.id : null)
      .then(function (data) { sendResponse({ ok: true, data: data }); })
      .catch(function (err) { sendResponse({ ok: false, error: (err && err.message) || String(err) }); });
    return true;
  }

  if (message.type === "EE_PREFILL_DONE") {
    eeClearPrefill(sender && sender.tab ? sender.tab.id : null)
      .then(function () { sendResponse({ ok: true }); });
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

// ---- Résolution catégorie via l'API publique boutique ----
// GET /api/public/products avec le header x-product-reference renvoie le
// produit (catégorie, images, code article Sage). Chaque tenant (BJ, Issyma)
// a son propre domaine et sa propre clé API — la fuite d'une clé n'expose
// pas les autres. Nouveau tenant → ajouter une entrée ici.
const PUBLIC_API_BY_SITE = {
  bj:     { url: "https://beliandjolie.com/api/public/products", key: "kebab1" },
  issyma: { url: "https://issyma.fr/api/public/products",        key: "kebab2" }
};

// Mapping clé → tenant propriétaire. Volontairement caché de l'UI : la page
// Options montre uniquement « Connecté » ou « Mot de passe incorrect » pour
// qu'un utilisateur ne devine pas quelle boutique est derrière quelle clé.
// Même liste que PUBLIC_API_BY_SITE côté serveur (route.ts).
const SHOP_KEY_TO_SITE = {
  "kebab1": "bj",
  "kebab2": "issyma"
};

function resolveSiteForKey(key) {
  const trimmed = String(key || "").trim();
  return SHOP_KEY_TO_SITE[trimmed] || null;
}

function getStoredShopKey() {
  return new Promise(function (resolve) {
    try {
      chrome.storage.sync.get(["sageShopKey"], function (res) {
        resolve((res && res.sageShopKey) ? String(res.sageShopKey).trim() : "");
      });
    } catch (e) {
      resolve("");
    }
  });
}

function fetchShopProduct(reference, site) {
  const cfg = PUBLIC_API_BY_SITE[site];
  if (!cfg) return Promise.resolve(null);
  return fetch(cfg.url, {
    method: "GET",
    headers: {
      "x-api-key": cfg.key,
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

function shapeShopLookup(p) {
  let image = null;
  if (Array.isArray(p.colors)) {
    for (const c of p.colors) {
      if (c && Array.isArray(c.imageUrls) && c.imageUrls.length) {
        image = c.imageUrls[0];
        break;
      }
    }
  }
  return {
    category: p.category || null,
    name: p.name || null,
    image: image,
    sageArticleCode: p.sageArticleCode || null
  };
}

// Résolution du tenant cible pour un lookup catégorie.
// - `bj` et `issyma` : l'utilisateur consulte la commande directement sur sa
//   boutique → on connaît le tenant par l'URL, pas besoin du mot de passe.
// - Autres sites (marketplaces : pfs, efp, mc…) : les commandes ne vivent pas
//   dans la boutique, il faut interroger le tenant propriétaire. On lit le
//   mot de passe saisi dans les Options et on en déduit le tenant.
function resolveLookupSite(site) {
  if (PUBLIC_API_BY_SITE[site]) return Promise.resolve(site);
  return getStoredShopKey().then(function (key) {
    return resolveSiteForKey(key);
  });
}

function lookupBjRef(ref, site) {
  const trimmed = ref.trim();
  if (!trimmed) return Promise.resolve(null);
  return resolveLookupSite(site).then(function (targetSite) {
    if (!targetSite) return null;
    return fetchShopProduct(trimmed, targetSite).then(function (json) {
      if (json && json.product) return shapeShopLookup(json.product);
      const base = trimmed.split("_")[0].trim();
      if (!base || base === trimmed) return null;
      return fetchShopProduct(base, targetSite).then(function (j2) {
        return j2 && j2.product ? shapeShopLookup(j2.product) : null;
      });
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

// ---- Annuaire des Entreprises (recherche-entreprises.api.gouv.fr) ----
// API publique INSEE/DINUM, pas de clé, CORS ouvert. On interroge via le
// service worker pour éviter toute collision avec la CSP de la page hôte.
// `kind` = "siret" (14 chiffres) | "siren" (9 chiffres). On ne renvoie au
// content script qu'une forme normalisée (siren, siret siège, dénomination,
// adresse, état admin, activité, TVA recalculée).
function annuaireLookup(query, kind) {
  const q = String(query || "").replace(/\D/g, "");
  if (kind === "siret" && q.length !== 14) {
    return Promise.resolve({ found: false, reason: "SIRET invalide (14 chiffres attendus)." });
  }
  if (kind === "siren" && q.length !== 9) {
    return Promise.resolve({ found: false, reason: "SIREN invalide (9 chiffres attendus)." });
  }
  const url =
    "https://recherche-entreprises.api.gouv.fr/search?q=" +
    encodeURIComponent(q) +
    "&page=1&per_page=5";
  return fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" }
  })
    .then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (body) {
          throw new Error("Annuaire : " + resp.status + " " + resp.statusText + (body ? " — " + body.slice(0, 200) : ""));
        });
      }
      return resp.json();
    })
    .then(function (json) {
      const results = (json && json.results) || [];
      if (!results.length) return { found: false };
      // Si la requête est un SIRET, on cherche l'établissement correspondant
      // dans matching_etablissements ; sinon on prend le siège.
      const unite = results[0];
      let etab = unite.siege || null;
      if (kind === "siret" && Array.isArray(unite.matching_etablissements)) {
        const match = unite.matching_etablissements.find(function (e) {
          return e && String(e.siret || "").replace(/\D/g, "") === q;
        });
        if (match) etab = match;
      }
      const siren = String(unite.siren || "").replace(/\D/g, "");
      const siretOut = etab ? String(etab.siret || "").replace(/\D/g, "") : "";
      const adresseLigne = etab
        ? [etab.adresse || etab.libelle_commune ? etab.adresse : null, etab.libelle_commune].filter(Boolean).join(", ")
        : "";
      const denomination =
        unite.nom_complet || unite.nom_raison_sociale || unite.sigle || "";
      const etat = (etab && etab.etat_administratif) || unite.etat_administratif || null;
      return {
        found: true,
        siren: siren,
        siret: siretOut,
        denomination: denomination,
        adresse: etab ? etab.adresse || "" : "",
        codePostal: etab ? etab.code_postal || "" : "",
        commune: etab ? etab.libelle_commune || etab.commune || "" : "",
        adresseLigne: adresseLigne,
        etatAdministratif: etat,
        activiteCode: unite.activite_principale || null,
        activiteLibelle: unite.libelle_activite_principale || null,
        tva: siren ? tvaFromSiren(siren) : null
      };
    });
}

function tvaFromSiren(siren) {
  if (!/^\d{9}$/.test(siren)) return null;
  const n = parseInt(siren, 10);
  const key = ((12 + 3 * (n % 97)) % 97).toString().padStart(2, "0");
  return "FR" + key + siren;
}

// ---- VIES (vérification TVA UE hors FR) ----
// VIES REST officiel : https://ec.europa.eu/taxation_customs/vies/rest-api/
// Codes pays acceptés par VIES : les 27 EM + XI (Irlande du Nord). La Grèce
// est "EL" dans VIES (jamais "GR") — on tolère "GR" en entrée et on convertit.
// Les parties numériques varient par pays (NL/SE/HU peuvent contenir des
// lettres), d'où la regex permissive sur le corps.
const EU_VAT_COUNTRIES = new Set([
  "AT","BE","BG","CY","CZ","DE","DK","EE","EL","ES","FI","FR","HR","HU",
  "IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","XI"
]);

function parseEuVat(raw) {
  const cleaned = String(raw || "").replace(/[\s\-.]/g, "").toUpperCase();
  if (cleaned.length < 4) return null;
  let country = cleaned.slice(0, 2);
  if (country === "GR") country = "EL";
  if (!EU_VAT_COUNTRIES.has(country)) return null;
  const number = cleaned.slice(2);
  if (!/^[0-9A-Z+*]{2,13}$/.test(number)) return null;
  return { country: country, number: number };
}

// Appelle VIES. Réponse officielle (vérifiée sur l'endpoint REST) :
//   { isValid, requestDate, userError, name, address, requestIdentifier, ... }
// VIES renvoie "---" pour name/address quand l'État membre refuse la
// divulgation (DE, ES notamment). On normalise ces valeurs à "".
function viesLookup(rawVat) {
  const parsed = parseEuVat(rawVat);
  if (!parsed) {
    return Promise.resolve({ found: false, source: "VIES", reason: "N° TVA UE invalide (préfixe pays + chiffres attendus)." });
  }
  const url =
    "https://ec.europa.eu/taxation_customs/vies/rest-api/ms/" +
    encodeURIComponent(parsed.country) +
    "/vat/" + encodeURIComponent(parsed.number);
  return fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" }
  })
    .then(function (resp) {
      return resp.json().catch(function () { return null; }).then(function (json) {
        if (!resp.ok) {
          const code = (json && (json.userError || json.message)) || resp.status + " " + resp.statusText;
          throw new Error("VIES : " + code);
        }
        return json;
      });
    })
    .then(function (json) {
      if (!json) return { found: false, source: "VIES", reason: "Réponse VIES vide." };
      const isValid = json.isValid === true || json.valid === true;
      const rawName = String(json.name || json.traderName || "").trim();
      const rawAddr = String(json.address || json.traderAddress || "").trim();
      const name = rawName === "---" ? "" : rawName;
      const address = rawAddr === "---" ? "" : rawAddr;
      const countryOut = parsed.country === "EL" ? "GR" : parsed.country;
      return {
        found: isValid,
        source: "VIES",
        valid: isValid,
        country: countryOut,
        tva: parsed.country + parsed.number,
        denomination: name,
        adresseLigne: address,
        requestDate: json.requestDate || null,
        userError: json.userError || null,
        reason: isValid ? "" : "N° TVA non valide selon VIES."
      };
    });
}

// ─────────────────────────────────────────────
// Easy-Express — ouverture du site (l'API v3 a été retirée en 3.31.0 car
// incomplète). On ouvre https://easy-express.fr/shipping dans un nouvel
// onglet ; le destinataire est rangé dans chrome.storage.local sous
// eeShipPrefill_<tabId> et lu par ee-content.js, qui cherche le client dans
// le carnet d'adresses Easy-Express et le crée s'il n'existe pas.
// ─────────────────────────────────────────────
const EE_SHIPPING_URL = "https://easy-express.fr/shipping";
const EE_PREFILL_TTL_MS = 30 * 60 * 1000;

function eePrefillKey(tabId) { return "eeShipPrefill_" + tabId; }

async function openEasyExpressShipping(payload) {
  const tab = await new Promise(function (resolve, reject) {
    chrome.tabs.create({ url: EE_SHIPPING_URL, active: true }, function (t) {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(t);
    });
  });
  const prefill = {
    receiver: payload.receiver || {},
    orderNo: payload.orderNo || "",
    parcelValue: payload.parcelValue || null,
    timestamp: Date.now()
  };
  await new Promise(function (resolve) {
    const o = {}; o[eePrefillKey(tab.id)] = prefill;
    chrome.storage.local.set(o, function () { resolve(); });
  });
  return { ok: true };
}

async function eeGetPrefill(tabId) {
  if (tabId == null) return null;
  const key = eePrefillKey(tabId);
  const res = await new Promise(function (resolve) { chrome.storage.local.get([key], resolve); });
  const p = res && res[key];
  if (!p) return null;
  if (Date.now() - (p.timestamp || 0) > EE_PREFILL_TTL_MS) {
    await eeClearPrefill(tabId);
    return null;
  }
  return p;
}

function eeClearPrefill(tabId) {
  return new Promise(function (resolve) {
    if (tabId == null) return resolve();
    chrome.storage.local.remove([eePrefillKey(tabId)], function () { resolve(); });
  });
}

// Nettoyage : un onglet fermé avant la fin ne laisse pas de destinataire orphelin.
chrome.tabs.onRemoved.addListener(function (tabId) { eeClearPrefill(tabId); });

// ─── SageBridge (création directe dans Sage 50) ───────────────────────────
const SAGE_BRIDGE_URL = "http://127.0.0.1:8765";

async function sageBridgeListArticles() {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 15000);
  let response;
  try {
    response = await fetch(SAGE_BRIDGE_URL + "/articles", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, unreachable: true, error: (err && err.message) || String(err) };
  }
  clearTimeout(timer);
  if (!response.ok) return { ok: false, error: "HTTP " + response.status };
  let data = null;
  try { data = await response.json(); } catch (e) { return { ok: false, error: "JSON illisible" }; }
  if (!Array.isArray(data)) return { ok: false, error: "Format inattendu" };
  return { ok: true, articles: data };
}

async function sageBridgeCreate(payload) {
  const controller = new AbortController();
  // SageBridge borne chaque opération Sage à 2 minutes : on attend un peu plus.
  const timer = setTimeout(function () { controller.abort(); }, 150000);
  let response;
  try {
    response = await fetch(SAGE_BRIDGE_URL + "/facture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    // Délai dépassé : la facture a peut-être été créée quand même (ne pas parler de « SageBridge absent »).
    if (err && err.name === "AbortError") return { ok: false, timeout: true, error: "Délai dépassé" };
    // Connexion refusée = SageBridge pas lancé (ou port changé).
    return { ok: false, unreachable: true, error: (err && err.message) || String(err) };
  }
  clearTimeout(timer);
  let data = null;
  try { data = await response.json(); } catch (e) { data = null; }
  if (!data) return { ok: false, error: "Réponse illisible de SageBridge (HTTP " + response.status + ")." };
  data.status = response.status;
  return data;
}
