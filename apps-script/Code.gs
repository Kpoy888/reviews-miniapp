/**
 * Бесплатный бэкенд витрины: Google Sheet + Drive + Apps Script.
 *
 * Как публиковать:
 * 1. Расширения → Apps Script, вставьте этот файл.
 * 2. В настройках проекта добавьте свойство скрипта:
 *    ADMIN_PASSWORD — длинный пароль владельца (только здесь, не во фронтенде).
 * 3. Запустите setup() один раз и выдайте доступ к таблице и Google Диску.
 * 4. Развернуть → Новое развёртывание → Веб-приложение:
 *    - Выполнять от имени: Меня
 *    - У кого есть доступ: Все
 * 5. Скопируйте URL и вставьте в config.js (APPS_SCRIPT_URL).
 *    Если меняли код уже опубликованного скрипта:
 *    Развернуть → Управление развёртываниями → карандаш → Новая версия.
 *
 * Модерация отзывов: в таблице столбец approved. По умолчанию FALSE.
 * Чтобы отзыв появился на сайте, поставьте TRUE.
 *
 * Сертификаты публикуются сразу. Добавлять и удалять их может только владелец
 * после входа по паролю: сервер выдаёт сессионный токен (CacheService, 6 часов).
 *
 * Публичный URL картинки с Диска (файл доступен «всем, у кого есть ссылка»):
 *   https://drive.google.com/thumbnail?id=FILE_ID&sz=w1600
 * Запасной формат: https://lh3.googleusercontent.com/d/FILE_ID=w1600
 * Для PDF хранится ссылка вида https://drive.google.com/file/d/FILE_ID/view
 */

var SHEET_NAME = 'Reviews';
var CERT_SHEET_NAME = 'Certificates';
var CERTS_FOLDER_PROP = 'CERTS_FOLDER_ID';
var RATE_LIMIT_MINUTES = 15;
var MIN_TEXT = 10;
var MAX_TEXT = 1000;
var MAX_NAME = 80;
var MAX_FILE_BYTES = 5 * 1024 * 1024;
var SESSION_TTL_SEC = 6 * 60 * 60;
var SESSION_CACHE_PREFIX = 'sess_';
var LOGIN_FAIL_MAX = 5;
var LOGIN_FAIL_WINDOW_SEC = 15 * 60;
var LOGIN_FAIL_CACHE_KEY = 'login_fails';
var LOGIN_FAIL_SLEEP_MS = 500;
var GLOBAL_REVIEW_CAP = 10;
var GLOBAL_REVIEW_WINDOW_SEC = 60;
var GLOBAL_REVIEW_CACHE_KEY = 'reviews_per_min';
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
var CERT_HEADERS = [
  'id',
  'created_at',
  'title',
  'issuer',
  'year',
  'description',
  'link',
  'image_file_id',
  'image_url'
];

function setup() {
  getOrCreateSheet();
  getOrCreateCertificatesSheet();
  getOrCreateCertsFolder();
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var payload;
  if (String(params.type || '') === 'certificates') {
    payload = { ok: true, certificates: getCertificates() };
  } else {
    payload = { ok: true, reviews: getApprovedReviews() };
  }
  return jsonOutput(payload, params.callback);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput({ ok: false, error: 'Пустой запрос' });
    }
    var data = JSON.parse(e.postData.contents);
    var action = String((data && data.action) || 'addReview');
    if (action === 'login') {
      return jsonOutput(loginOwner(data));
    }
    if (action === 'logout') {
      return jsonOutput(logoutOwner(data));
    }
    if (action === 'addCertificate') {
      return jsonOutput(addCertificate(data));
    }
    if (action === 'deleteCertificate') {
      return jsonOutput(deleteCertificate(data));
    }
    return jsonOutput(addReview(data, e));
  } catch (err) {
    return jsonOutput({ ok: false, error: 'Некорректные данные' });
  }
}

/* ===================== Вход владельца ===================== */

function loginOwner(data) {
  data = data || {};
  var cache = CacheService.getScriptCache();
  var expected = String(
    PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || ''
  );
  if (!expected) {
    Utilities.sleep(LOGIN_FAIL_SLEEP_MS);
    return { ok: false, error: 'Пароль владельца не настроен' };
  }

  var fails = Number(cache.get(LOGIN_FAIL_CACHE_KEY) || 0);
  if (fails >= LOGIN_FAIL_MAX) {
    return { ok: false, error: 'Слишком много попыток, попробуйте позже' };
  }

  var password = String(data.password == null ? '' : data.password);
  if (!safeEqual(password, expected)) {
    cache.put(LOGIN_FAIL_CACHE_KEY, String(fails + 1), LOGIN_FAIL_WINDOW_SEC);
    Utilities.sleep(LOGIN_FAIL_SLEEP_MS);
    return { ok: false, error: 'Неверный пароль' };
  }

  cache.remove(LOGIN_FAIL_CACHE_KEY);
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  cache.put(SESSION_CACHE_PREFIX + token, 'owner', SESSION_TTL_SEC);
  return { ok: true, token: token, expiresIn: SESSION_TTL_SEC };
}

