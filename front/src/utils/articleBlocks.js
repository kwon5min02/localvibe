/**
 * API 아티클(plain text / JSON) → RegionModal ArticleBody 블록 스키마
 * types: lead | subheader | paragraph | quote
 */

const SECTION_RULES = [
  { header: '추천 메뉴', test: s => /메뉴|맛집|요리|음식|라자냐|파스타|스테이크|코스|시그니처|대표/.test(s) },
  { header: '분위기 & 뷰', test: s => /분위기|뷰|야경|전망|인테리어|공간|감성|로맨틱|데이트/.test(s) },
  { header: '영업 시간', test: s => /영업\s*시간|운영\s*시간|브레이크|휴무|라스트\s*오더|\d{1,2}\s*:\s*\d{2}/.test(s) },
  { header: '주차 & 오시는 길', test: s => /주차|대중교통|지하철|버스|역\s*근처|찾아가|주소/.test(s) },
  { header: '방문 팁', test: s => /추천|예약|대기|방문|팁|알아두|주말|평일/.test(s) },
];

function tryParseJsonBlocks(raw) {
  const t = String(raw || '').trim();
  if (!t.startsWith('{') && !t.startsWith('[')) {
    return null;
  }
  try {
    const data = JSON.parse(t);
    if (Array.isArray(data)) {
      return normalizeBlocks(data);
    }
    if (Array.isArray(data?.blocks)) {
      return normalizeBlocks(data.blocks);
    }
    if (data?.lead || data?.sections) {
      return structuredPayloadToBlocks(data);
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeBlocks(blocks) {
  return blocks
    .filter(b => b && b.text && String(b.text).trim())
    .map(b => ({
      type: b.type || 'paragraph',
      text: String(b.text).trim(),
      attribution: b.attribution || undefined,
    }));
}

function structuredPayloadToBlocks(data) {
  const out = [];
  if (data.lead) {
    out.push({ type: 'lead', text: String(data.lead).trim() });
  }
  for (const sec of data.sections || []) {
    const heading = String(sec.heading || sec.title || '').trim();
    if (heading) {
      out.push({ type: 'subheader', text: heading });
    }
    const paras = sec.paragraphs || (sec.text ? [sec.text] : []);
    for (const p of paras) {
      const text = String(p || '').trim();
      if (text) {
        out.push({ type: 'paragraph', text });
      }
    }
  }
  if (data.quote?.text) {
    out.push({
      type: 'quote',
      text: String(data.quote.text).trim(),
      attribution: data.quote.attribution || '— 방문 후기',
    });
  }
  if (data.visit_tip) {
    out.push({ type: 'subheader', text: '방문 전 알아두면 좋은 것' });
    out.push({ type: 'paragraph', text: String(data.visit_tip).trim() });
  }
  return out;
}

function splitSentences(text) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return [];
  }

  const sentences = [];
  let buf = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    buf += ch;
    if (ch === '.' || ch === '!' || ch === '?' || ch === '。') {
      const tail = normalized.slice(i + 1, i + 4);
      if (/^\s*\d/.test(tail)) {
        continue;
      }
      const piece = buf.trim();
      if (piece) {
        sentences.push(piece);
      }
      buf = '';
    }
  }
  if (buf.trim()) {
    sentences.push(buf.trim());
  }
  return sentences.length > 0 ? sentences : [normalized];
}

function extractQuote(sentences) {
  const rest = [];
  let quote = null;
  for (const s of sentences) {
    const m = s.match(/[""]([^""]+)[""]/) || s.match(/['']([^'']+)['']/);
    if (m && m[1].length > 12 && m[1].length < 120) {
      quote = { type: 'quote', text: `"${m[1].trim()}"`, attribution: '— 방문 후기' };
      const cleaned = s.replace(m[0], '').trim();
      if (cleaned) {
        rest.push(cleaned);
      }
    } else {
      rest.push(s);
    }
  }
  return { sentences: rest, quote };
}

function classifySentence(sentence) {
  for (const rule of SECTION_RULES) {
    if (rule.test(sentence)) {
      return rule.header;
    }
  }
  return '이곳의 이야기';
}

function groupSentencesBySection(sentences) {
  const groups = new Map();
  const order = [];

  for (const s of sentences) {
    const key = classifySentence(s);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(s);
  }

  return order.map(header => ({ header, sentences: groups.get(header) }));
}

function splitParagraphChunks(sentences, maxChars = 320) {
  const chunks = [];
  let buf = '';

  for (const s of sentences) {
    const next = buf ? `${buf} ${s}` : s;
    if (next.length > maxChars && buf) {
      chunks.push(buf);
      buf = s;
    } else {
      buf = next;
    }
  }
  if (buf) {
    chunks.push(buf);
  }
  return chunks;
}

