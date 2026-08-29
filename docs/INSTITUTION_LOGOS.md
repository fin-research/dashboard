# 券商研究所 Logo 资源

卖方观点使用本地静态图片，不在浏览器运行时请求第三方资源。图片保持官网原始比例，只通过 `object-fit: contain` 缩放，不裁切、不重绘、不改色。

| 机构 | 本地文件 | 官方来源 |
| --- | --- | --- |
| 德邦证券 | `static/institution-logos/tebon.png` | `https://www.tebon.com.cn/front/images/logo_02.png` |
| 招商证券 | `static/institution-logos/cms.png` | `https://www.newone.com.cn/newonefront/images/logo.png` |
| 国联民生证券 | `static/institution-logos/glms.png` | 国联民生官方招聘站 `https://glsc.zhiye.com/` 配置的 Logo 资源 |
| 申万宏源证券 | `static/institution-logos/swhy.png` | `https://www.swhysc.com/swhysc/img/headlogo.ee48884c.png` |
| 兴业证券 | `static/institution-logos/xyzq.png` | `https://www.xyzq.com.cn/xysec/views/theme/img/indexv2/logo_bg.png` |

新增机构时必须先从该机构官网或官方招聘、投资者关系站取得真实品牌图片，再在 `src/lib/sell-side-institutions.ts` 增加别名映射。未收录机构只展示机构名称，不生成文字缩写或仿制 Logo。