function logoutOwner(data) {
  var token = String((data && data.token) || '');
  if (token) {
    CacheService.getScriptCache().remove(SESSION_CACHE_PREFIX + token);
  }
  return { ok: true };
}

function requireOwner(data) {
  var token = String((data && data.token) || '');
  if (!token) {
    return { ok: false, error: 'Нужна авторизация владельца' };
  }
  var cache = CacheService.getScriptCache();
  var key = SESSION_CACHE_PREFIX + token;
  if (cache.get(key) !== 'owner') {
    return { ok: false, error: 'Сессия истекла. Войдите снова.' };
  }
  cache.put(key, 'owner', SESSION_TTL_SEC);
  return { ok: true };
}

function safeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  var max = Math.max(a.length, b.length);
  var diff = a.length ^ b.length;
  var i;
  for (i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/* ===================== Отзывы ===================== */

function getApprovedReviews() {
  var sheet = getOrCreateSheet();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var index = indexMap(headers, HEADERS);
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
  if (isGlobalReviewCapped()) {
    return { ok: false, error: 'Слишком много отзывов за короткое время. Попробуйте позже.' };
  }
  if (isRateLimited(rateKey)) {
    return {
      ok: false,
      error: 'Слишком часто. Подождите ' + RATE_LIMIT_MINUTES + ' минут перед следующим отзывом.'
    };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (isGlobalReviewCapped()) {
      return { ok: false, error: 'Слишком много отзывов за короткое время. Попробуйте позже.' };
    }
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
    rememberGlobalReview();
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

/* ===================== Сертификаты ===================== */

function getCertificates() {
  var sheet = getOrCreateCertificatesSheet();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var index = indexMap(values[0], CERT_HEADERS);
  var list = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var id = String(row[index.id] || '');
    if (!id) continue;
    var imageUrl = String(row[index.image_url] || '');
    var imageFileId = String(row[index.image_file_id] || '');
    list.push({
      id: id,
      createdAt: toIso(row[index.created_at]),
      title: String(row[index.title] || ''),
      issuer: String(row[index.issuer] || ''),
      year: String(row[index.year] || ''),
      description: String(row[index.description] || ''),
      link: String(row[index.link] || ''),
      imageFileId: imageFileId,
      imageUrl: imageUrl,
      isPdf: isPdfUrl(imageUrl)
    });
  }
  list.sort(function (a, b) {
    var yearDiff = (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0);
    if (yearDiff) return yearDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return list;
}

function addCertificate(data) {
  data = data || {};
  var auth = requireOwner(data);
  if (!auth.ok) return auth;

  var title = sanitizeText(data.title, 120);
  var issuer = sanitizeText(data.issuer, 120);
  var year = parseInt(data.year, 10);
  var description = sanitizeMultiline(data.description, 500);
  var link = sanitizeLink(data.link);
  var thisYear = new Date().getFullYear();

  if (!title || title.length < 2) {
    return { ok: false, error: 'Укажите название сертификата' };
  }
  if (!issuer || issuer.length < 2) {
    return { ok: false, error: 'Укажите, кто выдал сертификат' };
  }
  if (!(year >= 1980 && year <= thisYear + 1)) {
    return { ok: false, error: 'Укажите корректный год' };
  }
  if (data.link && !link) {
    return { ok: false, error: 'Ссылка должна начинаться с http:// или https://' };
  }

  var file = saveCertificateFile(data.imageBase64, data.imageMime, data.imageName);
  if (!file.ok) return file;

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateCertificatesSheet();
    var id = Utilities.getUuid();
    var createdAt = new Date();
    sheet.appendRow([
      id,
      createdAt,
      title,
      issuer,
      year,
      description,
      link,
      file.id,
      file.url
    ]);
    return {
      ok: true,
      certificate: {
        id: id,
        createdAt: createdAt.toISOString(),
        title: title,
        issuer: issuer,
        year: String(year),
        description: description,
        link: link,
        imageFileId: file.id,
        imageUrl: file.url,
        isPdf: file.isPdf
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function deleteCertificate(data) {
  data = data || {};
  var auth = requireOwner(data);
  if (!auth.ok) return auth;

  var id = sanitizeText(data.id, 80);
  if (!id) return { ok: false, error: 'Не указан сертификат' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateCertificatesSheet();
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return { ok: false, error: 'Сертификат не найден' };
    var index = indexMap(values[0], CERT_HEADERS);
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][index.id]) !== id) continue;
      var fileId = String(values[i][index.image_file_id] || '');
      sheet.deleteRow(i + 1);
      if (fileId) trashDriveFile(fileId);
      return { ok: true, id: id };
    }
    return { ok: false, error: 'Сертификат не найден' };
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateCertificatesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Скрипт должен быть привязан к Google-таблице');
  }
  var sheet = ss.getSheetByName(CERT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CERT_SHEET_NAME);
  }
  var firstRow = sheet.getRange(1, 1, 1, CERT_HEADERS.length).getValues()[0];
  var empty = firstRow.every(function (cell) { return cell === ''; });
  if (empty) {
    sheet.getRange(1, 1, 1, CERT_HEADERS.length).setValues([CERT_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, CERT_HEADERS.length);
  }
  return sheet;
}

function getOrCreateCertsFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(CERTS_FOLDER_PROP);
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) {}
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var folderName = 'Сертификаты Mini App' + (ss ? ' — ' + ss.getName() : '');
  var folder = DriveApp.createFolder(folderName);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  props.setProperty(CERTS_FOLDER_PROP, folder.getId());
  return folder;
}

function saveCertificateFile(base64, declaredMime, originalName) {
  var raw = String(base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!raw) {
    return { ok: false, error: 'Приложите фото или PDF сертификата' };
  }
  var bytes;
  try {
    bytes = Utilities.base64Decode(raw);
  } catch (err) {
    return { ok: false, error: 'Не удалось прочитать файл' };
  }
  if (!bytes || !bytes.length) {
    return { ok: false, error: 'Приложите фото или PDF сертификата' };
  }
  if (bytes.length > MAX_FILE_BYTES) {
    return { ok: false, error: 'Файл слишком большой. Сожмите изображение или выберите файл меньше 5 МБ.' };
  }
  var mime = detectMime(bytes, declaredMime);
  if (!mime) {
    return { ok: false, error: 'Поддерживаются изображения (JPEG, PNG, WebP, GIF) и PDF' };
  }
  var isPdf = mime === 'application/pdf';
  var ext = isPdf ? 'pdf' : 'jpg';
  if (mime === 'image/png') ext = 'png';
  if (mime === 'image/webp') ext = 'webp';
  if (mime === 'image/gif') ext = 'gif';
  var safeName = sanitizeFilename(originalName, ext);
  var folder = getOrCreateCertsFolder();
  var blob = Utilities.newBlob(bytes, mime, safeName);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var fileId = file.getId();
  return {
    ok: true,
    id: fileId,
    url: publicFileUrl(fileId, isPdf),
    isPdf: isPdf
  };
}

function publicFileUrl(fileId, isPdf) {
  if (isPdf) {
    return 'https://drive.google.com/file/d/' + fileId + '/view';
  }
  // Публичный превью-URL, подходит для <img src>.
  // Запасной: https://lh3.googleusercontent.com/d/FILE_ID=w1600
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1600';
}

function isPdfUrl(url) {
  var value = String(url || '');
  return value.indexOf('/file/d/') !== -1 || /\.pdf($|\?)/i.test(value);
}

function trashDriveFile(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (err) {}
}

function detectMime(bytes, declared) {
  var b0 = u8(bytes[0]);
  var b1 = bytes.length > 1 ? u8(bytes[1]) : 0;
  var b2 = bytes.length > 2 ? u8(bytes[2]) : 0;
  var b3 = bytes.length > 3 ? u8(bytes[3]) : 0;
  if (b0 === 0xFF && b1 === 0xD8 && b2 === 0xFF) return 'image/jpeg';
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4E && b3 === 0x47) return 'image/png';
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return 'image/gif';
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) {
    if (bytes.length > 11 && u8(bytes[8]) === 0x57 && u8(bytes[9]) === 0x45 && u8(bytes[10]) === 0x42 && u8(bytes[11]) === 0x50) {
      return 'image/webp';
    }
  }
  if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) return 'application/pdf';
  var declaredMime = String(declared || '').toLowerCase().split(';')[0].trim();
  var allowed = {
    'image/jpeg': 1,
    'image/png': 1,
    'image/webp': 1,
    'image/gif': 1,
    'application/pdf': 1
  };
  return allowed[declaredMime] ? declaredMime : '';
}

