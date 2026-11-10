/**
 * Проверка алгоритма подписи Telegram Mini App initData.
 * Порт логики из apps-script/Code.gs на Node.js crypto:
 *   secret_key = HMAC_SHA256(key='WebAppData', msg=bot_token)
 *   data_check_string = отсортированные key=value (кроме hash), через \n
 *   hash = hex(HMAC_SHA256(key=secret_key /* сырые байты * /, msg=data_check_string))
 *
 * Запуск: node tests/initdata-hmac.test.js
 */

"use strict";

const crypto = require("crypto");
const assert = require("assert");

const FAKE_TOKEN = "123456:FAKE-BOT-TOKEN-FOR-TESTS-ONLY";
const OWNER_ID = "42424242";
const MAX_AGE_SEC = 24 * 60 * 60;

function computeHmacSha256(message, key) {
  // Как Utilities.computeHmacSha256Signature(message, key): ключ — строка или Buffer.
  return crypto.createHmac("sha256", key).update(message, "utf8").digest();
}

function toHex(buf) {
  return Buffer.from(buf).toString("hex");
}

function parseQueryString(raw) {
  const params = {};
  String(raw || "")
    .split("&")
    .forEach((part) => {
      if (!part) return;
      const idx = part.indexOf("=");
      const key = decodeURIComponent(idx === -1 ? part : part.slice(0, idx));
      const val = decodeURIComponent((idx === -1 ? "" : part.slice(idx + 1)).replace(/\+/g, " "));
      params[key] = val;
    });
  return params;
}

function safeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function buildDataCheckString(params) {
  return Object.keys(params)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => k + "=" + params[k])
    .join("\n");
}

function signInitData(fields, botToken) {
  const dataCheckString = buildDataCheckString(fields);
  const secretKey = computeHmacSha256(botToken, "WebAppData");
  const hash = toHex(computeHmacSha256(dataCheckString, secretKey));
  const pairs = Object.keys(fields).map(
    (k) => encodeURIComponent(k) + "=" + encodeURIComponent(fields[k])
  );
  pairs.push("hash=" + hash);
  return { initData: pairs.join("&"), hash, dataCheckString, secretKey };
}

function validateTelegramInitData(initData, options) {
  options = options || {};
  const botToken = options.botToken || FAKE_TOKEN;
  const params = parseQueryString(initData);
  const receivedHash = String(params.hash || "").toLowerCase();
  if (!receivedHash) return { ok: false, error: "Нет подписи Telegram" };

  const dataCheckString = buildDataCheckString(params);
  const secretKey = computeHmacSha256(botToken, "WebAppData");
  const computedHash = toHex(computeHmacSha256(dataCheckString, secretKey));
  if (!safeEqual(computedHash, receivedHash)) {
    return { ok: false, error: "Недействительная подпись Telegram" };
  }

  const authDate = parseInt(params.auth_date, 10);
  const now = options.now || Math.floor(Date.now() / 1000);
  if (!authDate) return { ok: false, error: "Нет даты подписи" };
  if (now - authDate > MAX_AGE_SEC || authDate > now + 60) {
    return { ok: false, error: "Сессия Telegram устарела. Откройте Mini App заново." };
  }

  let user = null;
  try {
    user = JSON.parse(params.user || "null");
  } catch (err) {
    return { ok: false, error: "Некорректные данные пользователя" };
  }
  if (!user || user.id == null || user.id === "") {
    return { ok: false, error: "Нет данных пользователя Telegram" };
  }
  if (options.requireOwner) {
    const ownerId = String(options.ownerId || "");
    if (!ownerId) return { ok: false, error: "Не задан OWNER_TELEGRAM_ID в свойствах скрипта" };
    if (String(user.id) !== ownerId) return { ok: false, error: "Недостаточно прав" };
  }
  return { ok: true, user };
}

