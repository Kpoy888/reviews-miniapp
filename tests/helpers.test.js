/**
 * Проверка чистых вспомогательных функций, которые совпадают с логикой
 * в apps-script/Code.gs: безопасное сравнение строк, ссылки и категории.
 *
 * Запуск: node tests/helpers.test.js
 */

"use strict";

const assert = require("assert");

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

function sanitizeLink(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  if (!/^https?:\/\/[^\s]+$/i.test(raw) || raw.length > 500) return "";
  return raw;
}

const CATEGORIES = {
  support: "ИИ-автоматизация техподдержки",
  design: "Проектирование"
};

function normalizeCategory(value) {
  const raw = String(value || "").trim();
  if (CATEGORIES[raw]) return raw;
  if (raw === CATEGORIES.support) return "support";
  if (raw === CATEGORIES.design) return "design";
  return "";
}

assert.strictEqual(safeEqual("secret", "secret"), true);
assert.strictEqual(safeEqual("secret", "Secret"), false);
assert.strictEqual(safeEqual("secret", "secre"), false);
assert.strictEqual(safeEqual("", ""), true);
assert.strictEqual(safeEqual("ab", "abc"), false);

assert.strictEqual(sanitizeLink("https://example.com/cert"), "https://example.com/cert");
assert.strictEqual(sanitizeLink(" http://example.com "), "http://example.com");
assert.strictEqual(sanitizeLink("javascript:alert(1)"), "");
assert.strictEqual(sanitizeLink("ftp://files.example"), "");
assert.strictEqual(sanitizeLink(""), "");

assert.strictEqual(normalizeCategory("support"), "support");
assert.strictEqual(normalizeCategory("design"), "design");
assert.strictEqual(normalizeCategory("Проектирование"), "design");
assert.strictEqual(normalizeCategory("ИИ-автоматизация техподдержки"), "support");
assert.strictEqual(normalizeCategory("other"), "");

console.log("helpers.test.js: ok");
