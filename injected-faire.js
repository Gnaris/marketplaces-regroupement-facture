(function () {
  if (window.__faireRegroupInjected) return;
  window.__faireRegroupInjected = true;

  const RX = /\/api\/v3\/crm\/([^/]+)\/customer_details\?[^"]*retailer_token=([^&"]+)/;

  function send(data, brandToken, retailerToken) {
    if (!data) return;
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
    const m = url.match(RX);
    if (!m) return null;
    return { brandToken: m[1], retailerToken: m[2] };
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
          send(data, tokens.brandToken, tokens.retailerToken);
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
          send(JSON.parse(xhr.responseText), tokens.brandToken, tokens.retailerToken);
        } catch (e) {}
      });
    }
    return originalOpen.apply(this, arguments);
  };
})();
