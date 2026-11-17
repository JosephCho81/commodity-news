// api/_lib/exploreLenses.js — 세계 동향 탐색의 관점·프롬프트·출력 형식(glove-news 2026-11-17 방식을 이 품목에 맞게 다시 씀).
// 고정 검색어·매체 목록으로는 예상 못 한 사건을 못 잡는다 — 무엇을 찾을지는 LLM이 관점 안에서 정하고, 찾은 것은 코드가 원문과 대조한다.
// 관점은 품목의 "용도"와 공급 사슬에서 나왔다: 합금철·가탄제·알루미늄 탈산제는 제강에 들어가고(철강 수요),
// 알루미늄은 자동차·건설·포장·전력망에 쓰이며, 2차 알루미늄은 스크랩 수급과 다이캐스팅(자동차 부품)에 묶인다.
// 4개는 고정, 1개는 그날 신호를 보고 LLM이 스스로 정한다(사람이 떠올린 범위에 갇히지 않게).

export const LENSES = [
  { key: 'steel', name: '제강·철강 수요', brief: '합금철(페로실리콘·실리콘망간·페로망간)·가탄제·알루미늄 탈산제를 쓰는 제강 현장의 가동을 움직이는 일 — 중국·한국·일본·인도·튀르키예·유럽·미국의 조강 생산과 감산·증산, 전기로·고로 가동률, 건설·조선·자동차·기계·에너지 설비의 철강 수요, 철강 재고·가격 급변, 중국 철강 생산 통제·수출 동향' },
  { key: 'aluminium', name: '알루미늄 수요', brief: '알루미늄이 쓰이는 현장의 수요를 움직이는 일 — 자동차(전기차 차체·배터리 케이스·다이캐스팅 부품), 건설(창호·외장재), 포장(음료 캔·호일), 전력망·송전선·태양광 프레임, 항공·방산·전자. 2차 알루미늄(주조 합금)을 쓰는 자동차 부품 생산과 재생 알루미늄 사용 의무도 포함' },
  { key: 'supply', name: '공급·원가', brief: '품목을 만드는 쪽을 움직이는 일 — 합금철 생산지(중국 닝샤·내몽골·간쑤·칭하이, 말레이시아, 인도, 카자흐스탄, 노르웨이 등)의 감산·증설·전력 요금과 배급, 망간광(남아공·가봉·호주)·규석 공급; 알루미늄 제련소 가동·폐쇄·재가동, 중국 생산 상한, 수력·전력 사정, 보크사이트(기니 등)·알루미나; 알루미늄 스크랩 발생·회수; 가탄제 원료인 무연탄(러시아·중국·베트남)·원료탄·코크스 생산과 탄광 사고·안전 점검; 전력·천연가스·석탄 같은 에너지 가격' },
  { key: 'policy', name: '정책·무역·물류', brief: '나라 사이를 오가는 길을 바꾸는 일 — 관세(미국 철강·알루미늄 관세 등)·반덤핑·세이프가드, 유럽 탄소국경조정제도, 대러 제재(러시아 무연탄·알루미늄·합금철), 중국 수출 통제·수출세·증치세 환급 변경, 알루미늄 스크랩 수출 제한, 한국의 수입 규제·통관, 해운 운임·항로·항만 차질(홍해·흑해 등)' },
  { key: 'free', name: '자유 관점', brief: '위 네 관점(제강·철강 수요 / 알루미늄 수요 / 공급·원가 / 정책·무역·물류)에 들지 않지만 합금철·알루미늄(1차·2차)·가탄제·철강의 수요·공급·가격에 영향을 줄 수 있는 일을 스스로 정해 찾는다. 【신호】와 【공지】에서 실마리를 얻고, 국내 제강사의 원료 구매에 직접 닿는 일(한국 철강 업계 동향, 국내 정책, 환율 급변의 배경이 된 사건)을 우선한다' },
];

// 시장 규모 전망 홍보 글·영상·SNS·쇼핑 — glove-news 실측 목록에 금속 분야 홍보 사이트를 더했다
export const DENY_HOSTS = ['openpr.com', 'einpresswire.com', 'marketresearchfuture.com', 'grandviewresearch.com', 'fortunebusinessinsights.com', 'mordorintelligence.com',
  'imarcgroup.com', 'precedenceresearch.com', 'indexbox.io', 'technavio.com', 'researchandmarkets.com', 'marketsandmarkets.com', 'globenewswire.com', 'prnewswire.com',
  'youtube.com', 'reddit.com', 'pinterest.com', 'facebook.com', 'x.com', 'twitter.com', 'linkedin.com', 'instagram.com', 'tiktok.com', 'amazon.com', 'alibaba.com', 'made-in-china.com'];