/** plain text / JSON → ArticleBody blocks */
export function parseArticleContentToBlocks(content, region = {}) {
  const fromJson = tryParseJsonBlocks(content);
  if (fromJson?.length) {
    return fromJson;
  }

  const text = String(content || '').trim();
  if (!text) {
    return [];
  }

  if (text.includes('\n\n')) {
    const parts = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const blocks = [{ type: 'lead', text: parts[0] }];
      for (let i = 1; i < parts.length; i += 1) {
        const part = parts[i];
        const firstLine = part.split('\n')[0].trim();
        const isShortHeader =
          firstLine.length <= 28 &&
          !/[.!?。]$/.test(firstLine) &&
          part.includes('\n');
        if (isShortHeader) {
          blocks.push({ type: 'subheader', text: firstLine });
          const body = part.slice(firstLine.length).trim();
          if (body) {
            blocks.push({ type: 'paragraph', text: body });
          }
        } else if (
          firstLine.length <= 24 &&
          !/[.!?。]$/.test(firstLine) &&
          i === 1 &&
          parts.length > 2
        ) {
          blocks.push({ type: 'subheader', text: firstLine });
          blocks.push({
            type: 'paragraph',
            text: part.slice(firstLine.length).trim() || part,
          });
        } else {
          blocks.push({ type: 'paragraph', text: part });
        }
      }
      return blocks;
    }
  }

  let sentences = splitSentences(text);
  const { sentences: withoutQuote, quote } = extractQuote(sentences);
  sentences = withoutQuote;

  const leadCount = Math.min(2, Math.max(1, Math.floor(sentences.length * 0.15)));
  const lead = sentences.slice(0, leadCount).join(' ');
  const bodySentences = sentences.slice(leadCount);

  const blocks = [];
  if (lead) {
    blocks.push({ type: 'lead', text: lead });
  }

  const groups = groupSentencesBySection(bodySentences);
  for (const { header, sentences: groupSents } of groups) {
    if (!groupSents.length) {
      continue;
    }
    blocks.push({ type: 'subheader', text: header });
    for (const para of splitParagraphChunks(groupSents)) {
      blocks.push({ type: 'paragraph', text: para });
    }
  }

  if (quote) {
    blocks.push(quote);
  }

  if (blocks.length <= 1 && text) {
    return [
      { type: 'lead', text: text.slice(0, Math.min(280, text.length)) },
      ...(text.length > 280
        ? [{ type: 'subheader', text: '상세 정보' }, { type: 'paragraph', text: text.slice(280) }]
        : []),
    ];
  }

  return blocks;
}

export function buildArticleDisplayData(article, region) {
  const name = region?.name || '이 장소';
  const regionName = region?.region || region?.province || '이 지역';
  const summary = String(region?.summary || '').trim();

  const fallback = {
    title: `${name}, 로컬이 사랑하는 이유`,
    author: 'LocalVibe 에디터',
    date: new Date().toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    body: [
      {
        type: 'lead',
        text: `${regionName}에서 진짜 로컬을 만나고 싶다면, 관광지도를 잠시 접어두자. ${name}은 그런 곳이다.`,
      },
      { type: 'subheader', text: '지역이 품은 이야기' },
      {
        type: 'paragraph',
        text:
          summary ||
          `${name}은 입소문을 타며 여행객에게도 알려지기 시작한 공간이다.`,
      },
      { type: 'subheader', text: '공간이 주는 감각' },
      {
        type: 'paragraph',
        text: `${name}에 들어서면 서두르지 않아도 된다는 느낌이 든다. 테이블, 음악, 창밖 풍경이 자연스럽게 어우러진다.`,
      },
      {
        type: 'quote',
        text: `"처음 왔을 때 그냥 지나칠 뻔했어요. 이제는 ${regionName} 오면 꼭 들르는 곳이 됐어요."`,
        attribution: '— 방문객 후기',
      },
      { type: 'subheader', text: '방문 전 알아두면 좋은 것' },
      {
        type: 'paragraph',
        text: `주말 오후는 붐빌 수 있다. 여유롭게 즐기려면 평일 오전·저녁을 추천한다.`,
      },
    ],
  };

  const hasReal =
    article &&
    (article.title || article.content) &&
    !String(article.content || '').includes('오류') &&
    !String(article.content || '').includes('불러오지 못') &&
    String(article.content || '').length > 30;

  if (!hasReal) {
    return fallback;
  }

  const blocksFromApi =
    Array.isArray(article.blocks) && article.blocks.length > 0
      ? normalizeBlocks(article.blocks)
      : parseArticleContentToBlocks(article.content, region);

  const body =
    blocksFromApi.length > 0 ? blocksFromApi : fallback.body;

  return {
    title: String(article.title || '').trim() || fallback.title,
    author: 'LocalVibe AI',
    date: '',
    body,
  };
}
