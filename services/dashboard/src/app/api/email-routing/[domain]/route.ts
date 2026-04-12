import { NextRequest, NextResponse } from "next/server";
import { readDashboardIndex } from "@/lib/github";
import {
  getSiteEmailConfig,
  createEmailRoutingRule,
  deleteEmailRoutingRule,
  buildContactEmail,
  findEmailRule,
} from "@/lib/email-routing";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ domain: string }> },
): Promise<NextResponse> {
  const { domain } = await params;
  try {
    const index = await readDashboardIndex();
    const site = index.sites.find((s) => s.domain === domain);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const config = await getSiteEmailConfig(
      domain,
      site.zone_id,
      site.custom_domain,
    );
    return NextResponse.json(config);
  } catch (error) {
    console.error(`[email-routing] get ${domain}:`, error);
    return NextResponse.json(
      { error: "Failed to get email config" },
      { status: 500 },
    );
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ domain: string }> },
): Promise<NextResponse> {
  const { domain } = await params;
  try {
    const index = await readDashboardIndex();
    const site = index.sites.find((s) => s.domain === domain);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
    if (!site.zone_id) {
      return NextResponse.json(
        { error: "No Cloudflare zone ID for this site" },
        { status: 400 },
      );
    }
    if (!site.custom_domain) {
      return NextResponse.json(
        { error: "Site has no custom domain connected" },
        { status: 400 },
      );
    }

    const rule = await createEmailRoutingRule(site.zone_id, domain);
    return NextResponse.json({
      address: buildContactEmail(domain),
      destination: "sites.newsletter@ngcdigital.io",
      active: true,
      ruleId: rule.id,
    });
  } catch (error) {
    console.error(`[email-routing] create ${domain}:`, error);
    return NextResponse.json(
      { error: "Failed to create email routing" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ domain: string }> },
): Promise<NextResponse> {
  const { domain } = await params;
  try {
    const index = await readDashboardIndex();
    const site = index.sites.find((s) => s.domain === domain);
    if (!site?.zone_id) {
      return NextResponse.json({ error: "No zone ID" }, { status: 400 });
    }

    const email = buildContactEmail(domain);
    const rule = await findEmailRule(site.zone_id, email);
    if (rule) {
      await deleteEmailRoutingRule(site.zone_id, rule.id);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[email-routing] delete ${domain}:`, error);
    return NextResponse.json(
      { error: "Failed to delete email routing" },
      { status: 500 },
    );
  }
}
