import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export const runtime="nodejs";
export async function GET(){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const {data:tools}=await supabase.from("tools").select("id,name,description,json_schema").eq("user_id",user.id).limit(50);
  const spec={ openapi:"3.0.0", info:{title:"MockAgent",version:"0.1.0"}, paths: Object.fromEntries((tools??[]).map(t=>[`/api/v1/mock/${t.id}`,{post:{summary:t.name, requestBody:{content:{"application/json":{schema:t.json_schema}}}}}]))};
  return NextResponse.json(spec);
}
