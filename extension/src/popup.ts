// 팝업. 모든 동작은 사용자의 클릭에서만 시작한다(백그라운드 스크립트·콘텐츠 스크립트 없음).
import { AppError, editUrl, importOne, searchItems } from "./api";
import type { ExtractResult } from "./parsers";
import { buildDraft, parseLastItem, toRecord, type LastItem, type PreviewDraft } from "./suggest";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const TOKEN_KEY = "importToken";
const LAST_ITEM_KEY = "lastItem";
let itemRevision = 0;

function resetComparison(): void {
  $<HTMLSelectElement>("componentsMatch").value = "";
  $<HTMLInputElement>("confirm").checked = false;
}

function clearItemChoices(): number {
  $("items").replaceChildren();
  resetComparison();
  return ++itemRevision;
}

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function say(text: string, kind: "ok" | "error" | "" = "", link?: { href: string; label: string }): void {
  const el = $("message");
  el.textContent = text;
  el.className = kind;
  if (link) {
    // 로컬 앱 화면으로 가는 링크만 붙인다(새 탭).
    const a = document.createElement("a");
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = link.label;
    el.append(" ", a);
  }
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

function itemRadio(id: number, text: string): HTMLLabelElement {
  const label = document.createElement("label");
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "item";
  radio.value = String(id);
  label.append(radio, document.createTextNode(text));
  return label;
}

/** 지난번에 저장한 물건을 선택지 하나로 보여 준다(고르지는 않는다). 검색하면 검색 결과로 바뀐다. */
async function showLastItem(revision: number): Promise<void> {
  const last = parseLastItem((await chrome.storage.local.get(LAST_ITEM_KEY))[LAST_ITEM_KEY]);
  if (!last || revision !== itemRevision) return;
  $("items").replaceChildren(itemRadio(last.id, `${last.label} — 지난번에 고른 물건`));
}

async function findItems(): Promise<void> {
  const revision = clearItemChoices();
  const query = $<HTMLInputElement>("itemQuery").value;
  const token = await getToken();
  if (revision !== itemRevision) return;
  if (!token) return say("먼저 가져오기 토큰을 저장해 주세요.", "error");
  try {
    const items = await searchItems(token, query);
    if (revision !== itemRevision) return;
    const box = $("items");
    box.replaceChildren(
      ...items.map((it) => itemRadio(it.id, `${it.name}${it.identifier ? ` (${it.identifier})` : ""}`)),
    );
    say(items.length === 0 ? "조건에 맞는 물건이 없습니다. 앱에서 물건을 먼저 등록해 주세요." : "");
  } catch (e) {
    if (revision !== itemRevision) return;
    say(e instanceof AppError ? e.message : "물건 목록을 가져오지 못했습니다.", "error");
  }
}

async function save(ev: Event): Promise<void> {
  ev.preventDefault();
  const revision = itemRevision;
  const token = await getToken();
  if (revision !== itemRevision) return;
  if (!token) return say("먼저 가져오기 토큰을 저장해 주세요.", "error");
  const picked = document.querySelector<HTMLInputElement>('input[name="item"]:checked');
  if (!picked) return say("연결할 물건을 골라 주세요.", "error");
  const v = (id: string) => ($(id) as HTMLInputElement | HTMLSelectElement).value;
  if (!v("priceType")) return say("가격 유형을 골라 주세요.", "error");
  if (!/^\d{1,12}$/.test(v("amount").replace(/,/g, "").trim())) return say("가격을 숫자(원)로 입력해 주세요.", "error");
  if (!v("sourceName").trim()) return say("출처 이름을 입력해 주세요.", "error");
  if (!($("confirm") as HTMLInputElement).checked) return say("내용을 페이지와 대조해 확인했다고 표시해 주세요.", "error");

  const button = $("save") as HTMLButtonElement;
  if (button.disabled) return;
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
        componentsMatch: v("componentsMatch"),
        checkedDate: v("checkedDate"),
      }),
    );
    if (revision !== itemRevision) return;
    if (row.ok) {
      $<HTMLInputElement>("confirm").checked = false;
      say("저장했습니다. 앱의 물건 상세 화면에서 확인할 수 있습니다.", "ok");
      // 같은 물건에 매물을 이어 담을 때 다시 찾지 않도록, 고른 물건의 번호와 이름만 기억한다.
      const label = (picked.parentElement?.textContent ?? "").replace(/ — 지난번에 고른 물건$/, "");
      const last: LastItem = { id: Number(picked.value), label };
      await chrome.storage.local.set({ [LAST_ITEM_KEY]: last });
    }
    else {
      const href = row.duplicateOf !== undefined ? editUrl(Number(picked.value), row.duplicateOf) : null;
      say(row.error ?? "저장하지 못했습니다.", "error", href ? { href, label: "앱에서 그 자료 열기" } : undefined);
    }
  } catch (e) {
    if (revision !== itemRevision) return;
    say(e instanceof AppError ? e.message : "저장하지 못했습니다.", "error");
  } finally {
    button.disabled = false;
  }
}

$("extId").textContent = chrome.runtime.id;
void refreshTokenStatus();

async function updateToken(token: string | null): Promise<void> {
  clearItemChoices();
  $<HTMLInputElement>("itemQuery").value = "";
  const panels = [$("setup"), $("preview"), $("read")];
  for (const panel of panels) panel.inert = true;
  try {
    if (token === null) await chrome.storage.local.remove([TOKEN_KEY, LAST_ITEM_KEY]);
    else await chrome.storage.local.set({ [TOKEN_KEY]: token, [LAST_ITEM_KEY]: null });
    $<HTMLInputElement>("token").value = "";
    await refreshTokenStatus();
    say(token === null ? "토큰을 지웠습니다." : "토큰을 이 브라우저에 저장했습니다.", token === null ? "" : "ok");
  } finally {
    for (const panel of panels) panel.inert = false;
  }
}

$("saveToken").addEventListener("click", () => {
  const token = $<HTMLInputElement>("token").value.trim();
  if (!token) return say("토큰을 붙여 넣어 주세요.", "error");
  void updateToken(token);
});
$("clearToken").addEventListener("click", () => void updateToken(null));
$("readPage").addEventListener("click", async () => {
  const revision = clearItemChoices();
  $("preview").hidden = true;
  $<HTMLInputElement>("itemQuery").value = "";
  say("");
  const draft = buildDraft(await readActiveTab(), todayYmd());
  if (revision !== itemRevision) return;
  fill(draft);
  await showLastItem(revision);
});
$("itemQuery").addEventListener("input", clearItemChoices);
$("items").addEventListener("change", () => {
  itemRevision++;
  resetComparison();
});
$("itemQuery").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  void findItems();
});
$("findItems").addEventListener("click", () => void findItems());
$("preview").addEventListener("submit", (ev) => void save(ev));