function sampleFields(overrides) {
  const user = {
    id: Number(OWNER_ID),
    first_name: "Владимир",
    last_name: "Пащенко",
    username: "Faringeits0",
    language_code: "ru"
  };
  return Object.assign(
    {
      query_id: "AAHdF6IQAAAAAN0XohDhr8md",
      user: JSON.stringify(user),
      auth_date: String(Math.floor(Date.now() / 1000)),
      chat_type: "sender"
    },
    overrides || {}
  );
}

function main() {
  let passed = 0;
  function test(name, fn) {
    fn();
    passed += 1;
    console.log("ok  - " + name);
  }

  test("подпись сходится с повторным вычислением hash", () => {
    const signed = signInitData(sampleFields(), FAKE_TOKEN);
    const again = signInitData(parseQueryString(signed.initData), FAKE_TOKEN);
    assert.strictEqual(signed.hash, again.hash);
    assert.strictEqual(signed.dataCheckString, again.dataCheckString);
  });

  test("валидные initData принимаются, user.id совпадает", () => {
    const signed = signInitData(sampleFields(), FAKE_TOKEN);
    const result = validateTelegramInitData(signed.initData, {
      botToken: FAKE_TOKEN,
      requireOwner: true,
      ownerId: OWNER_ID
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(String(result.user.id), OWNER_ID);
    assert.strictEqual(result.user.username, "Faringeits0");
  });

  test("ключ первого HMAC — строка WebAppData, второго — сырые байты", () => {
    const fields = sampleFields();
    const signed = signInitData(fields, FAKE_TOKEN);
    const wrongSecretAsHexString = toHex(computeHmacSha256(FAKE_TOKEN, "WebAppData"));
    const dataCheckString = signed.dataCheckString;
    const wrongHash = toHex(computeHmacSha256(dataCheckString, wrongSecretAsHexString));
    assert.notStrictEqual(wrongHash, signed.hash);
    const rightKey = computeHmacSha256(FAKE_TOKEN, "WebAppData");
    assert.ok(Buffer.isBuffer(rightKey) || rightKey instanceof Uint8Array);
    assert.strictEqual(rightKey.length, 32);
  });

  test("подмена user ломает подпись", () => {
    const signed = signInitData(sampleFields(), FAKE_TOKEN);
    const tampered = signed.initData.replace(
      encodeURIComponent('"id":' + OWNER_ID),
      encodeURIComponent('"id":1')
    );
    const result = validateTelegramInitData(tampered, { botToken: FAKE_TOKEN });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "Недействительная подпись Telegram");
  });

  test("чужой bot token не подходит", () => {
    const signed = signInitData(sampleFields(), FAKE_TOKEN);
    const result = validateTelegramInitData(signed.initData, { botToken: "other:token" });
    assert.strictEqual(result.ok, false);
  });

  test("просроченный auth_date отклоняется", () => {
    const old = String(Math.floor(Date.now() / 1000) - MAX_AGE_SEC - 10);
    const signed = signInitData(sampleFields({ auth_date: old }), FAKE_TOKEN);
    const result = validateTelegramInitData(signed.initData, { botToken: FAKE_TOKEN });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /устарела/);
  });

  test("чужой user.id отклоняется при requireOwner", () => {
    const fields = sampleFields();
    fields.user = JSON.stringify({ id: 99, first_name: "Other" });
    const signed = signInitData(fields, FAKE_TOKEN);
    const result = validateTelegramInitData(signed.initData, {
      botToken: FAKE_TOKEN,
      requireOwner: true,
      ownerId: OWNER_ID
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "Недостаточно прав");
  });

  test("без hash — ошибка", () => {
    const result = validateTelegramInitData("auth_date=1&user=%7B%7D", { botToken: FAKE_TOKEN });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "Нет подписи Telegram");
  });

  test("кириллица в user корректно входит в data_check_string", () => {
    const signed = signInitData(sampleFields(), FAKE_TOKEN);
    assert.ok(signed.dataCheckString.indexOf("Владимир") !== -1);
    const result = validateTelegramInitData(signed.initData, { botToken: FAKE_TOKEN });
    assert.strictEqual(result.ok, true);
  });

  console.log("\n" + passed + " tests passed");
}

main();
