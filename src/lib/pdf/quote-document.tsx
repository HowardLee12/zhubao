// Server-side PDF document for a quote.
//
// Used by /api/quotes/[id]/pdf to produce a downloadable file.
// Layout intentionally mirrors the public share page (/quotes/[id]/share)
// so cost/markup never enters this render tree.

import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

// Register a CJK-capable font. @react-pdf/renderer's built-in Helvetica has no
// Chinese glyphs, so without this the PDF would render every Chinese character
// as a blank box.
//
// Source: Google Fonts repo (OFL licensed) via jsDelivr CDN.
// First cold-start fetch is ~1s for the 7MB regular weight; warm starts reuse
// the cached font in memory.
Font.register({
  family: "NotoSansTC",
  fonts: [
    {
      src: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanstc/static/NotoSansTC-Regular.ttf",
    },
    {
      src: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanstc/static/NotoSansTC-Bold.ttf",
      fontWeight: "bold",
    },
  ],
});

// @react-pdf/renderer applies CJK-friendly word-break by default but we still
// need to tell it to not try to hyphenate Chinese (otherwise each character
// gets treated as a hyphenation candidate, which is slow).
Font.registerHyphenationCallback((word) => [word]);

export interface QuotePDFData {
  customerName: string;
  address: string;
  description: string;
  version: number;
  designerName: string;
  generatedDate: string; // "2026-05-14"
  sections: {
    name: string;
    icon: string;
    items: {
      name: string;
      spec: string;
      unit: string;
      quantity: number;
      clientUnitPrice: number;
      clientTotal: number;
    }[];
  }[];
  grandTotal: number;
}

const ORANGE = "#E2691F";
const BRICK = "#A04428";
const INK = "#1A1410";
const INK_2 = "#5A4D40";
const INK_3 = "#9C8A78";
const WARM_BORDER = "#E8DECF";
const BG_WARM = "#F4ECDD";

const styles = StyleSheet.create({
  page: {
    fontFamily: "NotoSansTC",
    fontSize: 10,
    padding: 36,
    color: INK,
    backgroundColor: "#FFFFFF",
  },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: ORANGE,
    marginBottom: 16,
  },
  brandColumn: { flexDirection: "column" },
  brand: { fontSize: 24, fontWeight: "bold", color: ORANGE, letterSpacing: 0.5 },
  brandSub: { fontSize: 10, color: INK_2, marginTop: 2 },
  metaColumn: { flexDirection: "column", alignItems: "flex-end" },
  metaTitle: { fontSize: 11, fontWeight: "bold", color: INK },
  metaSub: { fontSize: 9, color: INK_3, marginTop: 2 },
  // Customer block
  customerBlock: {
    backgroundColor: BG_WARM,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  customerLabel: { fontSize: 9, color: INK_3 },
  customerName: { fontSize: 13, fontWeight: "bold", color: INK, marginTop: 2 },
  customerAddress: { fontSize: 10, color: INK_2, marginTop: 1 },
  // Section
  section: { marginBottom: 14 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: BG_WARM,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderLeftWidth: 3,
    borderLeftColor: ORANGE,
    marginBottom: 4,
  },
  sectionName: { fontSize: 11, fontWeight: "bold", color: INK_2 },
  sectionTotal: { fontSize: 11, fontWeight: "bold", color: INK },
  // Item row
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: WARM_BORDER,
  },
  rowName: { flex: 1, fontSize: 10, color: INK },
  rowSpec: { fontSize: 8, color: INK_3, marginTop: 1 },
  rowQty: { width: 56, fontSize: 9, color: INK_2, textAlign: "right" },
  rowUnitPrice: { width: 60, fontSize: 9, color: INK_2, textAlign: "right" },
  rowTotal: { width: 68, fontSize: 10, color: INK, textAlign: "right", fontWeight: "bold" },
  // Total
  totalBlock: {
    marginTop: 16,
    padding: 14,
    backgroundColor: INK,
    borderRadius: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: { fontSize: 11, color: "#FFFFFF", opacity: 0.85 },
  totalAmount: { fontSize: 22, fontWeight: "bold", color: "#FFFFFF" },
  // Notes / footer
  notes: {
    marginTop: 14,
    padding: 10,
    backgroundColor: BG_WARM,
    fontSize: 9,
    color: INK_2,
    lineHeight: 1.6,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: WARM_BORDER,
  },
  footerText: { fontSize: 8, color: INK_3 },
  footerBrand: { fontSize: 8, color: BRICK, fontWeight: "bold" },
});

