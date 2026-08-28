export interface InstitutionLogoProfile {
  key: string;
  label: string;
  mark: string;
  foreground: string;
  background: string;
}

interface InstitutionLogoDefinition extends InstitutionLogoProfile {
  aliases: readonly string[];
}

const institutionLogos: readonly InstitutionLogoDefinition[] = [
  logo("citic-csc", "中信建投证券", "建投", "#b42318", "#fef3f2", ["中信建投", "中信建投固收"]),
  logo("citic", "中信证券", "中信", "#c0102f", "#fff1f3", ["中信证券", "中信固收"]),
  logo("cicc", "中金公司", "中金", "#7a271a", "#fef6ee", ["中金公司", "中金固收", "中金研究"]),
  logo("htsc", "华泰证券", "华泰", "#b42318", "#fef3f2", ["华泰证券", "华泰固收", "华泰研究"]),
  logo("csc", "兴业证券", "兴业", "#175cd3", "#eff4ff", ["兴业证券", "兴业固收", "兴证固收", "兴证"]),
  logo("tf", "天风证券", "天风", "#c4320a", "#fff4ed", ["天风证券", "天风固收", "天风研究"]),
  logo("huayuan", "华源证券", "华源", "#026aa2", "#f0f9ff", ["华源证券", "华源固收", "华源研究"]),
  logo("tebon", "德邦证券", "德邦", "#175cd3", "#eff4ff", ["德邦证券", "德邦资管", "德邦固收", "德邦研究"]),
  logo("ctsec", "财通证券", "财通", "#b42318", "#fef3f2", ["财通证券", "财通固收", "财通研究"]),
  logo("gszq", "国盛证券", "国盛", "#b42318", "#fef3f2", ["国盛证券", "国盛固收", "国盛研究"]),
  logo("hczq", "华创证券", "华创", "#175cd3", "#eff4ff", ["华创证券", "华创固收", "华创研究"]),
  logo("gtja", "国泰海通证券", "国泰", "#1849a9", "#eff4ff", ["国泰海通", "国泰君安", "海通证券", "海通固收"]),
  logo("swhy", "申万宏源证券", "申万", "#b42318", "#fef3f2", ["申万宏源", "申万固收", "申万研究"]),
  logo("cms", "招商证券", "招商", "#b42318", "#fef3f2", ["招商证券", "招商固收", "招商研究"]),
  logo("gf", "广发证券", "广发", "#b42318", "#fef3f2", ["广发证券", "广发固收", "广发研究"]),
  logo("guosen", "国信证券", "国信", "#175cd3", "#eff4ff", ["国信证券", "国信固收", "国信研究"]),
  logo("zhongtai", "中泰证券", "中泰", "#026aa2", "#f0f9ff", ["中泰证券", "中泰固收", "中泰研究"]),
  logo("everbright", "光大证券", "光大", "#6938ef", "#f4f3ff", ["光大证券", "光大固收", "光大研究"]),
  logo("zheshang", "浙商证券", "浙商", "#175cd3", "#eff4ff", ["浙商证券", "浙商固收", "浙商研究"]),
  logo("orient", "东方证券", "东方", "#b42318", "#fef3f2", ["东方证券", "东方固收", "东方研究"]),
  logo("soochow", "东吴证券", "东吴", "#175cd3", "#eff4ff", ["东吴证券", "东吴固收", "东吴研究"]),
  logo("pingan", "平安证券", "平安", "#c4320a", "#fff4ed", ["平安证券", "平安固收", "平安研究"]),
  logo("minsheng", "民生证券", "民生", "#175cd3", "#eff4ff", ["民生证券", "民生固收", "民生研究"]),
  logo("galaxy", "中国银河证券", "银河", "#1849a9", "#eff4ff", ["中国银河", "银河证券", "银河固收"]),
  logo("cjsc", "长江证券", "长江", "#175cd3", "#eff4ff", ["长江证券", "长江固收", "长江研究"]),
];

export function resolveInstitutionLogo(
  institution: string,
): InstitutionLogoProfile {
  const normalized = normalizeInstitution(institution);
  const matched = institutionLogos.find((profile) =>
    profile.aliases.some((alias) => normalized.includes(normalizeInstitution(alias))),
  );
  if (matched) return matched;

  const mark = normalized
    .replace(/证券|研究所|研究院|研究|固收|资管/g, "")
    .slice(0, 2);
  return {
    key: "fallback",
    label: institution.trim() || "未知机构",
    mark: mark || "研所",
    foreground: "#475467",
    background: "#f2f4f7",
  };
}

function logo(
  key: string,
  label: string,
  mark: string,
  foreground: string,
  background: string,
  aliases: readonly string[],
): InstitutionLogoDefinition {
  return { key, label, mark, foreground, background, aliases };
}

function normalizeInstitution(value: string): string {
  return value.replace(/[\s·•]/g, "").trim();
}
