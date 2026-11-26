import { describe, expect, it, vi } from "vitest";
import { readJsonBody } from "@/lib/import/http";
import { MAX_IMPORT_BODY_BYTES } from "@/lib/import/records";

function request(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    duplex: "half",
  };
  return new Request("http://127.0.0.1:3000/api/import/prices", init);
}

describe("가져오기 요청 본문", () => {
  it.each([undefined, "10"])("Content-Length가 %s여도 실제 바이트 상한을 넘으면 읽기를 멈춘다", async (length) => {
    const cancel = vi.fn();
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(reads === 1 ? MAX_IMPORT_BODY_BYTES : 1));
        if (reads === 4) controller.close();
      },
      cancel,
    }, { highWaterMark: 0 });

    const req = request(stream, length ? { "Content-Length": length } : {});
    await expect(readJsonBody(req)).resolves.toMatchObject({ ok: false, status: 413 });
    expect(reads).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("정확히 상한인 JSON과 조각 사이에 걸친 한글을 읽는다", async () => {
    const json = JSON.stringify({ memo: "값" });
    const bytes = new TextEncoder().encode(json.padEnd(MAX_IMPORT_BODY_BYTES - Buffer.byteLength(json) + json.length));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 10));
        controller.enqueue(bytes.subarray(10));
        controller.close();
      },
    });
    await expect(readJsonBody(request(stream, { "Content-Type": "Application/JSON; charset=UTF-8" })))
      .resolves.toEqual({ ok: true, body: { memo: "값" } });
  });

  it("JSON과 비슷한 미디어 유형을 받지 않는다", async () => {
    const req = new Request("http://127.0.0.1:3000/api/import/prices", {
      method: "POST", headers: { "Content-Type": "application/jsonp" }, body: "{}",
    });
    await expect(readJsonBody(req)).resolves.toMatchObject({ ok: false, status: 415 });
  });

  it("깨진 UTF-8을 다른 문자로 바꿔 저장하지 않는다", async () => {
    const req = new Request("http://127.0.0.1:3000/api/import/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: new Uint8Array([34, 255, 34]),
    });
    await expect(readJsonBody(req)).resolves.toMatchObject({ ok: false, status: 400 });
  });
});
