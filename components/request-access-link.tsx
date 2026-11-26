const PRIME_SUPPORT_EMAIL = "support@allo.xyz";

export function RequestAccessLink({ companyName, variant }: { companyName: string; variant: "lite" | "pro" }) {
  const className = variant === "lite" ? "pc-btn pc-btn-outline" : "p-btn p-btn-outline";
  const subject = encodeURIComponent(`OpenStocks Prime access request for ${companyName}`);
  return <a className={className} href={`mailto:${PRIME_SUPPORT_EMAIL}?subject=${subject}`}>Request access</a>;
}