function formatNT(amount: number): string {
  return `NT$ ${amount.toLocaleString("en-US")}`;
}

export function QuoteDocument({ data }: { data: QuotePDFData }) {
  return (
    <Document
      title={`${data.customerName} 報價單 v${data.version}`}
      author={data.designerName || "Renoly"}
      subject={`${data.customerName} · ${data.description}`}
      creator="Renoly"
      producer="Renoly"
    >
      <Page size="A4" style={styles.page} wrap>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.brandColumn}>
            <Text style={styles.brand}>Renoly</Text>
            <Text style={styles.brandSub}>裝修工程報價單</Text>
          </View>
          <View style={styles.metaColumn}>
            <Text style={styles.metaTitle}>v{data.version}</Text>
            <Text style={styles.metaSub}>{data.generatedDate}</Text>
            {data.designerName ? (
              <Text style={styles.metaSub}>{data.designerName}</Text>
            ) : null}
          </View>
        </View>

        {/* Customer */}
        <View style={styles.customerBlock}>
          <View>
            <Text style={styles.customerLabel}>客戶</Text>
            <Text style={styles.customerName}>
              {data.customerName} {data.description ? `· ${data.description}` : ""}
            </Text>
            {data.address ? (
              <Text style={styles.customerAddress}>{data.address}</Text>
            ) : null}
          </View>
        </View>

        {/* Sections */}
        {data.sections.map((section, sectionIdx) => {
          const sectionTotal = section.items.reduce((s, it) => s + it.clientTotal, 0);
          return (
            <View key={`${section.name}-${sectionIdx}`} style={styles.section} wrap={false}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionName}>
                  {section.icon} {section.name}
                </Text>
                <Text style={styles.sectionTotal}>{formatNT(sectionTotal)}</Text>
              </View>
              {section.items.map((item, itemIdx) => (
                <View key={`${item.name}-${itemIdx}`} style={styles.row}>
                  <View style={styles.rowName}>
                    <Text>{item.name}</Text>
                    {item.spec ? <Text style={styles.rowSpec}>{item.spec}</Text> : null}
                  </View>
                  <Text style={styles.rowQty}>
                    {item.quantity} {item.unit}
                  </Text>
                  <Text style={styles.rowUnitPrice}>{formatNT(item.clientUnitPrice)}</Text>
                  <Text style={styles.rowTotal}>{formatNT(item.clientTotal)}</Text>
                </View>
              ))}
            </View>
          );
        })}

        {/* Total */}
        <View style={styles.totalBlock} wrap={false}>
          <Text style={styles.totalLabel}>工程總價（含稅）</Text>
          <Text style={styles.totalAmount}>{formatNT(data.grandTotal)}</Text>
        </View>

        {/* Notes */}
        <View style={styles.notes}>
          <Text>備註</Text>
          <Text style={{ marginTop: 4 }}>
            • 此報價單以本文件記載為準，工期、付款條件請以雙方契約為主。
          </Text>
          <Text>• 若工程內容有所變動，將另行協議調整金額。</Text>
          <Text>• 本報價單有效期限 30 天。</Text>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {data.customerName} · {data.description} · v{data.version}
          </Text>
          <Text style={styles.footerBrand}>由 Renoly 產生</Text>
        </View>
      </Page>
    </Document>
  );
}
