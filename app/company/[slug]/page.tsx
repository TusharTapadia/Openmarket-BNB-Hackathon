import { CompanyDetail } from "@/components/company-detail";
import { ProCompany } from "@/components/pro/pro-company";
import { ModeSwitch } from "@/components/view-mode";
export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ModeSwitch lite={<CompanyDetail slug={slug} />} pro={<ProCompany slug={slug} />} />;
}
