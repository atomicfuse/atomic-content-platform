"use client";

import { useEffect, useState } from "react";
import { parseCountryList } from "@/lib/config-normalizers";
import type { ConsentFormValue } from "@/lib/config-normalizers";
import { DEFAULT_CONSENT_MESSAGE, OPT_IN_COUNTRIES } from "@/lib/consent-constants";

export interface ConsentSectionProps {
  value: ConsentFormValue;
  onChange: (value: ConsentFormValue) => void;
  mode: "org" | "group" | "override" | "site";
}

const INPUT_CLASS =
  "w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50";

const LABEL_CLASS = "block text-xs font-semibold text-[var(--text-secondary)] mb-1";

/** Returns `value` with `key` set, or removed when `next` is undefined (= inherit). */
function withKey<K extends keyof ConsentFormValue>(
  value: ConsentFormValue,
  key: K,
  next: ConsentFormValue[K] | undefined,
): ConsentFormValue {
  const out = { ...value };
  if (next === undefined) delete out[key];
  else out[key] = next;
  return out;
}

/**
 * Cookie-consent banner settings. At org level every field has a value; at
 * group / override / site level an untouched field inherits from above.
 */
export function ConsentSection({ value, onChange, mode }: ConsentSectionProps): React.ReactElement {
  const isOrg = mode === "org";
  const [countriesText, setCountriesText] = useState((value.countries ?? []).join(", "));

  // Keep the text box in sync when the value changes from outside (load, reset).
  useEffect(() => {
    setCountriesText((value.countries ?? []).join(", "));
  }, [value.countries]);

  const enabledChoice = value.enabled === undefined ? "inherit" : value.enabled ? "on" : "off";
  const showTo = value.show_to ?? (isOrg ? "everyone" : "inherit");
  const missingOptIn =
    value.show_to === "countries" && OPT_IN_COUNTRIES.some((c) => !(value.countries ?? []).includes(c));

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)]">
        EU, UK and Swiss visitors are not tracked until they accept. Everyone else is tracked by default and can
        reject. Ads always load. {!isOrg && "Fields left on Inherit / empty use the value from the level above."}
      </p>

      {isOrg ? (
        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={value.enabled === true}
            onChange={(e): void => onChange(withKey(value, "enabled", e.target.checked))}
          />
          Show the cookie banner on all sites
        </label>
      ) : (
        <div>
          <label htmlFor={`consent-enabled-${mode}`} className={LABEL_CLASS}>Banner</label>
          <select
            id={`consent-enabled-${mode}`}
            className={INPUT_CLASS}
            value={enabledChoice}
            onChange={(e): void => {
              const v = e.target.value;
              onChange(withKey(value, "enabled", v === "inherit" ? undefined : v === "on"));
            }}
          >
            <option value="inherit">Inherit</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </div>
      )}

      <div>
        <label htmlFor={`consent-show-to-${mode}`} className={LABEL_CLASS}>Show banner to</label>
        <select
          id={`consent-show-to-${mode}`}
          className={INPUT_CLASS}
          value={showTo}
          onChange={(e): void => {
            const v = e.target.value;
            onChange(withKey(value, "show_to", v === "everyone" || v === "countries" ? v : undefined));
          }}
        >
          {!isOrg && <option value="inherit">Inherit</option>}
          <option value="everyone">Everyone</option>
          <option value="countries">Only these countries</option>
        </select>
      </div>

      {value.show_to === "countries" && (
        <div>
          <label htmlFor={`consent-countries-${mode}`} className={LABEL_CLASS}>Countries</label>
          <input
            id={`consent-countries-${mode}`}
            type="text"
            className={`${INPUT_CLASS} font-mono`}
            placeholder="DE, FR, GB"
            value={countriesText}
            onChange={(e): void => setCountriesText(e.target.value)}
            onBlur={(): void => onChange(withKey(value, "countries", parseCountryList(countriesText)))}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">Two-letter country codes, separated by commas.</p>
          {missingOptIn && (
            <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
              EU/UK visitors outside this list won&apos;t see the banner and will be tracked without consent.
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor={`consent-message-${mode}`} className={LABEL_CLASS}>Banner message</label>
        <textarea
          id={`consent-message-${mode}`}
          className={INPUT_CLASS}
          rows={3}
          placeholder={DEFAULT_CONSENT_MESSAGE}
          value={value.message ?? ""}
          onChange={(e): void => onChange(withKey(value, "message", e.target.value || undefined))}
        />
      </div>

      <div>
        <label htmlFor={`consent-privacy-${mode}`} className={LABEL_CLASS}>Privacy policy link</label>
        <input
          id={`consent-privacy-${mode}`}
          type="text"
          className={INPUT_CLASS}
          placeholder="/privacy"
          value={value.privacy_url ?? ""}
          onChange={(e): void => onChange(withKey(value, "privacy_url", e.target.value || undefined))}
        />
      </div>
    </div>
  );
}
