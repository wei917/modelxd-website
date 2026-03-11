import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type StorageSaveResult = {
  bucket: string;
  path: string;
  url: string | null;      // signed url (private bucket friendly)
  expires_in: number;      // seconds
};

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function extFromContentType(contentType: string | null): string {
  if (!contentType) return "bin";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("heic") || contentType.includes("heif")) return "heic";
  return "bin";
}

export async function getSupabaseUserClient(req: Request) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }

  const token = getBearerToken(req);
  if (!token) throw new Error("Missing Authorization: Bearer <token>");

  // IMPORTANT: client acts as the user so Storage RLS policies apply
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) throw new Error("Invalid or expired token");

  return { supabase, user: data.user };
}

export async function saveUploadedFileToStorage(params: {
  supabase: any;
  userId: string;
  file: File;
  bucket?: string;     // default: "user-uploads"
  folder?: string;     // default: "raw"
  expiresIn?: number;  // default: 7 days
}): Promise<StorageSaveResult> {
  const bucket = (params.bucket ?? "user-uploads").trim();
  const folder = (params.folder ?? "raw").trim();
  const expiresIn = params.expiresIn ?? 60 * 60 * 24 * 7;

  const ext = extFromContentType(params.file.type);
  const fileName = `${crypto.randomUUID()}.${ext}`;

  // Path format for your RLS policy: <uid>/<folder>/<filename>
  const path = `${params.userId}/${folder}/${fileName}`;

  const { error: uploadErr } = await params.supabase.storage
    .from(bucket)
    .upload(path, params.file, {
      contentType: params.file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  const { data: signed, error: signErr } = await params.supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  return {
    bucket,
    path,
    url: signErr ? null : (signed?.signedUrl ?? null),
    expires_in: expiresIn,
  };
}

// Optional helper if you want to store edited output too (base64 -> bytes)
export function b64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function saveBytesToStorage(params: {
  supabase: any;
  userId: string;
  bytes: Uint8Array;
  mime: string;
  bucket?: string;
  folder?: string;     // default: "edited"
  expiresIn?: number;
}): Promise<StorageSaveResult> {
  const bucket = (params.bucket ?? "user-uploads").trim();
  const folder = (params.folder ?? "edited").trim();
  const expiresIn = params.expiresIn ?? 60 * 60 * 24 * 7;

  const ext = extFromContentType(params.mime);
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const path = `${params.userId}/${folder}/${fileName}`;

  const { error: uploadErr } = await params.supabase.storage
    .from(bucket)
    .upload(path, params.bytes, {
      contentType: params.mime || "application/octet-stream",
      upsert: false,
    });

  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  const { data: signed, error: signErr } = await params.supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  return {
    bucket,
    path,
    url: signErr ? null : (signed?.signedUrl ?? null),
    expires_in: expiresIn,
  };
}
