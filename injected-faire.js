(function () {
  if (window.__faireRegroupInjected) return;
  window.__faireRegroupInjected = true;

  // Endpoint réel (vérifié live 31/08/2026) :
  //   /api/crm/brands/customer-details?retailer_token={retailerToken}
  // Payload : { brand_customer_view, default_shipping_address, retailer_details, … }
  // Ancien pattern (/api/v3/crm/{brand}/customer_details) gardé en repli si Faire
  // réactive la route historique.
  const RX_CUSTOMER_DETAILS_NEW =
    /\/api\/crm\/brands\/customer-details\?[^"]*retailer_token=([^&"]+)/;
  const RX_CUSTOMER_DETAILS_OLD =
    /\/api\/v3\/crm\/([^/]+)\/customer_details\?[^"]*retailer_token=([^&"]+)/;

  function send(data, brandToken, retailerToken, url) {
    if (!data) return;
    try {
      console.log("[injected-faire] payload capté depuis :", url, data);
    } catch (e) { /* noop */ }
    window.postMessage({
      source: "faire-regroup",
      type: "FAIRE_CUSTOMER",
      data: data,
      brandToken: brandToken || null,
      retailerToken: retailerToken || null
    }, "*");
  }

  function parseTokens(url) {
    if (typeof url !== "string") return null;
    let m = url.match(RX_CUSTOMER_DETAILS_NEW);
    if (m) return { brandToken: null, retailerToken: m[1] };
    m = url.match(RX_CUSTOMER_DETAILS_OLD);
    if (m) return { brandToken: m[1], retailerToken: m[2] };
    return null;
  }

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    const result = originalFetch.apply(this, arguments);
    const tokens = parseTokens(url);
    if (tokens) {
      result
        .then(function (resp) {
          return resp.clone().json();
        })
        .then(function (data) {
          send(data, tokens.brandToken, tokens.retailerToken, url);
        })
        .catch(function () {});
    }
    return result;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    const tokens = parseTokens(url);
    if (tokens) {
      const xhr = this;
      this.addEventListener("load", function () {
        try {
          send(JSON.parse(xhr.responseText), tokens.brandToken, tokens.retailerToken, url);
        } catch (e) {}
      });
    }
    return originalOpen.apply(this, arguments);
  };
})();
