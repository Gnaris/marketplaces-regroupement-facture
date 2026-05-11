const EFP_QUERY = `query GetOrderDetail($id: Int!) {
  commandeById(id: $id) {
    id_commande
    id_commande_name
    montantApresRemise
    lignes {
      prix
      prixReduit
      quantite_total
      corbeille
      categorie
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
    const url =
      apiBase +
      "/api/internal/v1/ordering/orders/" +
      encodeURIComponent(orderId) +
      "/order-items?include=orderedProduct";
    fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.api+json, application/json, */*",
        "X-Requested-With": "XMLHttpRequest"
      },
      credentials: "include"
    })
      .then(handleResponse(sendResponse))
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

  sendResponse({ ok: false, error: "Site inconnu : " + site });
});

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
