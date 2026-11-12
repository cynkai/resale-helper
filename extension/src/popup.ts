// 팝업. 모든 동작은 사용자의 클릭에서만 시작한다(백그라운드 스크립트·콘텐츠 스크립트 없음).
import { AppError, importOne, searchItems } from "./api";
import type { ExtractResult } from "./parsers";
import { buildDraft, toRecord, type PreviewDraft } from "./suggest";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const TOKEN_KEY = "importToken";

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function say(text: string, kind: "ok" | "error" | "" = ""): void {
  const el = $("message");
  el.textContent = text;
  el.className = kind;
}

async function getToken(): Promise<string> {
  const v = (await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY];
  return typeof v === "string" ? v : "";
}

async function refreshTokenStatus(): Promise<void> {
  $("tokenStatus").textContent = (await getToken()) ? "저장됨" : "없음";
}

/** 현재 탭의 문서를 한 번 읽는다. 사용자가 "이 페이지 읽기"를 눌렀을 때만 호출된다. */
async function readActiveTab(): Promise<ExtractResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { supported: false, url: "" };
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extract.js"] });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const g = globalThis as { __resaleHelperClip?: unknown };
        const v = g.__resaleHelperClip;
        delete g.__resaleHelperClip;
        return v;
      },
    });
    const r = res?.result as ExtractResult | undefined;
    if (r && typeof r === "object" && "supported" in r) return r;
  } catch {
    // 브라우저 내부 페이지 등 읽을 수 없는 탭. 값을 채우지 않고 직접 입력으로 넘긴다.
  }
  return { supported: false, url: tab.url ?? "" };
}

function fill(d: PreviewDraft): void {
  ($("priceType") as HTMLSelectElement).value = d.priceType;
  $("typeNote").textContent = d.priceType
    ? "페이지에 표시된 판매 상태에서 제안한 값입니다. 맞는지 확인해 주세요."
    : "판매 상태를 읽지 못했습니다. 페이지를 보고 직접 골라 주세요.";
  ($("amount") as HTMLInputElement).value = d.amount;
  ($("condition") as HTMLSelectElement).value = d.condition;
  ($("checkedDate") as HTMLInputElement).value = d.checkedDate;
  ($("checkedDate") as HTMLInputElement).max = d.checkedDate;
  ($("sourceName") as HTMLInputElement).value = d.sourceName;
  ($("sourceUrl") as HTMLInputElement).value = d.sourceUrl;
  ($("externalId") as HTMLInputElement).value = d.externalId;
  ($("memo") as HTMLInputElement).value = d.memo;
  ($("confirm") as HTMLInputElement).checked = false;
  const list = $("problems");
  list.replaceChildren(
    ...d.problems.map((p) => {
      const li = document.createElement("li");
      li.textContent = p;
      return li;
    }),
  );
  list.hidden = d.problems.length === 0;
  $("preview").hidden = false;
}

async function findItems(): Promise<void> {
  const token = await getToken();
  if (!token) return say("먼저 가져오기 토큰을 저장해 주세요.", "error");
  try {
    const items = await searchItems(token, ($("itemQuery") as HTMLInputElement).value);
    const box = $("items");
    box.replaceChildren(
      ...items.map((it) => {
        const label = document.createElement("label");
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "item";
        radio.value = String(it.id);
        label.append(radio, document.createTextNode(`${it.name}${it.identifier ? ` (${it.identifier})` : ""}`));
        return label;
      }),
    );
    say(items.length === 0 ? "조건에 맞는 물건이 없습니다. 앱에서 물건을 먼저 등록해 주세요." : "");
  } catch (e) {
    say(e instanceof AppError ? e.message : "물건 목록을 가져오지 못했습니다.", "error");
  }
}

async function save(ev: Event): Promise<void> {
  ev.preventDefault();
  const token = await getToken();
  if (!token) return say("먼저 가져오기 토큰을 저장해 주세요.", "error");
  const picked = document.querySelector<HTMLInputElement>('input[name="item"]:checked');
  if (!picked) return say("연결할 물건을 골라 주세요.", "error");
  const v = (id: string) => ($(id) as HTMLInputElement | HTMLSelectElement).value;
  if (!v("priceType")) return say("가격 유형을 골라 주세요.", "error");
  if (!/^\d{1,12}$/.test(v("amount").replace(/,/g, "").trim())) return say("가격을 숫자(원)로 입력해 주세요.", "error");
  if (!v("sourceName").trim()) return say("출처 이름을 입력해 주세요.", "error");
  if (!($("confirm") as HTMLInputElement).checked) return say("내용을 페이지와 대조해 확인했다고 표시해 주세요.", "error");

  const button = $("save") as HTMLButtonElement;
  button.disabled = true;
  try {
    const row = await importOne(
      token,
      Number(picked.value),
      toRecord({
        priceType: v("priceType"),
        amount: v("amount"),
        sourceName: v("sourceName"),
        sourceUrl: v("sourceUrl"),
        externalId: v("externalId"),
        memo: v("memo"),
        condition: v("condition"),
        checkedDate: v("checkedDate"),
      }),
    );
    if (row.ok) say("저장했습니다. 앱의 물건 상세 화면에서 확인할 수 있습니다.", "ok");
    else say(row.error ?? "저장하지 못했습니다.", "error");
  } catch (e) {
    say(e instanceof AppError ? e.message : "저장하지 못했습니다.", "error");
  } finally {
    button.disabled = false;
  }
}

$("extId").textContent = chrome.runtime.id;
void refreshTokenStatus();

$("saveToken").addEventListener("click", async () => {
  const input = $("token") as HTMLInputElement;
  const t = input.value.trim();
  if (!t) return say("토큰을 붙여 넣어 주세요.", "error");
  await chrome.storage.local.set({ [TOKEN_KEY]: t });
  input.value = "";
  await refreshTokenStatus();
  say("토큰을 이 브라우저에 저장했습니다.", "ok");
});
$("clearToken").addEventListener("click", async () => {
  await chrome.storage.local.remove(TOKEN_KEY);
  await refreshTokenStatus();
  say("토큰을 지웠습니다.");
});
$("readPage").addEventListener("click", async () => {
  say("");
  fill(buildDraft(await readActiveTab(), todayYmd()));
});
$("findItems").addEventListener("click", () => void findItems());
$("preview").addEventListener("submit", (ev) => void save(ev));
