import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { canUploadPhoto } from "@/lib/queries";
import { v4 as uuid } from "uuid";
import { revalidatePath } from "next/cache";

export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const projectId = formData.get("projectId") as string;
  const tradeId = (formData.get("tradeId") as string) || null;
  const photo = formData.get("photo") as Blob | null;
  const thumbnail = formData.get("thumbnail") as Blob | null;

  if (!projectId || !photo || !thumbnail) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Verify project belongs to user
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Check quota
  const quota = await canUploadPhoto(projectId);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: "免費方案每個案件最多 100 張照片，請升級為專業版" },
      { status: 403 }
    );
  }

  // Upload files to storage: {userId}/{projectId}/{uuid}.ext
  const fileId = uuid();
  const ext = photo.type === "image/webp" ? "webp" : "jpg";
  const filePath = `${userId}/${projectId}/${fileId}.${ext}`;
  const thumbPath = `${userId}/${projectId}/thumb_${fileId}.${ext}`;

  const photoBuffer = Buffer.from(await photo.arrayBuffer());
  const thumbBuffer = Buffer.from(await thumbnail.arrayBuffer());

  const [photoUpload, thumbUpload] = await Promise.all([
    supabaseAdmin.storage.from("photos").upload(filePath, photoBuffer, {
      contentType: photo.type || "image/webp",
      upsert: false,
    }),
    supabaseAdmin.storage.from("photos").upload(thumbPath, thumbBuffer, {
      contentType: thumbnail.type || "image/webp",
      upsert: false,
    }),
  ]);

  if (photoUpload.error || thumbUpload.error) {
    const errMsg = photoUpload.error?.message || thumbUpload.error?.message || "Unknown";
    // Cleanup any partial uploads
    await supabaseAdmin.storage.from("photos").remove([filePath, thumbPath]);
    return NextResponse.json(
      { error: `上傳失敗: ${errMsg}` },
      { status: 500 }
    );
  }

  // Insert DB row
  const { data: photoRow, error: dbError } = await supabaseAdmin
    .from("photos")
    .insert({
      project_id: projectId,
      trade_id: tradeId,
      user_id: userId,
      file_path: filePath,
      thumbnail_path: thumbPath,
      file_size: photoBuffer.length,
    })
    .select()
    .single();

  if (dbError) {
    // Cleanup storage on DB failure
    await supabaseAdmin.storage.from("photos").remove([filePath, thumbPath]);
    return NextResponse.json(
      { error: `儲存照片資料失敗: ${dbError.message}` },
      { status: 500 }
    );
  }

  revalidatePath(`/projects/${projectId}`);

  return NextResponse.json(photoRow);
}
