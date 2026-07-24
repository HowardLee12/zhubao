import type {
  DetailPhoto,
  PhotoMetadataRow,
} from "@/schemas/service-request-detail";
import { createAdminSupabaseClient } from "@/server/supabase/admin";

const PRIVATE_BUCKET = "v2-intake-photos";
const SIGNED_URL_TTL_SECONDS = 300;

// The authenticated RPC has already authorized and selected the ready photo
// rows. This helper uses the service credential for one narrow operation only:
// minting short-lived URLs for the private Storage bucket. It never queries a
// domain table, so ordinary staff reads cannot fall back to service-role SQL.
export async function signServiceRequestPhotos(
  rows: PhotoMetadataRow[],
): Promise<DetailPhoto[]> {
  if (rows.length === 0) return [];

  const signer = createAdminSupabaseClient();

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  const signed: DetailPhoto[] = [];
  for (const row of rows) {
    const { data: signedData, error: signedError } = await signer.storage
      .from(PRIVATE_BUCKET)
      .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signedError || !signedData?.signedUrl) continue;
    signed.push({
      id: row.id,
      category: row.category,
      url: signedData.signedUrl,
      expiresAt,
    });
  }
  return signed;
}
