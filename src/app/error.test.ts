/** REACT-4: the route error boundary explains a server error instead of showing React's minified text. */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ErrorPage from "./error";

describe("route error boundary", () => {
  it("a server error (digest) shows the terminal hint and a reload button, not “Minified React error #441”", () => {
    const err = Object.assign(new Error("Minified React error #441; visit https://react.dev/errors/441 for the full message"), {
      digest: "3424018828",
    });
    const html = renderToStaticMarkup(h(ErrorPage, { error: err, reset: () => {} }));
    expect(html).toContain("The server could not render this page");
    expect(html).toContain("printed in the terminal running the app");
    expect(html).toContain("reload the page");
    expect(html).toContain("Reload page");
    expect(html).toContain("Digest: 3424018828");
    expect(html).not.toContain("Minified React error");
  });
  it("a client error (no digest) still shows its message", () => {
    const html = renderToStaticMarkup(h(ErrorPage, { error: new Error("Cannot read properties of undefined"), reset: () => {} }));
    expect(html).toContain("Cannot read properties of undefined");
    expect(html).not.toContain("The server could not render this page");
  });
});
