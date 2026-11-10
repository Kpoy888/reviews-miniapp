(function () {
  "use strict";

  var CATEGORIES = {
    support: "ИИ-автоматизация техподдержки",
    design: "Проектирование"
  };

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
    filter: "all",
    outsideTelegram: !inTelegram(),
    submitting: false,
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

  function initTelegram() {
    if (!inTelegram()) {
      applyTheme();
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
      tg.MainButton.show();
    }
    if (tg.onEvent) {
      tg.onEvent("themeChanged", applyTheme);
    }
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
      initData: tg && tg.initData ? tg.initData : ""
    };
  }

  function parseResponse(res) {
    if (!res) return null;
    if (res.reviews) return res;
    if (res.data && res.data.reviews) return res.data;
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

  function postReview(payload) {
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
        var err = new Error(data.error || "Не удалось отправить отзыв");
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
      "contactLink"
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
  }

  document.addEventListener("DOMContentLoaded", function () {
    cacheElements();
    renderHero();
    setStars(5);
    updateCharCount();
    bindEvents();
    initTelegram();
    loadReviews();
  });
})();
