(function () {
  "use strict";

  var CATEGORIES = {
    support: "ИИ-автоматизация техподдержки",
    design: "Проектирование"
  };
  var MAX_IMAGE_SIDE = 1600;
  var JPEG_QUALITY = 0.85;
  var MAX_CERT_DESC = 500;
  var MAX_FILE_BYTES = 5 * 1024 * 1024;

  var config = window.MINIAPP_CONFIG || {};
  var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  function inTelegram() {
    if (!tg) return false;
    if (tg.initData) return true;
    var unsafe = tg.initDataUnsafe || {};
    if (unsafe.user || unsafe.chat || unsafe.query_id) return true;
    if (tg.platform && tg.platform !== "unknown") return true;
    return false;
  }

  var state = {
    reviews: [],
    certificates: [],
    filter: "all",
    tab: "reviews",
    outsideTelegram: !inTelegram(),
    submitting: false,
    certSubmitting: false,
    certPreparedFile: null,
    user: null
  };

  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function haptic(type) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (type === "success") tg.HapticFeedback.notificationOccurred("success");
      else if (type === "error") tg.HapticFeedback.notificationOccurred("error");
      else tg.HapticFeedback.impactOccurred(type || "light");
    } catch (e) {}
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(iso) {
    try {
      return new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Amsterdam"
      }).format(new Date(iso));
    } catch (e) {
      return "";
    }
  }

  function starsHtml(count) {
    var n = Math.max(0, Math.min(5, Number(count) || 0));
    var html = "";
    for (var i = 1; i <= 5; i++) {
      html += '<span class="' + (i <= n ? "" : "star-empty") + '">★</span>';
    }
    return html;
  }

  function backendUrl() {
    return String(config.APPS_SCRIPT_URL || "").trim();
  }

  function telegramHandle() {
    return String(config.TELEGRAM_USERNAME || "").replace(/^@/, "").trim();
  }

  function telegramHref() {
    var handle = telegramHandle();
    return handle ? "https://t.me/" + encodeURIComponent(handle) : "";
  }

  function ownerTelegramId() {
    return String(config.OWNER_TELEGRAM_ID || "").trim();
  }

  function isOwner() {
    var expected = ownerTelegramId();
    if (!expected) return false;
    var user = state.user || (tg && tg.initDataUnsafe && tg.initDataUnsafe.user);
    if (!user || user.id == null || user.id === "") return false;
    return String(user.id) === expected;
  }

  function initDataString() {
    return tg && tg.initData ? String(tg.initData) : "";
  }

  function openTelegramLink(url, event) {
    if (!url) return;
    if (event) event.preventDefault();
    if (inTelegram() && tg && typeof tg.openTelegramLink === "function") {
      try {
        tg.openTelegramLink(url);
        return;
      } catch (e) {}
    }
    window.open(url, "_blank", "noopener");
  }

  function openExternalLink(url, event) {
    if (!url) return;
    if (event) event.preventDefault();
    if (inTelegram() && tg && typeof tg.openLink === "function") {
      try {
        tg.openLink(url);
        return;
      } catch (e) {}
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function applyTheme() {
    if (!inTelegram()) {
      document.documentElement.setAttribute("data-theme", "dark");
      return;
    }
    var scheme = tg.colorScheme || "dark";
    document.documentElement.setAttribute("data-theme", scheme);
    try {
      tg.setHeaderColor(scheme === "dark" ? "#0b0f17" : "#f3f5fb");
      tg.setBackgroundColor(tg.themeParams.bg_color || (scheme === "dark" ? "#0b0f17" : "#f3f5fb"));
    } catch (e) {}
  }

  function updateMainButton() {
    if (!inTelegram() || !tg || !tg.MainButton) return;
    try {
      if (state.tab === "reviews") {
        tg.MainButton.setText("Отправить отзыв");
        tg.MainButton.show();
      } else {
        tg.MainButton.hide();
      }
    } catch (e) {}
  }

  function initTelegram() {
    if (!inTelegram()) {
      applyTheme();
      updateOwnerUi();
      return;
    }
    tg.ready();
    tg.expand();
    applyTheme();
    document.body.classList.add("is-telegram");
    var user = tg.initDataUnsafe && tg.initDataUnsafe.user;
    if (user) {
      state.user = user;
      state.outsideTelegram = false;
      var fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
      if (fullName && els.nameInput && !els.nameInput.value) {
        els.nameInput.value = fullName;
      }
    }
    if (tg.MainButton) {
      tg.MainButton.setText("Отправить отзыв");
      tg.MainButton.onClick(function () {
        submitForm();
      });
    }
    if (tg.onEvent) {
      tg.onEvent("themeChanged", applyTheme);
    }
    updateOwnerUi();
    updateMainButton();
  }

  function initials(name) {
    var parts = String(name || "AI").trim().split(/\s+/);
    var letters = (parts[0] || "A").charAt(0);
    if (parts[1]) letters += parts[1].charAt(0);
    return letters.toUpperCase();
  }

  function renderHero() {
    var name = config.OWNER_NAME || "Ваше имя";
    els.ownerName.textContent = name;
    els.ownerTagline.textContent = config.OWNER_TITLE || config.OWNER_TAGLINE || "";
    els.ownerAvatar.textContent = initials(name);
    var href = telegramHref();
    if (href) {
      var handle = telegramHandle();
      els.contactLink.hidden = false;
      els.contactLink.href = href;
      els.contactLink.textContent = "Написать @" + handle;
    }
    if (backendUrl()) {
      els.formIntro.textContent = "Коротко расскажите, как прошла работа. Отзыв появится после проверки.";
    } else {
      els.formIntro.textContent = "Коротко расскажите, как прошла работа.";
    }
  }

  function setBanner(text, warn) {
    if (!text) {
      els.statusBanner.hidden = true;
      els.statusBanner.textContent = "";
      return;
    }
    els.statusBanner.hidden = false;
    els.statusBanner.textContent = text;
    els.statusBanner.classList.toggle("is-warn", !!warn);
  }

  function setCertsBanner(text, warn) {
    if (!els.certsBanner) return;
    if (!text) {
      els.certsBanner.hidden = true;
      els.certsBanner.textContent = "";
      return;
    }
    els.certsBanner.hidden = false;
    els.certsBanner.textContent = text;
    els.certsBanner.classList.toggle("is-warn", !!warn);
  }

  function computeStats(reviews) {
    if (!reviews.length) {
      return { avg: 0, count: 0, bars: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } };
    }
    var bars = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    var sum = 0;
    reviews.forEach(function (r) {
      var s = Math.max(1, Math.min(5, Number(r.stars) || 0));
      bars[s] += 1;
      sum += s;
    });
    return { avg: sum / reviews.length, count: reviews.length, bars: bars };
  }

  function renderRating(reviews) {
    var stats = computeStats(reviews);
    var panel = els.ratingPanel;
    if (!stats.count) {
      if (panel) panel.classList.add("is-empty");
      els.avgScore.textContent = "—";
      els.avgStars.innerHTML = "";
      els.avgStars.hidden = true;
      els.ratingCount.textContent = "Пока нет оценок";
      els.ratingBars.hidden = true;
      els.ratingBars.innerHTML = "";
      return;
    }
    if (panel) panel.classList.remove("is-empty");
    els.avgScore.textContent = stats.avg.toFixed(1).replace(".", ",");
    els.avgStars.hidden = false;
    els.avgStars.innerHTML = starsHtml(Math.round(stats.avg));
    els.ratingCount.textContent =
      stats.count + " " + plural(stats.count, "отзыв", "отзыва", "отзывов");
    var html = "";
    for (var i = 5; i >= 1; i--) {
      var pct = Math.round((stats.bars[i] / stats.count) * 100);
      html +=
        '<div class="bar-row"><span>' +
        i +
        '</span><div class="bar-track"><div class="bar-fill" style="width:' +
        pct +
        '%"></div></div><span>' +
        stats.bars[i] +
        "</span></div>";
    }
    els.ratingBars.innerHTML = html;
    els.ratingBars.hidden = false;
  }

  function plural(n, one, few, many) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function renderEmptyState(filteredCount, totalCount) {
    if (filteredCount) {
      els.emptyState.hidden = true;
      return;
    }
    els.emptyState.hidden = false;
    if (totalCount === 0) {
      els.emptyTitle.textContent = "Отзывов пока нет — станьте первым!";
      els.emptyText.textContent = "Расскажите, как прошла совместная работа.";
    } else {
      els.emptyTitle.textContent = "В этой категории пока нет отзывов";
      els.emptyText.textContent = "Можно выбрать другой фильтр или оставить свой отзыв.";
    }
  }

  function renderReviews() {
    var filtered = state.reviews.filter(function (r) {
      return state.filter === "all" || r.category === state.filter;
    });
    renderRating(state.reviews);
    if (!filtered.length) {
      els.reviewList.innerHTML = "";
      renderEmptyState(0, state.reviews.length);
      return;
    }
    renderEmptyState(filtered.length, state.reviews.length);
    els.reviewList.innerHTML = filtered
      .map(function (r, index) {
        return (
          '<article class="review-card" style="animation-delay:' +
          index * 40 +
          'ms">' +
          '<div class="review-head">' +
          "<div><div class=\"review-name\">" +
          escapeHtml(r.name) +
          "</div><div class=\"review-date\">" +
          escapeHtml(formatDate(r.createdAt)) +
          "</div></div>" +
          '<div class="review-stars" aria-label="' +
          Number(r.stars) +
          ' из 5">' +
          starsHtml(r.stars) +
          "</div>" +
          "</div>" +
          '<div><span class="badge">' +
          escapeHtml(CATEGORIES[r.category] || r.category) +
          "</span></div>" +
          '<p class="review-text">' +
          escapeHtml(r.text) +
          "</p>" +
          "</article>"
        );
      })
      .join("");
  }

  function setFilter(next) {
    state.filter = next;
    document.querySelectorAll(".chip").forEach(function (btn) {
      var active = btn.getAttribute("data-filter") === next;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    renderReviews();
    haptic("light");
  }

  function setStars(value) {
    var stars = Math.max(1, Math.min(5, Number(value) || 5));
    els.starsInput.value = String(stars);
    document.querySelectorAll("#starPicker button").forEach(function (btn) {
      btn.classList.toggle("is-on", Number(btn.getAttribute("data-star")) <= stars);
    });
  }

  function updateCharCount() {
    var max = Number(config.MAX_REVIEW_LENGTH || 1000);
    var len = (els.textInput.value || "").trim().length;
    els.charCount.textContent = len + " / " + max;
  }

  function updateCertDescCount() {
    if (!els.certDescCount) return;
    var len = (els.certDescInput.value || "").trim().length;
    els.certDescCount.textContent = len + " / " + MAX_CERT_DESC;
  }

  function showFormMessage(okText, errText, okHtml) {
    els.formOk.hidden = !(okText || okHtml);
    els.formError.hidden = !errText;
    if (okHtml) {
      els.formOk.innerHTML = okHtml;
    } else {
      els.formOk.textContent = okText || "";
    }
    els.formError.textContent = errText || "";
  }

  function showCertFormMessage(okText, errText) {
    if (!els.certFormOk) return;
    els.certFormOk.hidden = !okText;
    els.certFormError.hidden = !errText;
    els.certFormOk.textContent = okText || "";
    els.certFormError.textContent = errText || "";
  }

  function thanksWithoutBackendHtml() {
    var href = telegramHref();
    var html = "Спасибо! Приём отзывов скоро заработает";
    if (!href) return html + ".";
    return (
      html +
      ", а пока можно <a href=\"" +
      escapeHtml(href) +
      "\" class=\"form-tg-link\" id=\"formTgLink\">написать мне в Telegram</a>."
    );
  }

  function bindFormTelegramLink() {
    var link = $("formTgLink");
    if (!link) return;
    link.addEventListener("click", function (event) {
      openTelegramLink(link.href, event);
    });
  }

  function validate(payload) {
    var min = Number(config.MIN_REVIEW_LENGTH || 10);
    var max = Number(config.MAX_REVIEW_LENGTH || 1000);
    if (!payload.name || payload.name.length < 2) return "Укажите имя — хотя бы пару букв.";
    if (payload.name.length > 80) return "Имя слишком длинное.";
    if (!(payload.stars >= 1 && payload.stars <= 5)) return "Выберите оценку от 1 до 5.";
    if (!CATEGORIES[payload.category]) return "Выберите направление работы.";
    if (!payload.text || payload.text.length < min) {
      return "Напишите отзыв чуть подробнее — минимум " + min + " символов.";
    }
    if (payload.text.length > max) return "Отзыв длиннее " + max + " символов. Сократите текст.";
    return "";
  }

  function collectPayload() {
    var categoryEl = document.querySelector('input[name="category"]:checked');
    return {
      name: (els.nameInput.value || "").trim(),
      stars: Number(els.starsInput.value || 5),
      category: categoryEl ? categoryEl.value : "support",
      text: (els.textInput.value || "").trim(),
      telegramId: state.user && state.user.id ? String(state.user.id) : "",
      telegramUsername: state.user && state.user.username ? String(state.user.username) : "",
      initData: initDataString()
    };
  }

  function parseResponse(res) {
    if (!res) return null;
    if (res.reviews || res.certificates) return res;
    if (res.data && (res.data.reviews || res.data.certificates)) return res.data;
    return res;
  }

  function normalizeReviews(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(function (r) {
        return {
          id: String(r.id || r.createdAt || Math.random()),
          name: String(r.name || "Клиент"),
          stars: Number(r.stars) || 0,
          category: r.category === "design" ? "design" : "support",
          text: String(r.text || ""),
          createdAt: r.createdAt || r.date || new Date().toISOString()
        };
      })
      .sort(function (a, b) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
  }

  function normalizeCertificates(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(function (c) {
        var imageUrl = String(c.imageUrl || c.image_url || "");
        var isPdf = c.isPdf === true || /\/file\/d\//.test(imageUrl) || /\.pdf($|\?)/i.test(imageUrl);
        return {
          id: String(c.id || ""),
          title: String(c.title || ""),
          issuer: String(c.issuer || ""),
          year: String(c.year || ""),
          description: String(c.description || ""),
          link: String(c.link || ""),
          imageUrl: imageUrl,
          imageFileId: String(c.imageFileId || c.image_file_id || ""),
          isPdf: isPdf,
          createdAt: c.createdAt || c.created_at || ""
        };
      })
      .filter(function (c) {
        return !!c.id;
      })
      .sort(function (a, b) {
        var yearDiff = (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0);
        if (yearDiff) return yearDiff;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
  }

  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var cbName = "__miniapp_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error("timeout"));
      }, 12000);
      var script;
      function cleanup() {
        clearTimeout(timer);
        delete window[cbName];
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }
      window[cbName] = function (data) {
        cleanup();
        resolve(data);
      };
      script = document.createElement("script");
      var join = url.indexOf("?") === -1 ? "?" : "&";
      script.src = url + join + "callback=" + encodeURIComponent(cbName);
      script.onerror = function () {
        cleanup();
        reject(new Error("jsonp failed"));
      };
      document.head.appendChild(script);
    });
  }

  function withQuery(url, params) {
    var parts = [];
    Object.keys(params).forEach(function (key) {
      if (params[key] == null || params[key] === "") return;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(params[key]));
    });
    if (!parts.length) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + parts.join("&");
  }

  function loadReviews() {
    var url = backendUrl();
    els.reviewList.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    els.emptyState.hidden = true;
    if (!url) {
      state.reviews = [];
      setBanner("");
      renderReviews();
      return Promise.resolve();
    }
    return fetch(url, { method: "GET", credentials: "omit" })
      .then(function (r) {
        if (!r.ok) throw new Error("bad status");
        return r.json();
      })
      .then(applyBackendReviews)
      .catch(function () {
        return jsonp(url).then(applyBackendReviews);
      })
      .catch(function () {
        state.reviews = [];
        setBanner("Не удалось загрузить отзывы. Попробуйте открыть страницу ещё раз чуть позже.", true);
        renderReviews();
      });
  }

  function applyBackendReviews(payload) {
    var data = parseResponse(payload) || {};
    if (data.ok === false) throw new Error(data.error || "fail");
    state.reviews = normalizeReviews(data.reviews || []);
    setBanner("");
    renderReviews();
  }

  function loadCertificates() {
    var url = backendUrl();
    if (!els.certsGrid) return Promise.resolve();
    els.certsGrid.innerHTML = '<div class="skeleton"></div>';
    if (els.certsEmpty) els.certsEmpty.hidden = true;
    if (!url) {
      state.certificates = [];
      setCertsBanner("");
      renderCertificates();
      return Promise.resolve();
    }
    var certUrl = withQuery(url, { type: "certificates" });
    return fetch(certUrl, { method: "GET", credentials: "omit" })
      .then(function (r) {
        if (!r.ok) throw new Error("bad status");
        return r.json();
      })
      .then(applyBackendCertificates)
      .catch(function () {
        return jsonp(certUrl).then(applyBackendCertificates);
      })
      .catch(function () {
        state.certificates = [];
        setCertsBanner("Не удалось загрузить сертификаты. Попробуйте открыть вкладку ещё раз чуть позже.", true);
        renderCertificates();
      });
  }

  function applyBackendCertificates(payload) {
    var data = parseResponse(payload) || {};
    if (data.ok === false) throw new Error(data.error || "fail");
    state.certificates = normalizeCertificates(data.certificates || []);
    setCertsBanner("");
    renderCertificates();
  }

  function updateOwnerUi() {
    var owner = isOwner();
    var hasBackend = !!backendUrl();
    if (els.addCertBtn) {
      els.addCertBtn.hidden = !owner;
    }
    if (els.certsBackendHint) {
      els.certsBackendHint.hidden = !(owner && !hasBackend);
    }
    if (els.certsEmptyCta) {
      els.certsEmptyCta.hidden = !(owner && hasBackend);
    }
    if (owner && !hasBackend && els.certFormSection) {
      hideCertForm();
    }
    if (!owner && els.certFormSection) {
      hideCertForm();
    }
  }

  function pdfPlaceholderHtml() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="M7 3.5h7.2L18.5 8v11.5A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 7 3.5Z" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M14.2 3.6V8h4.2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M8.5 12.5h7M8.5 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      "</svg><span>PDF</span>"
    );
  }

  function renderCertificates() {
    updateOwnerUi();
    var list = state.certificates;
    var owner = isOwner();
    if (!list.length) {
      els.certsGrid.innerHTML = "";
      if (els.certsEmpty) els.certsEmpty.hidden = false;
      return;
    }
    if (els.certsEmpty) els.certsEmpty.hidden = true;
    els.certsGrid.innerHTML = list
      .map(function (c, index) {
        var meta = [c.issuer, c.year].filter(Boolean).map(escapeHtml).join(" · ");
        var thumb;
        if (c.isPdf) {
          thumb =
            '<button type="button" class="cert-thumb-pdf" data-open-link="' +
            escapeHtml(c.imageUrl || c.link || "") +
            '">' +
            pdfPlaceholderHtml() +
            "</button>";
        } else {
          thumb =
            '<img class="cert-thumb" src="' +
            escapeHtml(c.imageUrl) +
            '" alt="' +
            escapeHtml(c.title) +
            '" data-full="' +
            escapeHtml(c.imageUrl) +
            '">';
        }
        var desc = c.description
          ? '<p class="cert-desc">' + escapeHtml(c.description) + "</p>"
          : "";
        var link = c.link
          ? '<a class="cert-link" href="' +
            escapeHtml(c.link) +
            '" target="_blank" rel="noopener noreferrer">Открыть ссылку</a>'
          : "";
        var del = owner
          ? '<button type="button" class="cert-delete" data-delete-id="' +
            escapeHtml(c.id) +
            '" data-delete-title="' +
            escapeHtml(c.title) +
            '">Удалить</button>'
          : "";
        return (
          '<article class="cert-card" style="animation-delay:' +
          index * 40 +
          'ms">' +
          thumb +
          '<div class="cert-body">' +
          '<div class="cert-title">' +
          escapeHtml(c.title) +
          "</div>" +
          (meta ? '<div class="cert-meta">' + meta + "</div>" : "") +
          desc +
          link +
          del +
          "</div></article>"
        );
      })
      .join("");
  }

  function setTab(next, options) {
    options = options || {};
    var tab = next === "certificates" ? "certificates" : "reviews";
    state.tab = tab;
    document.querySelectorAll(".main-tab").forEach(function (btn) {
      var active = btn.getAttribute("data-tab") === tab;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (els.panelReviews) els.panelReviews.hidden = tab !== "reviews";
    if (els.panelCertificates) els.panelCertificates.hidden = tab !== "certificates";
    if (!options.skipHash) {
      var hash = tab === "certificates" ? "#certificates" : "#reviews";
      if (location.hash !== hash) {
        if (history.replaceState) history.replaceState(null, "", hash);
        else location.hash = hash;
      }
    }
    if (tab === "reviews") {
      if (els.statusBanner && els.statusBanner.textContent) els.statusBanner.hidden = false;
    } else {
      if (els.statusBanner) els.statusBanner.hidden = true;
    }
    updateMainButton();
    if (!options.silent) haptic("light");
  }

  function tabFromHash() {
    var hash = (location.hash || "").replace(/^#/, "");
    return hash === "certificates" ? "certificates" : "reviews";
  }

  function openLightbox(src, alt) {
    if (!els.lightbox || !els.lightboxImage || !src) return;
    els.lightboxImage.src = src;
    els.lightboxImage.alt = alt || "";
    els.lightbox.hidden = false;
    document.body.classList.add("lightbox-open");
  }

  function closeLightbox() {
    if (!els.lightbox) return;
    els.lightbox.hidden = true;
    if (els.lightboxImage) els.lightboxImage.src = "";
    document.body.classList.remove("lightbox-open");
  }

  function postJson(payload) {
    var url = backendUrl();
    var body = JSON.stringify(payload);
    return fetch(url, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: body
    }).then(function (r) {
      return r.json().catch(function () {
        return { ok: true, assumed: true };
      });
    }).then(function (data) {
      if (data && data.ok === false) {
        var err = new Error(data.error || "Не удалось выполнить запрос");
        err.server = true;
        throw err;
      }
      return data || { ok: true };
    }).catch(function (err) {
      if (err && err.server) throw err;
      return fetch(url, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: body
      }).then(function () {
        return { ok: true, opaque: true };
      });
    });
  }

  function postReview(payload) {
    return postJson(payload);
  }

  function resetFormFields() {
    els.reviewForm.reset();
    if (state.user) {
      var fullName = [state.user.first_name, state.user.last_name].filter(Boolean).join(" ");
      els.nameInput.value = fullName;
    }
    setStars(5);
    updateCharCount();
  }

  function submitForm(event) {
    if (event) event.preventDefault();
    if (state.tab !== "reviews") return;
    if (state.submitting) return;
    showFormMessage("", "");
    var payload = collectPayload();
    var error = validate(payload);
    if (error) {
      showFormMessage("", error);
      haptic("error");
      return;
    }
    state.submitting = true;
    els.submitBtn.disabled = true;
    if (tg && tg.MainButton) {
      tg.MainButton.showProgress();
      tg.MainButton.disable();
    }

    var finish = function (okText, errText, okHtml) {
      state.submitting = false;
      els.submitBtn.disabled = false;
      if (tg && tg.MainButton) {
        tg.MainButton.hideProgress();
        tg.MainButton.enable();
      }
      showFormMessage(okText, errText, okHtml);
      if (okHtml) bindFormTelegramLink();
      haptic(okText || okHtml ? "success" : "error");
    };

    if (!backendUrl()) {
      resetFormFields();
      finish("", "", thanksWithoutBackendHtml());
      return;
    }

    postReview(payload)
      .then(function () {
        resetFormFields();
        finish("Спасибо! Отзыв отправлен на проверку и появится на витрине после одобрения.", "");
      })
      .catch(function (err) {
        finish("", (err && err.message) || "Не удалось отправить отзыв. Попробуйте ещё раз чуть позже.");
      });
  }

  function scrollToForm() {
    var section = $("reviewFormSection");
    if (section && section.scrollIntoView) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (els.nameInput) {
      try {
        els.nameInput.focus({ preventScroll: true });
      } catch (e) {
        els.nameInput.focus();
      }
    }
    haptic("light");
  }

  function currentYear() {
    return new Date().getFullYear();
  }

  function showCertForm() {
    if (!isOwner()) return;
    if (!backendUrl()) {
      updateOwnerUi();
      if (els.certsBackendHint) {
        els.certsBackendHint.hidden = false;
        if (els.certsBackendHint.scrollIntoView) {
          els.certsBackendHint.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      return;
    }
    if (els.certFormSection) els.certFormSection.hidden = false;
    if (!els.certYearInput.value) els.certYearInput.value = String(currentYear());
    showCertFormMessage("", "");
    if (els.certFormSection && els.certFormSection.scrollIntoView) {
      els.certFormSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (els.certTitleInput) {
      try {
        els.certTitleInput.focus({ preventScroll: true });
      } catch (e) {
        els.certTitleInput.focus();
      }
    }
    haptic("light");
  }

  function hideCertForm() {
    if (els.certFormSection) els.certFormSection.hidden = true;
    resetCertForm();
  }

  function resetCertForm() {
    if (!els.certForm) return;
    els.certForm.reset();
    if (els.certYearInput) els.certYearInput.value = String(currentYear());
    state.certPreparedFile = null;
    if (els.certFileLabel) els.certFileLabel.textContent = "Выберите фото или PDF";
    if (els.certPreview) els.certPreview.hidden = true;
    if (els.certPreviewImg) {
      els.certPreviewImg.removeAttribute("src");
      els.certPreviewImg.hidden = true;
    }
    if (els.certPreviewPdf) {
      els.certPreviewPdf.hidden = true;
      els.certPreviewPdf.textContent = "";
    }
    updateCertDescCount();
  }

  function isPdfFile(file) {
    if (!file) return false;
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("Не удалось прочитать файл"));
      };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("Не удалось открыть изображение"));
      };
      img.src = url;
    });
  }

  function canvasToJpeg(canvas, quality) {
    return canvas.toDataURL("image/jpeg", quality);
  }

  function prepareImageFile(file) {
    var objectUrl = URL.createObjectURL(file);
    return loadImage(objectUrl)
      .then(function (img) {
        var width = img.naturalWidth || img.width;
        var height = img.naturalHeight || img.height;
        if (!width || !height) throw new Error("Не удалось открыть изображение");
        var scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
        var w = Math.max(1, Math.round(width * scale));
        var h = Math.max(1, Math.round(height * scale));
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(objectUrl);
        var dataUrl = canvasToJpeg(canvas, JPEG_QUALITY);
        var base64 = dataUrl.split(",")[1] || "";
        var approxBytes = Math.ceil((base64.length * 3) / 4);
        if (approxBytes > MAX_FILE_BYTES) {
          throw new Error("Файл слишком большой. Выберите другое фото.");
        }
        var name = String(file.name || "certificate").replace(/\.[a-z0-9]+$/i, "") + ".jpg";
        return {
          base64: base64,
          mime: "image/jpeg",
          name: name,
          isPdf: false,
          previewUrl: dataUrl
        };
      })
      .catch(function (err) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (e) {}
        throw err;
      });
  }

  function preparePdfFile(file) {
    if (file.size > MAX_FILE_BYTES) {
      return Promise.reject(new Error("PDF больше 5 МБ. Выберите файл поменьше."));
    }
    return readFileAsDataUrl(file).then(function (dataUrl) {
      var base64 = String(dataUrl).split(",")[1] || "";
      return {
        base64: base64,
        mime: "application/pdf",
        name: file.name || "certificate.pdf",
        isPdf: true,
        previewUrl: ""
      };
    });
  }

  function handleCertFileChange() {
    var file = els.certFileInput && els.certFileInput.files && els.certFileInput.files[0];
    state.certPreparedFile = null;
    if (els.certPreview) els.certPreview.hidden = true;
    if (!file) {
      if (els.certFileLabel) els.certFileLabel.textContent = "Выберите фото или PDF";
      return;
    }
    if (els.certFileLabel) els.certFileLabel.textContent = file.name;
    showCertFormMessage("", "");
    var work = isPdfFile(file) ? preparePdfFile(file) : prepareImageFile(file);
    work
      .then(function (prepared) {
        state.certPreparedFile = prepared;
        if (els.certPreview) els.certPreview.hidden = false;
        if (prepared.isPdf) {
          if (els.certPreviewImg) {
            els.certPreviewImg.hidden = true;
            els.certPreviewImg.removeAttribute("src");
          }
          if (els.certPreviewPdf) {
            els.certPreviewPdf.hidden = false;
            els.certPreviewPdf.textContent = "PDF · " + prepared.name;
          }
        } else {
          if (els.certPreviewPdf) els.certPreviewPdf.hidden = true;
          if (els.certPreviewImg) {
            els.certPreviewImg.hidden = false;
            els.certPreviewImg.src = prepared.previewUrl;
          }
        }
      })
      .catch(function (err) {
        if (els.certFileInput) els.certFileInput.value = "";
        if (els.certFileLabel) els.certFileLabel.textContent = "Выберите фото или PDF";
        showCertFormMessage("", (err && err.message) || "Не удалось обработать файл.");
        haptic("error");
      });
  }

  function validateCertificate() {
    var title = (els.certTitleInput.value || "").trim();
    var issuer = (els.certIssuerInput.value || "").trim();
    var year = parseInt(els.certYearInput.value, 10);
    var description = (els.certDescInput.value || "").trim();
    var link = (els.certLinkInput.value || "").trim();
    var thisYear = currentYear();
    if (!title || title.length < 2) return "Укажите название сертификата.";
    if (title.length > 120) return "Название слишком длинное.";
    if (!issuer || issuer.length < 2) return "Укажите, кто выдал сертификат.";
    if (issuer.length > 120) return "Название организации слишком длинное.";
    if (!(year >= 1980 && year <= thisYear + 1)) return "Укажите корректный год.";
    if (description.length > MAX_CERT_DESC) return "Описание длиннее " + MAX_CERT_DESC + " символов.";
    if (link && !/^https?:\/\/[^\s]+$/i.test(link)) {
      return "Ссылка должна начинаться с http:// или https://.";
    }
    if (!state.certPreparedFile || !state.certPreparedFile.base64) {
      return "Приложите фото или PDF сертификата.";
    }
    return "";
  }

  function submitCertificate(event) {
    if (event) event.preventDefault();
    if (!isOwner()) {
      showCertFormMessage("", "Добавлять сертификаты можете только вы, из своего Telegram.");
      return;
    }
    if (!backendUrl()) {
      showCertFormMessage("", "Сначала подключите Google Apps Script — инструкция в README.");
      updateOwnerUi();
      return;
    }
    if (state.certSubmitting) return;
    showCertFormMessage("", "");
    var error = validateCertificate();
    if (error) {
      showCertFormMessage("", error);
      haptic("error");
      return;
    }
    var payload = {
      action: "addCertificate",
      initData: initDataString(),
      title: (els.certTitleInput.value || "").trim(),
      issuer: (els.certIssuerInput.value || "").trim(),
      year: parseInt(els.certYearInput.value, 10),
      description: (els.certDescInput.value || "").trim(),
      link: (els.certLinkInput.value || "").trim(),
      imageBase64: state.certPreparedFile.base64,
      imageMime: state.certPreparedFile.mime,
      imageName: state.certPreparedFile.name
    };
    if (!payload.initData) {
      showCertFormMessage("", "Откройте Mini App из Telegram, чтобы подтвердить, что это вы.");
      haptic("error");
      return;
    }
    state.certSubmitting = true;
    els.certSubmitBtn.disabled = true;
    postJson(payload)
      .then(function (data) {
        resetCertForm();
        showCertFormMessage("Сертификат добавлен.", "");
        haptic("success");
        if (data && data.certificate) {
          var next = normalizeCertificates([data.certificate].concat(state.certificates));
          state.certificates = next;
          renderCertificates();
        } else {
          return loadCertificates();
        }
      })
      .catch(function (err) {
        showCertFormMessage("", (err && err.message) || "Не удалось сохранить сертификат. Попробуйте ещё раз.");
        haptic("error");
      })
      .then(function () {
        state.certSubmitting = false;
        if (els.certSubmitBtn) els.certSubmitBtn.disabled = false;
      });
  }

  function deleteCertificate(id, title) {
    if (!isOwner()) return;
    if (!backendUrl()) return;
    var ok = window.confirm('Удалить сертификат «' + (title || "") + '»?');
    if (!ok) return;
    var payload = {
      action: "deleteCertificate",
      initData: initDataString(),
      id: id
    };
    if (!payload.initData) {
      setCertsBanner("Откройте Mini App из Telegram, чтобы удалить сертификат.", true);
      return;
    }
    postJson(payload)
      .then(function () {
        state.certificates = state.certificates.filter(function (c) {
          return c.id !== id;
        });
        renderCertificates();
        haptic("success");
      })
      .catch(function (err) {
        setCertsBanner((err && err.message) || "Не удалось удалить сертификат.", true);
        haptic("error");
      });
  }

  function cacheElements() {
    [
      "ownerAvatar",
      "ownerName",
      "ownerTagline",
      "ratingPanel",
      "avgScore",
      "avgStars",
      "ratingCount",
      "ratingBars",
      "statusBanner",
      "reviewList",
      "emptyState",
      "emptyTitle",
      "emptyText",
      "emptyCta",
      "reviewForm",
      "formIntro",
      "nameInput",
      "starPicker",
      "starsInput",
      "textInput",
      "charCount",
      "formError",
      "formOk",
      "submitBtn",
      "footerNote",
      "contactLink",
      "tabReviews",
      "tabCertificates",
      "panelReviews",
      "panelCertificates",
      "addCertBtn",
      "certsBackendHint",
      "certsBanner",
      "certsGrid",
      "certsEmpty",
      "certsEmptyCta",
      "certFormSection",
      "certForm",
      "certTitleInput",
      "certIssuerInput",
      "certYearInput",
      "certDescInput",
      "certDescCount",
      "certLinkInput",
      "certFileInput",
      "certFileLabel",
      "certPreview",
      "certPreviewImg",
      "certPreviewPdf",
      "certFormError",
      "certFormOk",
      "certSubmitBtn",
      "certCancelBtn",
      "lightbox",
      "lightboxClose",
      "lightboxImage"
    ].forEach(function (id) {
      els[id] = $(id);
    });
  }

  function bindEvents() {
    document.querySelectorAll(".chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setFilter(btn.getAttribute("data-filter"));
      });
    });
    document.querySelectorAll(".main-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTab(btn.getAttribute("data-tab"));
      });
    });
    document.querySelectorAll("#starPicker button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setStars(btn.getAttribute("data-star"));
        haptic("light");
      });
    });
    els.textInput.addEventListener("input", updateCharCount);
    els.reviewForm.addEventListener("submit", submitForm);
    if (els.emptyCta) {
      els.emptyCta.addEventListener("click", scrollToForm);
    }
    if (els.contactLink) {
      els.contactLink.addEventListener("click", function (event) {
        openTelegramLink(els.contactLink.href, event);
      });
    }
    if (els.addCertBtn) {
      els.addCertBtn.addEventListener("click", showCertForm);
    }
    if (els.certsEmptyCta) {
      els.certsEmptyCta.addEventListener("click", showCertForm);
    }
    if (els.certForm) {
      els.certForm.addEventListener("submit", submitCertificate);
    }
    if (els.certCancelBtn) {
      els.certCancelBtn.addEventListener("click", hideCertForm);
    }
    if (els.certFileInput) {
      els.certFileInput.addEventListener("change", handleCertFileChange);
    }
    if (els.certDescInput) {
      els.certDescInput.addEventListener("input", updateCertDescCount);
    }
    if (els.certsGrid) {
      els.certsGrid.addEventListener("click", function (event) {
        var thumb = event.target.closest && event.target.closest(".cert-thumb");
        if (thumb) {
          openLightbox(thumb.getAttribute("data-full") || thumb.src, thumb.getAttribute("alt"));
          return;
        }
        var pdfBtn = event.target.closest && event.target.closest("[data-open-link]");
        if (pdfBtn) {
          openExternalLink(pdfBtn.getAttribute("data-open-link"), event);
          return;
        }
        var link = event.target.closest && event.target.closest(".cert-link");
        if (link) {
          openExternalLink(link.href, event);
          return;
        }
        var del = event.target.closest && event.target.closest("[data-delete-id]");
        if (del) {
          deleteCertificate(del.getAttribute("data-delete-id"), del.getAttribute("data-delete-title"));
        }
      });
    }
    if (els.lightboxClose) {
      els.lightboxClose.addEventListener("click", function (event) {
        event.stopPropagation();
        closeLightbox();
      });
    }
    if (els.lightbox) {
      els.lightbox.addEventListener("click", function (event) {
        if (event.target === els.lightbox) closeLightbox();
      });
    }
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeLightbox();
    });
    window.addEventListener("hashchange", function () {
      setTab(tabFromHash(), { skipHash: true, silent: true });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    cacheElements();
    renderHero();
    setStars(5);
    updateCharCount();
    if (els.certYearInput) els.certYearInput.value = String(currentYear());
    updateCertDescCount();
    bindEvents();
    initTelegram();
    setTab(tabFromHash(), { skipHash: true, silent: true });
    loadReviews();
    loadCertificates();
  });
})();
