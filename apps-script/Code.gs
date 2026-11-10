/**
 * Бесплатный бэкенд витрины отзывов: Google Sheet + Apps Script.
 *
 * Как публиковать:
 * 1. Расширения → Apps Script, вставьте этот файл.
 * 2. Запустите setup() один раз и выдайте доступ к таблице.
 * 3. Развернуть → Новое развёртывание → Веб-приложение:
 *    - Выполнять от имени: Меня
 *    - У кого есть доступ: Все
 * 4. Скопируйте URL и вставьте в config.js (APPS_SCRIPT_URL).
 *
 * Модерация: в таблице столбец approved. По умолчанию FALSE.
 * Чтобы отзыв появился в Mini App, поставьте TRUE.
 */

var SHEET_NAME = 'Reviews';
var RATE_LIMIT_MINUTES = 15;
var MIN_TEXT = 10;
var MAX_TEXT = 1000;
var MAX_NAME = 80;
var CATEGORIES = {
  support: 'ИИ-автоматизация техподдержки',
  design: 'Проектирование'
};
var HEADERS = [
  'id',
  'createdAt',
  'name',
  'telegramId',
  'telegramUsername',
  'stars',
  'category',
  'text',
  'approved',
  'userAgent'
];

function setup() {
  getOrCreateSheet();
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var payload = { ok: true, reviews: getApprovedReviews() };
  return jsonOutput(payload, params.callback);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput({ ok: false, error: 'Пустой запрос' });
    }
    var data = JSON.parse(e.postData.contents);
    return jsonOutput(addReview(data, e));
  } catch (err) {
    return jsonOutput({ ok: false, error: 'Некорректные данные' });
  }
}

function getApprovedReviews() {
  var sheet = getOrCreateSheet();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var index = indexMap(headers);
  var reviews = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!isApproved(row[index.approved])) continue;
    var category = normalizeCategory(row[index.category]);
    reviews.push({
      id: String(row[index.id] || i),
      createdAt: toIso(row[index.createdAt]),
      name: String(row[index.name] || 'Клиент'),
      stars: Number(row[index.stars]) || 0,
      category: category,
      text: String(row[index.text] || '')
    });
  }
  reviews.sort(function (a, b) {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return reviews;
}

function addReview(data, e) {
  data = data || {};
  var name = sanitizeText(data.name, MAX_NAME);
  var text = sanitizeText(data.text, MAX_TEXT);
  var stars = parseInt(data.stars, 10);
  var category = normalizeCategory(data.category);
  var telegramId = sanitizeText(data.telegramId, 32);
  var telegramUsername = sanitizeText(String(data.telegramUsername || '').replace(/^@/, ''), 64);

  if (!name || name.length < 2) {
    return { ok: false, error: 'Укажите имя' };
  }
  if (!(stars >= 1 && stars <= 5)) {
    return { ok: false, error: 'Оценка должна быть от 1 до 5' };
  }
  if (!category) {
    return { ok: false, error: 'Выберите направление' };
  }
  if (!text || text.length < MIN_TEXT) {
    return { ok: false, error: 'Текст отзыва слишком короткий' };
  }
  if (text.length > MAX_TEXT) {
    return { ok: false, error: 'Текст отзыва слишком длинный' };
  }

  var rateKey = telegramId || ('anon:' + simpleHash(name + '|' + userAgentOf(e)));
  if (isRateLimited(rateKey)) {
    return {
      ok: false,
      error: 'Слишком часто. Подождите ' + RATE_LIMIT_MINUTES + ' минут перед следующим отзывом.'
    };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (isRateLimited(rateKey)) {
      return {
        ok: false,
        error: 'Слишком часто. Подождите ' + RATE_LIMIT_MINUTES + ' минут перед следующим отзывом.'
      };
    }
    var sheet = getOrCreateSheet();
    var id = Utilities.getUuid();
    var createdAt = new Date();
    sheet.appendRow([
      id,
      createdAt,
      name,
      telegramId,
      telegramUsername,
      stars,
      category,
      text,
      false,
      userAgentOf(e)
    ]);
    rememberSubmission(rateKey);
    return { ok: true, id: id, approved: false };
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Скрипт должен быть привязан к Google-таблице');
  }
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  var firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var empty = firstRow.every(function (cell) { return cell === ''; });
  if (empty) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange('I:I').insertCheckboxes();
    sheet.getRange('I1').setValue('approved').clearDataValidations();
    sheet.autoResizeColumns(1, HEADERS.length);
  }
  return sheet;
}

function indexMap(headers) {
  var map = {};
  HEADERS.forEach(function (name) {
    var idx = headers.indexOf(name);
    map[name] = idx === -1 ? HEADERS.indexOf(name) : idx;
  });
  return map;
}

function isApproved(value) {
  return value === true || value === 'TRUE' || value === 'true' || value === 1 || value === '1' || value === 'Да';
}

function normalizeCategory(value) {
  var raw = String(value || '').trim();
  if (CATEGORIES[raw]) return raw;
  if (raw === CATEGORIES.support) return 'support';
  if (raw === CATEGORIES.design) return 'design';
  return '';
}

function sanitizeText(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function userAgentOf(e) {
  try {
    return sanitizeText((e && e.userAgent) || '', 200);
  } catch (err) {
    return '';
  }
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return value.toISOString();
  }
  var parsed = new Date(value);
  if (!isNaN(parsed.getTime())) return parsed.toISOString();
  return String(value);
}

function isRateLimited(key) {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty(rateLimitKey(key)) || 0);
  return Date.now() - last < RATE_LIMIT_MINUTES * 60 * 1000;
}

function rememberSubmission(key) {
  PropertiesService.getScriptProperties().setProperty(rateLimitKey(key), String(Date.now()));
}

function rateLimitKey(key) {
  return 'rl_' + simpleHash(String(key || 'unknown'));
}

function simpleHash(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function jsonOutput(obj, callbackName) {
  var text = JSON.stringify(obj);
  if (callbackName && /^[a-zA-Z0-9_]+$/.test(callbackName)) {
    return ContentService
      .createTextOutput(callbackName + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}
