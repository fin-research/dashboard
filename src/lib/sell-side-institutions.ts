export interface InstitutionLogoProfile {
  key: string;
  label: string;
  src: string;
  sourceUrl: string;
}

interface InstitutionLogoDefinition extends InstitutionLogoProfile {
  aliases: readonly string[];
}

const institutionLogos: readonly InstitutionLogoDefinition[] = [
  logo(
    "tebon",
    "德邦证券",
    "/institution-logos/tebon.png",
    "https://www.tebon.com.cn/front/images/logo_02.png",
    ["德邦证券", "德邦资管", "德邦固收", "德邦研究"],
  ),
  logo(
    "cms",
    "招商证券",
    "/institution-logos/cms.png",
    "https://www.newone.com.cn/newonefront/images/logo.png",
    ["招商证券", "招商固收", "招商研究"],
  ),
  logo(
    "glms",
    "国联民生证券",
    "/institution-logos/glms.png",
    "https://portal-oss.zhiye.com/609487/image/377c461f-825c-4b9f-ba3c-27bd00555513.png",
    ["国联民生", "国联证券", "民生证券", "国联固收", "民生固收"],
  ),
  logo(
    "swhy",
    "申万宏源证券",
    "/institution-logos/swhy.png",
    "https://www.swhysc.com/swhysc/img/headlogo.ee48884c.png",
    ["申万宏源", "申万固收", "申万研究"],
  ),
  logo(
    "xyzq",
    "兴业证券",
    "/institution-logos/xyzq.png",
    "https://www.xyzq.com.cn/xysec/views/theme/img/indexv2/logo_bg.png",
    ["兴业证券", "兴业固收", "兴证固收", "兴证"],
  ),
];

export function resolveInstitutionLogo(
  institution: string,
): InstitutionLogoProfile | null {
  const normalized = normalizeInstitution(institution);
  return (
    institutionLogos.find((profile) =>
      profile.aliases.some((alias) =>
        normalized.includes(normalizeInstitution(alias)),
      ),
    ) ?? null
  );
}

function logo(
  key: string,
  label: string,
  src: string,
  sourceUrl: string,
  aliases: readonly string[],
): InstitutionLogoDefinition {
  return { key, label, src, sourceUrl, aliases };
}

function normalizeInstitution(value: string): string {
  return value.replace(/[\s·•]/g, "").trim();
}