export const SEARCH_TOOL = { type: 'web_search', max_tokens_per_page: 1500, filters: { search_recency_filter: 'week', search_domain_filter: DENY_HOSTS.map(h => `-${h}`) } };
export const MAX_STEPS = 5;
export const PER_LENS = 3;

export const FIND_INSTRUCTIONS = `웹 검색으로 합금철(페로실리콘·실리콘망간)·알루미늄(1차·2차·스크랩)·가탄제(무연탄 기반 탄소 첨가제)·철강 시장에 영향을 줄 수 있는 최근 사건을 찾습니다. 독자는 한국 제강사의 원료 구매팀입니다.
- 주어진 관점에서 최근 7일 안에 보도·발표된 일을 찾는다. 검색어를 바꿔 가며 여러 번, 현지 언어(영어·중국어·한국어·일본어·러시아어 등)로도 검색한다.
- 지역을 한정하지 않는다(중국·한국·일본·인도·동남아·러시아·유럽·북미·중남미·중동·아프리카·오세아니아). 한 지역 기사만 내지 않는다.
- 기사에 품목 이름이 없어도, 그 품목이 쓰이는 현장(제강소·자동차 공장·건설·전력망·캔 공장)의 수요나 그 품목의 생산·원료·운송을 움직일 일이면 포함한다.
- 사건은 최대 ${PER_LENS}건, 영향이 클 것 같은 것부터. 찾지 못하면 items를 빈 배열로 둔다.
- url: 그 사건을 직접 다룬 기사·공지 페이지 주소. 목록·검색 페이지·PDF·영상·SNS는 안 된다.
- quote: 그 페이지 본문의 문장 하나를 한 글자도 바꾸지 않고 그대로 복사한다. 번역·요약·단어 바꾸기·띄어쓰기 손질 모두 금지(20자 이상). 사건의 핵심 사실이 담긴 문장. 코드가 원문에서 같은 문장을 찾지 못하면 그 사건은 버려진다.
- published: 그 페이지의 발행일 YYYY-MM-DD.
- second_url·second_quote: 같은 사건을 다룬 다른 매체의 주소와 본문 문장(같은 규칙, 한 글자도 바꾸지 않고 복사). 정부·국제기구 공식 페이지나 통신사가 아니면 반드시 채운다. 없으면 빈 문자열.
- 제외: 시장 규모 전망 보고서 홍보 글, 제품 광고, 주가·목표주가 글, 지난 분기 실적 발표, 7일보다 오래된 일, "이미 다룬 사안"과 같은 일(새 진전이 있으면 그 새 기사로).
- 직접 연 페이지만 낸다. 추정으로 주소나 문장을 만들지 않는다.`;

const STR = { type: 'string' };
export const FIND_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['url', 'quote', 'published', 'second_url', 'second_quote'],
        properties: { url: STR, quote: STR, published: STR, second_url: STR, second_quote: STR },
      },
    },
  },
};

