import { NextRequest, NextResponse } from "next/server";
import {
  readEmailConfig,
  writeEmailConfig,
  type EmailConfig,
} from "@/lib/email-routing";

export async function GET(): Promise<NextResponse> {
  try {
    const config = await readEmailConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error("[email/config] GET error:", error);
    return NextResponse.json(
      { error: "Failed to read email config" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Partial<EmailConfig>;
    const current = await readEmailConfig();

    const updated: EmailConfig = {
      default_destination: body.default_destination ?? current.default_destination,
      overrides: body.overrides ?? current.overrides,
    };

    await writeEmailConfig(updated);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("[email/config] PUT error:", error);
    return NextResponse.json(
      { error: "Failed to save email config" },
      { status: 500 },
    );
  }
}
