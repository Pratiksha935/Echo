import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyBrowserToken } from "../../../../lib/auth/browser-token";
import { serviceRest } from "../../../../lib/integrations/service-rest";

const EXTENSION_ORIGIN=/^chrome-extension:\/\/[a-p]{32}$/;
const DEPARTMENTS=new Set(["Product","GTM","Sales","Engineering","Research","Browser"]);

export async function OPTIONS(request:NextRequest){const origin=allowedOrigin(request);return new NextResponse(null,{status:origin?204:403,headers:origin?corsHeaders(origin):undefined})}
export async function POST(request:NextRequest){
  const origin=allowedOrigin(request);if(!origin)return NextResponse.json({error:"forbidden_origin"},{status:403});const headers=corsHeaders(origin);
  const authorization=request.headers.get("authorization");const token=authorization?.startsWith("Bearer ")?verifyBrowserToken(authorization.slice(7)):null;
  if(!token)return NextResponse.json({error:"unauthorized"},{status:401,headers});
  const memberships=await serviceRest<Array<{id:string}>>(`/memberships?select=id&organisation_id=eq.${encodeURIComponent(token.organisationId)}&user_id=eq.${encodeURIComponent(token.userId)}&limit=1`);
  if(!memberships[0])return NextResponse.json({error:"workspace_access_revoked"},{status:403,headers});
  const body=await request.json().catch(()=>null) as {department?:unknown;note?:unknown;pageText?:unknown;pageTitle?:unknown;pageUrl?:unknown}|null;
  const department=text(body?.department,40);const note=text(body?.note,1200);const rawPageTitle=text(body?.pageTitle,220);const pageText=text(body?.pageText,2500);const pageUrl=safeUrl(text(body?.pageUrl,2000));
  const pageTitle=rawPageTitle||titleFromUrl(pageUrl);
  if(!DEPARTMENTS.has(department)||note.length<12||!pageTitle||!pageUrl)return NextResponse.json({error:"invalid_capture"},{status:400,headers});
  const capturedAt=new Date().toISOString();const externalId=`browser:${randomUUID()}`;
  await serviceRest("/knowledge_records",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({author_name:token.email,body:`${note}\n\nCaptured page context: ${pageText}`.slice(0,5000),department,external_id:externalId,indexed_at:capturedAt,metadata:{captured_at:capturedAt,status:"Team submission",submitted_by:token.userId},organisation_id:token.organisationId,source:"Browser",source_updated_at:capturedAt,source_url:pageUrl,title:pageTitle,visibility:"workspace"})});
  return NextResponse.json({decisionUrl:new URL(`/workspace/decision/${encodeURIComponent(externalId)}`,request.url).toString(),ok:true},{headers});
}
function allowedOrigin(request:NextRequest){const origin=request.headers.get("origin");return origin&&EXTENSION_ORIGIN.test(origin)?origin:null}
function corsHeaders(origin:string):HeadersInit{return{"access-control-allow-headers":"authorization, content-type","access-control-allow-methods":"POST, OPTIONS","access-control-allow-origin":origin,"cache-control":"no-store",vary:"origin"}}
function text(value:unknown,max:number){return typeof value==="string"?value.trim().slice(0,max):""}
function safeUrl(value:string){try{const url=new URL(value);return url.protocol==="https:"?url.toString():null}catch{return null}}
function titleFromUrl(value:string|null){try{const url=new URL(value??"");return url.hostname.replace(/^www\./,"")}catch{return""}}
