(function () {
  function findAuthToken() {
    const stores = [
      { store: localStorage, name: "localStorage" },
      { store: sessionStorage, name: "sessionStorage" }
    ];
    for (const { store } of stores) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (!key) continue;
        const raw = store.getItem(key);
        if (!raw) continue;
        if (/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) {
          return { token: raw, keyName: key };
        }
        try {
          const parsed = JSON.parse(raw);
          const candidates = [
            parsed && parsed.token,
            parsed && parsed.accessToken,
            parsed && parsed.access_token,
            parsed && parsed.jwt,
            parsed && parsed.authToken,
            parsed && parsed.auth && parsed.auth.token,
            parsed && parsed.state && parsed.state.token,
            parsed && parsed.state && parsed.state.user && parsed.state.user.token,
            parsed && parsed.user && parsed.user.token
          ];
          for (const c of candidates) {
            if (typeof c === "string" && /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(c)) {
              return { token: c, keyName: key };
            }
          }
        } catch (e) {}
      }
    }
    return null;
  }

  function reply(requestId, payload) {
    window.postMessage(
      Object.assign(
        {
          source: "bm-regroup",
          type: "FETCH_ORDER_RESULT",
          requestId: requestId
        },
        payload
      ),
      "*"
    );
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== "bm-regroup" || d.type !== "FETCH_ORDER") return;
    const orderId = d.orderId;
    const requestId = d.requestId;
    if (!orderId || !requestId) return;

    const url =
      "https://server.bijouxmysteres.fr/api/orders/" +
      encodeURIComponent(orderId);
    const headers = { Accept: "application/json, text/plain, */*" };
    const found = findAuthToken();
    let mode;
    let options;
    if (found) {
      headers.Authorization = "Bearer " + found.token;
      options = { method: "GET", headers: headers, credentials: "omit" };
      mode = "bearer(" + found.keyName + ")";
    } else {
      options = { method: "GET", headers: headers, credentials: "include" };
      mode = "cookie";
    }

    console.log("[bm-regroup] fetch mode:", mode);

    fetch(url, options)
      .then(function (resp) {
        if (!resp.ok) {
          return resp.text().then(function (body) {
            reply(requestId, {
              ok: false,
              error:
                "Erreur API (" +
                resp.status +
                " " +
                resp.statusText +
                ") [mode=" +
                mode +
                "]",
              body: (body || "").slice(0, 300)
            });
          });
        }
        return resp.json().then(function (data) {
          reply(requestId, { ok: true, data: data });
        });
      })
      .catch(function (err) {
        reply(requestId, {
          ok: false,
          error:
            ((err && err.message) || String(err)) +
            " [mode=" +
            mode +
            "]"
        });
      });
  });
})();
