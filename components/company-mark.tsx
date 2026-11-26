"use client";
import { useState } from "react";
import Image from "next/image";
import { localLogo, slugify } from "@/lib/company-data";
export function CompanyMark({ name, logo, large = false }: { name: string; logo: string | null; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  // A company the feed has no logo for falls back to the copy in public/logos.
  logo = logo ?? localLogo(slugify(name));
  const classes = `company-mark ${large ? "large" : ""}`;
  if (!logo || failed) return <span className={`${classes} company-initials`} aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>;
  return <Image className={classes} src={logo} alt="" width={large ? 56 : 40} height={large ? 56 : 40} unoptimized onError={() => setFailed(true)} />;
}
