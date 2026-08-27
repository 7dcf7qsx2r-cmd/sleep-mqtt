/** 一型一密：每款 CIS 产品独立 productKey，固件只烧产品密钥，SN 出厂后首连自动登记。 */
export const CIS_PRODUCTS = [
  { productKey: "cis_ib", name: "CIS-IB 智能床垫", model: "CIS-IB", envSecret: "CIS_IB_PRODUCT_SECRET" },
  { productKey: "cis_iswb", name: "CIS-ISWB 智能撑腰床垫", model: "CIS-ISWB", envSecret: "CIS_ISWB_PRODUCT_SECRET" },
  { productKey: "cis_ip", name: "CIS-IP 智能枕", model: "CIS-IP", envSecret: "CIS_IP_PRODUCT_SECRET" },
] as const;

export type CisProductKey = (typeof CIS_PRODUCTS)[number]["productKey"];

export function productKeyForModel(model?: string | null): string | null {
  if (!model) return null;
  const compact = model.trim().toUpperCase().replace(/\s+/g, "-").replace(/-+/g, "-");
  const hit = CIS_PRODUCTS.find((p) => p.model === compact || p.model.replace(/-/g, "") === compact.replace(/-/g, ""));
  return hit?.productKey ?? null;
}
