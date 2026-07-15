import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookies } from "../../../lib/auth/session";

export async function POST(request: NextRequest) {
  await clearSessionCookies();
  return NextResponse.redirect(new URL("/", request.url), 303);
}

