import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookies } from "../../../lib/auth/session";
import { publicRequestOrigin } from "../../../lib/auth/origin";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/", publicRequestOrigin(request)), 303);
  clearSessionCookies(response);
  return response;
}
