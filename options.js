(function () {
  const $ = function (id) { return document.getElementById(id); };

  const el = {
    shopKey: $("shopKey"),
    toggleShopKey: $("toggleShopKey"),
    validateShopKey: $("validateShopKey"),
    shopKeyStatus: $("shopKeyStatus"),
    waShopName: $("waShopName"),
    save: $("save"),
    saveStatus: $("saveStatus")
  };

  function setStatus(node, text, kind) {
    node.textContent = text || "";
    node.classList.remove("ok", "err", "warn", "muted");
    node.classList.add(kind || "muted");
  }

  function load() {
    chrome.storage.sync.get(["sageShopKey", "waShopName"], function (res) {
      el.shopKey.value = res.sageShopKey || "";
      el.waShopName.value = res.waShopName || "";
      setStatus(el.shopKeyStatus, res.sageShopKey ? "Mot de passe enregistré (non revérifié)" : "Aucun mot de passe enregistré", "muted");
    });
    // Nettoyage des anciens réglages de l'API Easy-Express (retirée en 3.31.0).
    chrome.storage.sync.remove(["easyExpressToken", "easyExpressSender"]);
    chrome.storage.local.remove(["eePrefill", "eeDraftReceiver"]);
  }

  el.toggleShopKey.addEventListener("click", function () {
    el.shopKey.type = el.shopKey.type === "password" ? "text" : "password";
  });

  // ─── Vérifier le mot de passe boutique (lookup catégories) ────────
  // Volontairement opaque : juste "Connecté" ou "Mot de passe incorrect".
  // Le mapping clé → boutique est caché dans le service worker.
  el.validateShopKey.addEventListener("click", function () {
    const key = el.shopKey.value.trim();
    if (!key) { setStatus(el.shopKeyStatus, "Saisissez un mot de passe.", "warn"); return; }
    setStatus(el.shopKeyStatus, "Vérification en cours…", "muted");
    el.validateShopKey.disabled = true;
    chrome.runtime.sendMessage({ type: "SAGE_VALIDATE_SHOP_KEY", key: key }, function (res) {
      el.validateShopKey.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus(el.shopKeyStatus, "Erreur : " + chrome.runtime.lastError.message, "err");
        return;
      }
      if (res && res.ok) setStatus(el.shopKeyStatus, "✓ Connecté", "ok");
      else setStatus(el.shopKeyStatus, "✗ Mot de passe incorrect", "err");
    });
  });

  // ─── Enregistrer ───────────────────────────────────────────────────
  el.save.addEventListener("click", function () {
    chrome.storage.sync.set({ sageShopKey: el.shopKey.value.trim(), waShopName: el.waShopName.value.trim() }, function () {
      if (chrome.runtime.lastError) {
        setStatus(el.saveStatus, "Erreur stockage : " + chrome.runtime.lastError.message, "err");
      } else {
        setStatus(el.saveStatus, "✓ Enregistré", "ok");
        setTimeout(function () { setStatus(el.saveStatus, "", "muted"); }, 3000);
      }
    });
  });

  // ─── Modèles WhatsApp (wa-templates.js) ───────────────────────────
  const wa = {
    listView: $("waListView"), list: $("waList"), listStatus: $("waListStatus"),
    btnNew: $("waNew"), btnResetAll: $("waResetAll"),
    editor: $("waEditor"), group: $("waEdGroup"), groups: $("waGroups"), title: $("waEdTitle"),
    body: $("waEdBody"), vars: $("waEdVars"), preview: $("waEdPreview"),
    save: $("waEdSave"), cancel: $("waEdCancel"), reset: $("waEdReset"), status: $("waEdStatus")
  };
  let waStore = waEmptyStore();
  let waEditing = null; // { id, system } — id null = nouveau modèle

  function mk(tag, props, children) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === "className") n.className = props[k];
      else if (k === "text") n.textContent = props[k];
      else if (k === "onClick") n.addEventListener("click", props[k]);
      else n.setAttribute(k, props[k]);
    }
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  function waSampleRender(body) {
    const shop = el.waShopName.value.trim();
    return String(body || "").replace(/\{(company|boutique|transporteur|adresse|plateforme|client|commande)\}/g, function (m, k) {
      if (k === "company" || k === "boutique") return shop || "{company}";
      const v = WA_VARIABLES.find(function (x) { return x.token === "{" + k + "}"; });
      return v ? v.sample : m;
    });
  }

  function waRenderList() {
    while (wa.list.firstChild) wa.list.removeChild(wa.list.firstChild);
    const all = waMergeTemplates(waStore);
    const groups = [];
    all.forEach(function (t) {
      let g = groups.find(function (x) { return x.name === t.group; });
      if (!g) { g = { name: t.group, items: [] }; groups.push(g); }
      g.items.push(t);
    });
    groups.forEach(function (g) {
      wa.list.appendChild(mk("div", { className: "wa-group-title", text: g.name }));
      g.items.forEach(function (t) {
        const title = mk("div", { className: "wa-item-title" }, [t.title]);
        if (t.modified) title.appendChild(mk("span", { className: "wa-badge mod", text: "Modifié" }));
        if (!t.system) title.appendChild(mk("span", { className: "wa-badge custom", text: "Personnalisé" }));
        const actions = mk("div", { className: "wa-item-actions" }, [
          mk("button", { type: "button", className: "secondary", text: "Modifier", onClick: function () { waOpenEditor(t); } })
        ]);
        if (t.system && t.modified) {
          actions.appendChild(mk("button", { type: "button", className: "secondary", text: "Remettre par défaut", onClick: function () { waResetOne(t.id); } }));
        }
        if (!t.system) {
          actions.appendChild(mk("button", { type: "button", className: "danger", text: "Supprimer", onClick: function () { waDelete(t.id); } }));
        }
        wa.list.appendChild(mk("div", { className: "wa-item" }, [
          mk("div", { className: "wa-item-main" }, [title, mk("div", { className: "wa-item-body", text: t.body })]),
          actions
        ]));
      });
    });
    while (wa.groups.firstChild) wa.groups.removeChild(wa.groups.firstChild);
    groups.forEach(function (g) { wa.groups.appendChild(mk("option", { value: g.name })); });
    wa.btnResetAll.disabled = !Object.keys(waStore.overrides).length;
  }

  function waPersist(msg) {
    waSaveStore(waStore, function (err) {
      if (err) setStatus(wa.listStatus, "Erreur : " + err.message, "err");
      else if (msg) { setStatus(wa.listStatus, msg, "ok"); setTimeout(function () { setStatus(wa.listStatus, "", "muted"); }, 2500); }
      waRenderList();
    });
  }

  function waResetOne(id) {
    delete waStore.overrides[id];
    waPersist("✓ Modèle remis par défaut");
  }

  function waDelete(id) {
    const t = waStore.custom.find(function (c) { return c.id === id; });
    if (!confirm("Supprimer le modèle « " + ((t && t.title) || "") + " » ?")) return;
    waStore.custom = waStore.custom.filter(function (c) { return c.id !== id; });
    waPersist("✓ Modèle supprimé");
  }

  function waOpenEditor(t) {
    waEditing = t ? { id: t.id, system: t.system } : { id: null, system: false };
    wa.group.value = t ? t.group : WA_CUSTOM_GROUP;
    wa.title.value = t ? t.title : "";
    wa.body.value = t ? t.body : "";
    wa.reset.hidden = !(t && t.system);
    setStatus(wa.status, t && t.system ? "Modèle du système — vous pourrez le remettre par défaut." : "", "muted");
    wa.listView.hidden = true;
    wa.editor.hidden = false;
    waUpdatePreview();
    document.getElementById("whatsapp").scrollIntoView({ behavior: "smooth", block: "start" });
    wa.body.focus();
  }

  function waCloseEditor() {
    waEditing = null;
    wa.editor.hidden = true;
    wa.listView.hidden = false;
  }

  function waUpdatePreview() {
    wa.preview.textContent = waSampleRender(wa.body.value) || "—";
  }

  WA_VARIABLES.forEach(function (v) {
    wa.vars.appendChild(mk("button", { type: "button", text: v.token, title: v.label + " — " + v.hint, onClick: function () {
      const start = wa.body.selectionStart != null ? wa.body.selectionStart : wa.body.value.length;
      const end = wa.body.selectionEnd != null ? wa.body.selectionEnd : start;
      wa.body.value = wa.body.value.slice(0, start) + v.token + wa.body.value.slice(end);
      wa.body.focus();
      wa.body.selectionStart = wa.body.selectionEnd = start + v.token.length;
      waUpdatePreview();
    } }));
  });
  wa.body.addEventListener("input", waUpdatePreview);
  el.waShopName.addEventListener("input", waUpdatePreview);
  // Le nom de la boutique s'enregistre tout seul (pas besoin du bouton du bas).
  el.waShopName.addEventListener("change", function () {
    chrome.storage.sync.set({ waShopName: el.waShopName.value.trim() });
  });

  wa.btnNew.addEventListener("click", function () { waOpenEditor(null); });
  wa.cancel.addEventListener("click", waCloseEditor);
  wa.btnResetAll.addEventListener("click", function () {
    if (!confirm("Remettre tous les modèles du système par défaut ? Vos modèles personnalisés sont conservés.")) return;
    waStore.overrides = {};
    waPersist("✓ Modèles du système remis par défaut");
  });
  wa.reset.addEventListener("click", function () {
    if (!waEditing || !waEditing.system) return;
    const d = waDefaultById(waEditing.id);
    if (!d) return;
    wa.group.value = d.group; wa.title.value = d.title; wa.body.value = d.body;
    waUpdatePreview();
    setStatus(wa.status, "Texte d'origine rétabli — cliquez sur « Enregistrer le modèle » pour valider.", "warn");
  });

  wa.save.addEventListener("click", function () {
    if (!waEditing) return;
    const group = wa.group.value.trim() || WA_CUSTOM_GROUP;
    const title = wa.title.value.trim();
    const body = wa.body.value.trim();
    if (!title) { setStatus(wa.status, "Saisissez un titre.", "warn"); return; }
    if (!body) { setStatus(wa.status, "Le message est vide.", "warn"); return; }
    if (waHasEmoji(title) || waHasEmoji(body)) { setStatus(wa.status, "Retirez les emojis : WhatsApp Desktop les affiche mal.", "warn"); return; }
    if (waEditing.system) {
      const d = waDefaultById(waEditing.id);
      if (d && d.group === group && d.title === title && d.body === body) delete waStore.overrides[waEditing.id];
      else waStore.overrides[waEditing.id] = { group: group, title: title, body: body };
    } else if (waEditing.id) {
      waStore.custom = waStore.custom.map(function (c) { return c.id === waEditing.id ? { id: c.id, group: group, title: title, body: body } : c; });
    } else {
      waStore.custom.push({ id: "custom-" + Date.now(), group: group, title: title, body: body });
    }
    waCloseEditor();
    waPersist("✓ Modèle enregistré");
  });

  function waInit() {
    waLoadStore(function (store) {
      waStore = store;
      waRenderList();
      const h = decodeURIComponent((location.hash || "").slice(1));
      if (h.indexOf("tpl=") === 0) {
        const t = waMergeTemplates(waStore).find(function (x) { return x.id === h.slice(4); });
        if (t) waOpenEditor(t);
      } else if (h === "whatsapp") {
        document.getElementById("whatsapp").scrollIntoView({ block: "start" });
      }
    });
  }

  load();
  waInit();
})();
