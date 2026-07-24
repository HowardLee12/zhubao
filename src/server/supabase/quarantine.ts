export function quarantinedNotFoundResponse(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
