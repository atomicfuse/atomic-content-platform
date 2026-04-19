import { NextRequest, NextResponse } from "next/server";
import { addDestinationAddress, listDestinationAddresses } from "@/lib/email-routing";

export async function GET(): Promise<NextResponse> {
  try {
    const addresses = await listDestinationAddresses();
    return NextResponse.json(addresses);
  } catch (error) {
    console.error("[email/verify] GET error:", error);
    return NextResponse.json(
      { error: "Failed to list destination addresses" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { email } = (await req.json()) as { email: string };
    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 },
      );
    }

    const result = await addDestinationAddress(email);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send verification";
    console.error("[email/verify] POST error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
