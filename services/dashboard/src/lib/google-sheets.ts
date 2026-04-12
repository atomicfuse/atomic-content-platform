// services/dashboard/src/lib/google-sheets.ts
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function getAuth(): JWT {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY env var is not set");
  }
  const key = JSON.parse(keyJson) as { client_email: string; private_key: string };
  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
  });
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) {
    throw new Error("GOOGLE_SHEET_ID env var is not set");
  }
  return id;
}

export interface SubscribeResult {
  created: boolean; // true = new row, false = duplicate skipped
}

/**
 * Append a subscriber email to the Google Sheet tab for the given domain.
 * Creates the tab if it doesn't exist. Skips duplicates silently.
 */
export async function appendSubscriber(
  email: string,
  domain: string,
  source: string
): Promise<SubscribeResult> {
  const auth = getAuth();
  const doc = new GoogleSpreadsheet(getSpreadsheetId(), auth);
  await doc.loadInfo();

  const tabName = domain.toLowerCase();

  // Find or create the tab
  let sheet = doc.sheetsByTitle[tabName];
  if (!sheet) {
    sheet = await doc.addSheet({
      title: tabName,
      headerValues: ["email", "subscribed_at", "source"],
    });
  }

  // Check for duplicate
  const rows = await sheet.getRows();
  const normalizedEmail = email.toLowerCase().trim();
  const exists = rows.some(
    (row) => row.get("email")?.toLowerCase().trim() === normalizedEmail
  );

  if (exists) {
    console.log(`[subscribe] duplicate: domain=${tabName} email=${normalizedEmail}`);
    return { created: false };
  }

  // Append new row
  await sheet.addRow({
    email: normalizedEmail,
    subscribed_at: new Date().toISOString(),
    source: source || "unknown",
  });

  console.log(`[subscribe] new: domain=${tabName} source=${source}`);
  return { created: true };
}
