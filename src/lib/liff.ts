import liff from "@line/liff";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID ?? "";

let initialized = false;

export async function initLiff(): Promise<void> {
  if (initialized) return;
  if (!LIFF_ID) return;
  try {
    await liff.init({ liffId: LIFF_ID });
    initialized = true;
  } catch {
    // LIFF init failed — will fall back to non-auth state
  }
}

export function getIdToken(): string | null {
  if (!initialized) return null;
  return liff.getIDToken();
}

export function isInLiff(): boolean {
  return initialized && liff.isInClient();
}

export function isLoggedIn(): boolean {
  return initialized && liff.isLoggedIn();
}

export function login(): void {
  if (!initialized) return;
  liff.login();
}

export function logout(): void {
  if (!initialized) return;
  liff.logout();
}

export async function getProfile(): Promise<{
  displayName: string;
  pictureUrl?: string;
  userId: string;
} | null> {
  if (!initialized || !liff.isLoggedIn()) return null;
  try {
    const profile = await liff.getProfile();
    return {
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
      userId: profile.userId,
    };
  } catch {
    return null;
  }
}

export async function shareQuoteToLine(quoteUrl: string, projectName: string, totalAmount: string): Promise<boolean> {
  if (!initialized) return false;

  // If in LIFF, use shareTargetPicker to let user choose who to send to
  if (liff.isApiAvailable("shareTargetPicker")) {
    try {
      const result = await liff.shareTargetPicker([
        {
          type: "flex",
          altText: `${projectName} 報價單`,
          contents: {
            type: "bubble",
            hero: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "text",
                  text: "築報",
                  weight: "bold",
                  size: "sm",
                  color: "#5f6e4f",
                },
                {
                  type: "text",
                  text: "報價單",
                  weight: "bold",
                  size: "xxl",
                  margin: "sm",
                },
              ],
              paddingAll: "20px",
              backgroundColor: "#f6f7f4",
            },
            body: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "text",
                  text: projectName,
                  weight: "bold",
                  size: "lg",
                  wrap: true,
                },
                {
                  type: "separator",
                  margin: "lg",
                },
                {
                  type: "box",
                  layout: "horizontal",
                  margin: "lg",
                  contents: [
                    {
                      type: "text",
                      text: "工程總價",
                      size: "md",
                      color: "#555555",
                    },
                    {
                      type: "text",
                      text: totalAmount,
                      size: "md",
                      color: "#5f6e4f",
                      weight: "bold",
                      align: "end",
                    },
                  ],
                },
              ],
            },
            footer: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "button",
                  action: {
                    type: "uri",
                    label: "查看報價明細",
                    uri: quoteUrl,
                  },
                  style: "primary",
                  color: "#5f6e4f",
                },
              ],
              paddingAll: "12px",
            },
          },
        },
      ]);
      return result !== undefined;
    } catch {
      return false;
    }
  }

  // Fallback: open LINE share URL
  const shareText = [projectName + " 報價單", totalAmount, quoteUrl].join("\n");
  const shareUrl = "https://line.me/R/share?text=" + encodeURIComponent(shareText);
  globalThis.open(shareUrl, "_blank");
  return true;
}
