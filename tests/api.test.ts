import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CrewLanApiClient,
  CrewLanApiError,
  normalizeBaseUrl,
  parseServerSentEvents,
} from "../src/api.js";

describe("CrewLAN API client helpers", () => {
  it("normalizes base URLs", () => {
    assert.equal(normalizeBaseUrl("http://127.0.0.1:4848///"), "http://127.0.0.1:4848");
    assert.equal(
      normalizeBaseUrl("http://crewlan.local:4848/api///?debug=1#hash"),
      "http://crewlan.local:4848",
    );
    assert.equal(
      normalizeBaseUrl("http://crewlan.local:4848/api/v1"),
      "http://crewlan.local:4848",
    );
  });

  it("rejects invalid base URLs with useful errors", () => {
    assert.throws(() => normalizeBaseUrl("not a url"), CrewLanApiError);
    assert.throws(() => normalizeBaseUrl("ftp://crewlan.local"), /http:\/\/ or https:\/\//u);
  });

  it("parses complete server-sent events and ignores comments", () => {
    const events = parseServerSentEvents(
      [
        ": keepalive",
        "",
        "id: 1",
        "event: status.changed",
        "data: {\"type\":\"status.changed\",\"data\":{\"entityId\":\"alex\"}}",
        "",
      ].join("\n"),
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "status.changed");
  });

  it("parses multiline CRLF server-sent event data", () => {
    const events = parseServerSentEvents(
      [
        "id: 2",
        "event: status.changed",
        'data: {"type":"status.changed",',
        'data: "data":{"entityId":"alex"}}',
        "",
      ].join("\r\n"),
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "status.changed");
    assert.deepEqual(events[0]?.data, { entityId: "alex" });
  });

  it("dismisses entity alerts through the Public API", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedMethod = "";
    let requestedAuthorization = "";

    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedMethod = String(init?.method ?? "GET");
      requestedAuthorization = String(new Headers(init?.headers).get("authorization") ?? "");

      return new Response(
        JSON.stringify({
          data: {
            status: "updated",
            entityId: "participant-alex",
            dismissedCount: 2,
          },
          meta: {
            apiVersion: "v1",
            revision: 14,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    };

    try {
      const client = new CrewLanApiClient({
        baseUrl: "http://127.0.0.1:4848",
        token: "cle_test-token",
      });
      const result = await client.dismissEntityAlerts("participant-alex");

      assert.equal(
        requestedUrl,
        "http://127.0.0.1:4848/api/v1/entities/participant-alex/alerts/dismiss",
      );
      assert.equal(requestedMethod, "POST");
      assert.equal(requestedAuthorization, "Bearer cle_test-token");
      assert.equal(result.status, "updated");
      assert.equal(result.entityId, "participant-alex");
      assert.equal(result.dismissedCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
