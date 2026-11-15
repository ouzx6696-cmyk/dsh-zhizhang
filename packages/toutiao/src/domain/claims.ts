import { sha256 } from "@zhizhang/core/fs";

export interface ClaimCandidate {
  id: string;
  text: string;
  kind: "number" | "date" | "quote" | "entity";
  paragraphHash: string;
  sourceId?: string;
  evidence?: string;
  status: "supported" | "unsupported" | "unlocated";
}

const SURNAME =
  "王张李刘陈杨赵黄周吴徐孙马朱胡郭何林罗高郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘蒋蔡余杜叶程苏魏吕丁任沈" +
  "姚卢姜崔钟谭陆汪范金石廖贾夏韦方白邹孟熊秦邱江尹薛段雷侯龙史陶黎贺顾毛郝龚邵万钱严武戴莫孔汤";

const DATE_RE =
  /(?<!\d)\d{4}[-/]\d{1,2}[-/]\d{1,2}(?!\d)|\d{4}年\d{1,2}月(?:\d{1,2}[日号])?|(?<!\d)\d{1,2}月\d{1,2}[日号]/g;

const ORG_RE = new RegExp(
  "(?:(?![在从到去向对给被把是由经据按])[\\u4e00-\\u9fff]){2,14}(?:有限责任公司|股份有限公司|有限公司|集团公司|集团|委员会|研究院|研究所|公安局|派出所|检察院|法院|街道办|居委会|村委会|人社局|医保局|教育局|卫健委|发改委|住建局|民政局|财政局|市场监管局|统计局|税务局|政府|银行|医院|大学|学院|中学|小学|幼儿园|公司|协会|学会|基金会|电视台|报社|出版社)|(?:国务院|教育部|财政部|人社部|民政部|公安部|司法部|商务部|文旅部|交通部|国家统计局|国家医保局)",
  "g"
);

const PERSON_TITLE_RE = new RegExp(
  `老[${SURNAME}]头?|小[${SURNAME}]|[${SURNAME}](?:大爷|大妈|大娘|大叔|阿姨|叔叔|伯伯|婶婶|奶奶|爷爷|师傅|先生|女士|小姐|老师|医生|大夫|主任|经理|老板|厂长|局长|院长|校长|书记|教授|律师|记者|警官|总)`,
  "g"
);

const PERSON_ROLE_RE = new RegExp(
  `(?<=(?:记者|专家|教授|医生|律师|主任|院长|局长|经理|负责人|当事人|民警|法官))([${SURNAME}][\\u4e00-\\u9fff]{1,2})`,
  "g"
);

const PERSON_VERB_RE = new RegExp(
  `([${SURNAME}][\\u4e00-\\u9fff]{1,2})(?=(?:说|表示|指出|强调|认为|提到|介绍|告诉记者|透露|回应|坦言|解释|提醒|建议|宣布))`,
  "g"
);

function extractEntities(para: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  };

  for (const m of para.match(ORG_RE) ?? []) add(m);
  for (const m of para.match(PERSON_TITLE_RE) ?? []) add(m);
  for (const m of para.match(PERSON_ROLE_RE) ?? []) add(m);
  for (const m of para.match(PERSON_VERB_RE) ?? []) add(m);

  return ordered;
}

export function extractClaimCandidates(draftText: string): ClaimCandidate[] {
  const paragraphs = draftText.split(/\r?\n/).filter((p) => p.trim().length > 0);
  const claims: ClaimCandidate[] = [];

  for (const para of paragraphs) {
    const pHash = sha256(para);

    const dateMatches = para.match(DATE_RE) ?? [];
    for (const d of dateMatches) {
      claims.push({
        id: `claim-${claims.length + 1}`,
        text: d,
        kind: "date",
        paragraphHash: pHash,
        status: "unsupported",
      });
    }

    const paraWithoutDates = para.replace(DATE_RE, (m) => " ".repeat(m.length));
    const numMatches = paraWithoutDates.match(/\d+(?:\.\d+)?%?/g) ?? [];
    for (const m of numMatches) {
      claims.push({
        id: `claim-${claims.length + 1}`,
        text: m,
        kind: "number",
        paragraphHash: pHash,
        status: "unsupported",
      });
    }

    const quoteMatches = para.match(/“[^”]{2,120}”/g) ?? [];
    for (const q of quoteMatches) {
      claims.push({
        id: `claim-${claims.length + 1}`,
        text: q,
        kind: "quote",
        paragraphHash: pHash,
        status: "unsupported",
      });
    }

    for (const entity of extractEntities(para)) {
      claims.push({
        id: `claim-${claims.length + 1}`,
        text: entity,
        kind: "entity",
        paragraphHash: pHash,
        status: "unsupported",
      });
    }
  }
  return claims;
}
