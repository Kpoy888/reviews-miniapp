(function () {
  "use strict";

  var CATEGORIES = {
    support: "ИИ-автоматизация техподдержки",
    design: "Проектирование"
  };

  var DEMO_REVIEWS = [
    {
      id: "demo-1",
      name: "Мария К.",
      stars: 5,
      category: "support",
      text: "Настроили ИИ-ассистента для первой линии поддержки. Типовые вопросы теперь закрываются автоматически, команда занимается сложными кейсами. Запуск прошёл спокойно и по делу.",
      createdAt: "2026-09-18T10:00:00.000Z",
      demo: true
    },
    {
      id: "demo-2",
      name: "Игорь С.",
      stars: 5,
      category: "design",
      text: "Помогли спроектировать логику сервиса и интерфейс кабинета. Всё разложили по шагам, без воды, в итоге команда сразу поняла, что внедрять.",
      createdAt: "2026-08-03T10:00:00.000Z",
      demo: true
    },
    {
      id: "demo-3",
      name: "Анна П.",
      stars: 4,
      category: "support",
      text: "Автоматизировали ответы в Telegram и почте. После доработки сценариев качество ответов заметно выросло, нагрузка на ночные смены снизилась.",
      createdAt: "2026-07-21T10:00:00.000Z",
      demo: true
    },
    {
      id: "demo-4",
      name: "Денис Л.",
      stars: 5,
      category: "design",
      text: "Заказывали проектирование внутреннего процесса и схемы интеграций. Документация получилась понятной, по ней уже собрали рабочий прототип.",
      createdAt: "2026-06-12T10:00:00.000Z",
      demo: true
    }
  ];

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
    demo: true,
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
        timeZone: "Europe/Berlin"
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
    if (config.TELEGRAM_USERNAME) {
      var handle = String(config.TELEGRAM_USERNAME).replace(/^@/, "");
      els.contactLink.hidden = false;
      els.contactLink.href = "https://t.me/" + encodeURIComponent(handle);
      els.contactLink.textContent = "Написать @" + handle;
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
    if (!stats.count) {
      els.avgScore.textContent = "—";
      els.avgStars.innerHTML = starsHtml(0);
      els.ratingCount.textContent = "Пока нет опубликованных отзывов";
      els.ratingBars.hidden = true;
      els.ratingBars.innerHTML = "";
      return;
    }
    els.avgScore.textContent = stats.avg.toFixed(1).replace(".", ",");
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

  function renderReviews() {
    var filtered = state.reviews.filter(function (r) {
      return state.filter === "all" || r.category === state.filter;
    });
    renderRating(state.reviews);
    if (!filtered.length) {
      els.reviewList.innerHTML = "";
      els.emptyState.hidden = false;
      return;
    }
    els.emptyState.hidden = true;
    els.reviewList.innerHTML = filtered
      .map(function (r, index) {
        var demoBadge = r.demo ? '<span class="badge is-demo">пример</span>' : "";
        var localBadge = r.local ? '<span class="badge is-demo">только на этом устройстве</span>' : "";
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
          "</span>" +
          demoBadge +
          localBadge +
          "</div>" +
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

  function showFormMessage(okText, errText) {
    els.formOk.hidden = !okText;
    els.formError.hidden = !errText;
    els.formOk.textContent = okText || "";
    els.formError.textContent = errText || "";
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

  function localDemoKey() {
    return "miniapp_local_reviews_v1";
  }

  function loadLocalReviews() {
    try {
      var raw = localStorage.getItem(localDemoKey());
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalReview(review) {
    var list = loadLocalReviews();
    list.unshift(review);
    localStorage.setItem(localDemoKey(), JSON.stringify(list.slice(0, 20)));
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
          createdAt: r.createdAt || r.date || new Date().toISOString(),
          demo: !!r.demo,
          local: !!r.local
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
      function cleanup() {
        clearTimeout(timer);
        delete window[cbName];
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }
      window[cbName] = function (data) {
        cleanup();
        resolve(data);
      };
      var script = document.createElement("script");
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
    if (!url) {
      enterDemo("Показаны примеры отзывов. Чтобы публиковать настоящие, укажите URL Google Apps Script в config.js.");
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
        enterDemo(
          "Не удалось связаться с таблицей отзывов. Показаны примеры. Проверьте URL в config.js и доступ веб-приложения Apps Script.",
          true
        );
      });
  }

  function applyBackendReviews(payload) {
    var data = parseResponse(payload) || {};
    if (data.ok === false) throw new Error(data.error || "fail");
    state.demo = false;
    els.demoBadge.hidden = true;
    state.reviews = normalizeReviews(data.reviews || []);
    var parts = [];
    if (state.outsideTelegram) {
      parts.push("Вы открыли страницу в браузере. В Telegram она откроется как Mini App, с вашим именем и кнопкой отправки.");
    }
    parts.push("Новые отзывы появляются после проверки в Google-таблице.");
    setBanner(parts.join(" "));
    renderReviews();
  }

  function enterDemo(message, warn) {
    state.demo = true;
    els.demoBadge.hidden = false;
    var local = loadLocalReviews();
    state.reviews = normalizeReviews(local.concat(DEMO_REVIEWS));
    setBanner(message, warn);
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

    var finish = function (okText, errText) {
      state.submitting = false;
      els.submitBtn.disabled = false;
      if (tg && tg.MainButton) {
        tg.MainButton.hideProgress();
        tg.MainButton.enable();
      }
      showFormMessage(okText, errText);
      haptic(okText ? "success" : "error");
    };

    if (!backendUrl()) {
      saveLocalReview({
        id: "local-" + Date.now(),
        name: payload.name,
        stars: payload.stars,
        category: payload.category,
        text: payload.text,
        createdAt: new Date().toISOString(),
        local: true
      });
      state.reviews = normalizeReviews(loadLocalReviews().concat(DEMO_REVIEWS));
      renderReviews();
      els.reviewForm.reset();
      if (state.user) {
        var fullName = [state.user.first_name, state.user.last_name].filter(Boolean).join(" ");
        els.nameInput.value = fullName;
      }
      setStars(5);
      updateCharCount();
      finish(
        "В демо-режиме отзыв сохранён только на этом устройстве и помечен как локальный. Чтобы отзывы шли в таблицу и проходили модерацию, укажите URL Google Apps Script в config.js.",
        ""
      );
      return;
    }

    postReview(payload)
      .then(function () {
        els.reviewForm.reset();
        if (state.user) {
          var fullName = [state.user.first_name, state.user.last_name].filter(Boolean).join(" ");
          els.nameInput.value = fullName;
        }
        setStars(5);
        updateCharCount();
        finish("Спасибо! Отзыв отправлен на проверку и появится на витрине после одобрения.", "");
      })
      .catch(function (err) {
        finish("", (err && err.message) || "Не удалось отправить отзыв. Попробуйте ещё раз чуть позже.");
      });
  }

  function cacheElements() {
    [
      "ownerAvatar",
      "demoBadge",
      "ownerName",
      "ownerTagline",
      "avgScore",
      "avgStars",
      "ratingCount",
      "ratingBars",
      "statusBanner",
      "reviewList",
      "emptyState",
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