function u8(value) {
  var n = Number(value);
  return n < 0 ? n + 256 : n;
}

function sanitizeFilename(name, ext) {
  var base = String(name || 'certificate')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  if (!base) base = 'certificate';
  return base + '.' + ext;
}

function sanitizeLink(value) {
  var raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (!/^https?:\/\/[^\s]+$/i.test(raw) || raw.length > 500) return '';
  return raw;
}

function sanitizeMultiline(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\s{3,}/g, '  ')
    .trim()
    .slice(0, max);
}

/* ===================== Общие утилиты ===================== */

function indexMap(headers, expected) {
  expected = expected || HEADERS;
  var map = {};
  expected.forEach(function (name) {
    var idx = headers.indexOf(name);
    map[name] = idx === -1 ? expected.indexOf(name) : idx;
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

function cacheService() {
  return CacheService.getScriptCache();
}

function isGlobalReviewCapped() {
  var count = Number(cacheService().get(GLOBAL_REVIEW_CACHE_KEY) || 0);
  return count >= GLOBAL_REVIEW_CAP;
}

function rememberGlobalReview() {
  var cache = cacheService();
  var count = Number(cache.get(GLOBAL_REVIEW_CACHE_KEY) || 0);
  cache.put(GLOBAL_REVIEW_CACHE_KEY, String(count + 1), GLOBAL_REVIEW_WINDOW_SEC);
}

function isRateLimited(key) {
  return !!cacheService().get(rateLimitKey(key));
}

function rememberSubmission(key) {
  cacheService().put(rateLimitKey(key), '1', RATE_LIMIT_MINUTES * 60);
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
