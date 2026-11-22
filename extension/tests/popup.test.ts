import { readFileSync } from "node:fs";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const html = readFileSync(path.resolve(import.meta.dirname, "../static/popup.html"), "utf8");
const storage: Record<string, unknown> = {};
const request = vi.fn<typeof fetch>();
const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`);
const radio = () => document.querySelector<HTMLInputElement>('input[name="item"]');

beforeEach(async () => {
  vi.resetModules();
  request.mockReset();
  for (const key of Object.keys(storage)) delete storage[key];
  Object.assign(storage, { importToken: "old", lastItem: { id: 7, label: "이전 기기" } });
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script, link").forEach((node) => node.remove());
  document.body.replaceChildren(template.content);
  vi.stubGlobal("fetch", request);
  vi.stubGlobal("chrome", {
    runtime: { id: "fixture" },
    tabs: { query: async () => [{ id: 1 }] },
    scripting: { executeScript: async () => [{ result: { supported: false, url: "https://example.com/fixture" } }] },
    storage: { local: {
      get: async () => ({ ...storage }),
      set: async (data: Record<string, unknown>) => Object.assign(storage, data),
      remove: async (keys: string[]) => { for (const k of keys) delete storage[k]; },
    } },
  });
  await import("../src/popup");
  button("readPage")?.click();
  await vi.waitFor(() => expect(radio()?.value).toBe("7"));
  radio()?.click();
});
afterEach(() => vi.unstubAllGlobals());

it("새 매물을 읽으면 구성 판단과 물건 선택을 다시 받는다", async () => {
  const match = document.querySelector<HTMLSelectElement>("#componentsMatch");
  const confirmation = document.querySelector<HTMLInputElement>("#confirm");
  if (!match || !confirmation) throw new Error("미리보기 필드 누락");
  match.value = "NO";
  confirmation.checked = true;
  button("readPage")?.click();
  await vi.waitFor(() => expect(radio()?.checked).toBe(false));
  expect(confirmation.checked).toBe(false);
  expect(match.value).toBe("");
});

it.each(["saveToken", "clearToken"])("토큰 변경 후 이전 선택과 늦게 도착한 검색 결과를 버린다 (%s)", async (action) => {
  let finish: (value: Response) => void = () => { throw new Error("검색이 실행되지 않았습니다."); };
  request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  button("findItems")?.click();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  const token = document.querySelector<HTMLInputElement>("#token");
  if (!token) throw new Error("토큰 필드 누락");
  token.value = "replacement";
  button(action)?.click();
  await vi.waitFor(() => expect(storage.importToken).toBe(action === "saveToken" ? "replacement" : undefined));
  finish(Response.json({ items: [{ id: 3, name: "늦은 검색", identifier: null }] }));
  await setImmediate();
  expect(radio()).toBeNull();
  expect(storage.lastItem).toBeFalsy();
});

it("새 검색이 실패하면 전에 선택한 물건을 저장 대상으로 남겨두지 않는다", async () => {
  request.mockResolvedValueOnce(Response.json({ error: "검색 실패" }, { status: 503 }));
  button("findItems")?.click();
  await vi.waitFor(() => expect(document.getElementById("message")?.textContent).toBe("검색 실패"));
  expect(radio()).toBeNull();
});

it("사용자가 새 검색으로 고른 물건과 다시 확인한 구성만 저장한다", async () => {
  const match = document.querySelector<HTMLSelectElement>("#componentsMatch");
  const confirmation = document.querySelector<HTMLInputElement>("#confirm");
  if (!match || !confirmation) throw new Error("미리보기 필드 누락");
  match.value = "NO";
  confirmation.checked = true;
  request.mockResolvedValueOnce(Response.json({ items: [{ id: 8, name: "새 기기", identifier: null }] }));
  button("findItems")?.click();
  await vi.waitFor(() => expect(radio()?.value).toBe("8"));
  radio()?.click();
  for (const [id, value] of [["priceType", "ASKING"], ["amount", "1000"], ["sourceName", "테스트 장터"]] as const) {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    if (control) control.value = value;
  }
  request.mockResolvedValueOnce(Response.json({ results: [{ ok: true }] }));
  confirmation.checked = true;
  button("save")?.click();
  await vi.waitFor(() => expect(storage.lastItem).toEqual({ id: 8, label: "새 기기" }));
  const body = request.mock.calls.at(-1)?.[1]?.body;
  if (typeof body !== "string") throw new Error("저장 요청 본문 누락");
  expect(JSON.parse(body)).toMatchObject({ itemId: 8, records: [{ amount: "1000" }] });
  expect(JSON.parse(body).records[0]).not.toHaveProperty("components_match");
});
