// packages/site-builder/themes/modern/scripts/newsletter-subscribe.ts

const SUBSCRIBE_URL = import.meta.env.SUBSCRIBE_API_URL || "";
const SITE_DOMAIN = import.meta.env.SITE_DOMAIN || "";

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

    if (!SUBSCRIBE_URL) {
      showMessage(form, "Subscribe service is not configured.", true);
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
        // Replace form with a visible success message (inline styles to bypass Astro scoping)
        form.innerHTML = `<p style="
          color: #10b981;
          font-size: 1.125rem;
          font-weight: 600;
          padding: 0.75rem 0;
          text-align: center;
          width: 100%;
        ">Thank you for subscribing!</p>`;
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
  msg.dataset.newsletterMsg = "";
  msg.style.fontSize = "0.875rem";
  msg.style.marginTop = "0.5rem";
  msg.style.fontWeight = "500";
  msg.style.color = isError ? "#ef4444" : "#10b981";
  msg.textContent = text;
  form.appendChild(msg);
}

function clearMessage(form: HTMLFormElement): void {
  form.querySelector("[data-newsletter-msg]")?.remove();
}