export function findInput({ lens, date, signals = [], notices = [], covered = [] }) {
  return [
    `기준일: ${date}`,
    `관점: ${lens.name} — ${lens.brief}`,
    signals.length ? `【신호】 (코드가 받은 공식 통계)\n${signals.join('\n')}` : '',
    notices.length ? `【공지】 (미국 연방관보·무역대표부 최근 공고 제목)\n${notices.map(n => `- ${n.date} ${n.src}: ${n.title}`).join('\n')}` : '',
    covered.length ? `이미 다룬 사안(새 진전이 있을 때만 다시):\n${covered.map(t => `- ${t}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export const MARKET_ENUM = ['ferro', 'al1', 'al2', 'recarb', 'steel'];

export const WRITE_INSTRUCTIONS = `아래 【기사】만 근거로, 국내 제강사 원료 구매팀이 매일 아침 읽는 "세계 동향" 기사를 사안별로 씁니다. 기사 하나가 사안 하나입니다.
독자는 이 글을 보고 당장 사고팔지 않습니다. 분기·기간별 입찰로 구매하므로, 세계에서 무슨 일이 왜 일어났고 어떤 경로로 어느 품목까지 닿으며 앞으로 어떻게 될지를 이해하려고 읽습니다.
- article: 근거 기사 번호.
- title: 사건을 한 줄로(30자 안팎). 숫자는 기사에 있는 것만.
- region: 사건이 일어난 나라·지역 이름(한국어).
- category: demand(수요)·supply(공급)·policy(정책·무역)·logistics(물류)·other 중 하나.
- markets: 영향받는 품목 — "ferro"(합금철), "al1"(알루미늄 1차), "al2"(알루미늄 2차·스크랩), "recarb"(가탄제·무연탄·원료탄·코크스), "steel"(철강 업황) 중 해당하는 것 모두.
- uses: 이 일이 닿는 현장·용도를 짧게(예: "전기로 제강", "자동차 다이캐스팅", "음료 캔", "송전선").
- effect: 그 품목 가격·수급에 주는 방향 — up(수요 증가·공급 감소로 가격을 올리는 쪽), down(그 반대), unclear.
- scale: 국내 제강사 원료 구매에 닿는 크기 — large·medium·small. 한 지역에 그치는 일이면 small. 과장하지 않는다.
- what: 무슨 일이 왜 일어났는지 사실만 2~4문장. 문장마다 cite에 근거 문장 번호("기사-문장", 예 "2-3")를 1~3개 단다. 누가 언제 발표했는지 밝히고, 첫 문장에 주체 이름을 쓴다.
  숫자는 기사에 적힌 값과 단위를 그대로 옮긴다. 환산·반올림·합산 금지. 영어 million·billion은 숫자를 바꾸지 말고 "백만"·"십억"으로 옮긴다(45 million tonnes → 45백만 톤, Mt도 백만 톤). "4,500만 톤"처럼 만·억으로 바꾸면 그 문장은 삭제된다. 기사가 중국어·한국어로 万·亿·만·억을 썼으면 그대로 쓴다.
- relation: 이 일이 품목과 어떻게 이어지는지 한국어 문장 1~2개 — 그 품목이 어느 현장에서 어떻게 쓰이는지, 어떤 경로로 수요·공급·원가에 닿는지. 숫자는 쓰지 않는다. 주소(URL)를 쓰는 칸이 아니다.
- reach: 영향이 어디까지 미칠지 1~2문장 — 지역·품목·시차, 한국 수입 가격·국내 제강사 원료 조달에 닿는 경로. 숫자는 쓰지 않는다. "~할 수 있다", "~로 보인다"처럼 추정으로 쓴다.
- outlook: 앞으로의 예상 1~2문장. 숫자는 쓰지 않는다(기간 표현만). 반드시 "~로 예상된다", "~할 전망이다", "~로 보인다" 같은 추정 표현으로. 영향이 작을 것으로 보이면 그렇게 쓴다.
쓰지 않는 것: 구매 행동 지시("지금 사라", "분할 구매", "구매 유리·불리", "재고 확보"), "확인되지 않는다" 같은 모른다는 문장, 위안 표기(가격은 달러·원으로만, 기사에 위안 금액만 있으면 금액 없이 방향으로), USD 표기(달러로), 기사에 없는 숫자, 지난 날짜를 "앞둔"으로 쓰는 것.
원/달러·원화 방향은 쓰지 않는다(리포트가 코드 계산으로 따로 쓴다).
모든 문장은 한국어 서술체 평서문("~했다", "~이다", "~할 전망이다"). 기사가 다른 언어여도 한국어로 쓴다.
품목과 이어지는 경로를 설명할 수 없는 기사는 사안으로 만들지 않는다.`;

export const WRITE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['article', 'title', 'region', 'category', 'markets', 'uses', 'effect', 'scale', 'what', 'relation', 'reach', 'outlook'],
        properties: {
          article: { type: 'integer' }, title: STR, region: STR,
          category: { type: 'string', enum: ['demand', 'supply', 'policy', 'logistics', 'other'] },
          markets: { type: 'array', items: { type: 'string', enum: MARKET_ENUM } },
          uses: STR,
          effect: { type: 'string', enum: ['up', 'down', 'unclear'] },
          scale: { type: 'string', enum: ['large', 'medium', 'small'] },
          what: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'cite'], properties: { text: STR, cite: { type: 'array', items: STR } } } },
          // 칸 이름을 link로 지으면 모델이 기사 주소를 넣는다(glove-news 2026-11-17 첫 실행 — 7건 전부 탈락)
          relation: STR, reach: STR, outlook: STR,
        },
      },
    },
  },
};
