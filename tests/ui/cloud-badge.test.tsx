import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CloudBadge from "@/components/admin/cloud/CloudBadge";

/**
 * CloudBadge must never crash the page when a status value is missing or
 * malformed (regression: a missing status used to throw TypeError on
 * `status.replace`, which took down the whole Cloud Projects list page).
 */
vi.mock("@/i18n/LanguageProvider", () => ({
  useAdminI18n: () => ({ t: (key: string) => key, dir: "ltr", lang: "en" }),
}));

describe("CloudBadge", () => {
  it("renders without throwing when status is undefined", () => {
    const markup = renderToStaticMarkup(<CloudBadge status={undefined} />);
    expect(markup).toContain("inline-flex");
    expect(markup).not.toContain("undefined");
  });

  it("renders without throwing when status is null", () => {
    const markup = renderToStaticMarkup(<CloudBadge status={null} />);
    expect(markup).toContain("inline-flex");
  });

  it("preserves the translated label for a known status", () => {
    const markup = renderToStaticMarkup(<CloudBadge status="passed" />);
    expect(markup).toContain("cloud.status.passed");
  });

  it("renders an unknown status as a humanized fallback instead of crashing", () => {
    const markup = renderToStaticMarkup(<CloudBadge status="needs_work" />);
    expect(markup).toContain("needs work");
  });

  it("still renders a defined status", () => {
    const markup = renderToStaticMarkup(<CloudBadge status="ready" />);
    expect(markup).toContain("cloud.status.ready");
  });
});