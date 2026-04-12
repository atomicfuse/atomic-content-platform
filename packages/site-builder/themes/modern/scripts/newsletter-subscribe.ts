// packages/site-builder/themes/modern/scripts/newsletter-subscribe.ts

const SUBSCRIBE_URL = import.meta.env.SUBSCRIBE_API_URL;
const SITE_DOMAIN = import.meta.env.SITE_DOMAIN;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

document.querySelectorAll<HTMLFormElement>("[data-newsletter-form]").forEach((form) => {
  const source = form.dataset.source || "unknown";
  const emailInput = form.querySelector<HTMLInputElement>('input[type="email"], input[name="email"]');
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const honeypot = form.querySelector<HTMLInputElement>('input[name="_hp"]');

  if (!emailInput || !submitBtn) return;

  const originalBtnText = submitBtn.textContent || "Subscribe";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Honeypot check — bots fill hidden fields
    if (honeypot && honeypot.value) return;

    const email = emailInput.value.trim();
    if (!email || !EMAIL_RE.test(email)) {
      showMessage(form, "Please enter a valid email address.", true);
      return;
    }

    // Loading state
    submitBtn.disabled = true;
    submitBtn.textContent = "Subscribing...";
    clearMessage(form);

    try {
      const res = await fetch(SUBSCRIBE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, domain: SITE_DOMAIN, source }),
      });

      const data = await res.json();

      if (res.ok) {
        // Replace form with success message
        form.innerHTML = '<p class="newsletter-success">Thanks for subscribing!</p>';
      } else {
        showMessage(form, data.message || "Something went wrong. Please try again.", true);
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
    } catch {
      showMessage(form, "Connection error. Please try again later.", true);
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    }
  });
});

function showMessage(form: HTMLFormElement, text: string, isError: boolean): void {
  clearMessage(form);
  const msg = document.createElement("p");
  msg.className = isError ? "newsletter-error" : "newsletter-success";
  msg.textContent = text;
  form.appendChild(msg);
}

function clearMessage(form: HTMLFormElement): void {
  form.querySelector(".newsletter-error")?.remove();
  form.querySelector(".newsletter-success")?.remove();
}
