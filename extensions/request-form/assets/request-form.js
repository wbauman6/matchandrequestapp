/**
 * Storefront request form.
 *
 * Posts to the app through the Shopify App Proxy (same origin as the shop, so
 * no CORS and no third-party script). The response is only ever a confirmation
 * — the app deliberately returns no matches, products, prices, or stock to the
 * storefront. Do not add code here that expects any.
 *
 * Bot defence handled here:
 *   - a single-use token fetched from the app on FIRST INTERACTION, so the
 *     server can tell how long the form was actually being filled in
 *   - a honeypot field rendered off-screen in the Liquid block
 * The real limits (per IP, per email, global daily cap) live server-side.
 */
(function () {
  "use strict";

  var MESSAGES = {
    generic:
      "Something went wrong. Please try again, or call the store and we'll help you.",
    offline: "We couldn't reach the store. Please check your connection and try again.",
  };

  function init(root) {
    if (root.dataset.wbjReady === "true") return;
    root.dataset.wbjReady = "true";

    var form = root.querySelector("[data-wbj-form]");
    var success = root.querySelector("[data-wbj-success]");
    var errorBox = root.querySelector("[data-wbj-form-error]");
    var button = root.querySelector("[data-wbj-submit]");
    if (!form || !success || !button) return;

    var path = root.dataset.proxyPath || "/apps/requests";
    var buttonLabel = button.textContent;
    var tokenPromise = null;
    var submitting = false;

    // Fetch a token the moment the shopper starts filling the form, not on page
    // load: the server requires a few seconds between issuing the token and
    // receiving the submission, and that should measure real fill time.
    function primeToken(force) {
      if (tokenPromise && !force) return tokenPromise;
      tokenPromise = fetch(path, {
        method: "GET",
        headers: { Accept: "application/json" },
      })
        .then(function (res) {
          if (!res.ok) throw new Error("token request failed: " + res.status);
          return res.json();
        })
        .then(function (data) {
          return data && data.token;
        })
        .catch(function () {
          tokenPromise = null; // let the submit handler try again
          return null;
        });
      return tokenPromise;
    }

    form.addEventListener("focusin", function () { primeToken(false); }, { once: true });
    form.addEventListener("input", function () { primeToken(false); }, { once: true });

    // Never block a real customer because the token endpoint hiccuped. Retry
    // once at submit time; if it still fails, submit WITHOUT a token — the
    // server accepts that in degraded mode and falls back to validation and
    // rate limits. Silently refusing every shopper would be far worse than the
    // small amount of bot cover this layer provides.
    function ensureToken() {
      return primeToken(false).then(function (token) {
        return token || primeToken(true);
      });
    }

    function showError(message) {
      if (!errorBox) return;
      errorBox.textContent = message;
      errorBox.hidden = false;
    }

    function clearError() {
      if (!errorBox) return;
      errorBox.hidden = true;
      errorBox.textContent = "";
    }

    function setBusy(busy) {
      submitting = busy;
      button.disabled = busy;
      button.textContent = busy ? "Sending…" : buttonLabel;
    }

    function value(name) {
      var el = form.elements[name];
      return el ? String(el.value || "").trim() : "";
    }

    function payload(token) {
      return {
        token: token || "",
        name: value("name"),
        email: value("email"),
        phone: value("phone"),
        description: value("description"),
        budget: value("budget"),
        wbj_x2: value("wbj_x2"),
      };
    }

    // Belt and braces against the autofill failure that silently dropped real
    // submissions: if anything managed to populate the honeypot in a browser
    // that IS running this script, it was autofill or a password manager, not a
    // bot. Clear it. A bot that POSTs without running our JS never gets here, so
    // the honeypot still does its job against the traffic it's meant to catch.
    function clearHoneypot() {
      var hp = form.querySelector("[data-wbj-hp]");
      if (hp && hp.value) {
        hp.value = "";
      }
    }

    function post(token) {
      return fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload(token)),
      }).then(function (res) {
        return res
          .json()
          .catch(function () { return {}; })
          .then(function (data) { return { status: res.status, data: data }; });
      });
    }

    function succeed() {
      form.hidden = true;
      success.hidden = false;
      // Move focus so screen-reader users land on the confirmation.
      success.focus();
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (submitting) return;

      // Let the browser surface its own messages for empty/!valid fields first.
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      clearError();
      clearHoneypot();
      setBusy(true);

      ensureToken()
        .then(post)
        .then(function (result) {
          // A stale token is the one error worth retrying silently — the
          // shopper left the tab open, which is not their fault.
          if (!result.data.ok && result.data.retryable) {
            return primeToken(true).then(post);
          }
          return result;
        })
        .then(function (result) {
          if (result.data && result.data.ok) {
            succeed();
            return;
          }
          showError((result.data && result.data.error) || MESSAGES.generic);
          setBusy(false);
        })
        .catch(function () {
          showError(MESSAGES.offline);
          setBusy(false);
        });
    });
  }

  function initAll() {
    document.querySelectorAll("[data-wbj-request-form]").forEach(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }

  // Theme editor re-renders blocks without a page load.
  document.addEventListener("shopify:section:load", initAll);
  document.addEventListener("shopify:block:select", initAll);
})();
