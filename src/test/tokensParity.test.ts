import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixture = resolve(
  process.cwd(),
  "../sealbook/crates/sealbook-protocol/fixtures/design/tokens.json",
);
const tokens = JSON.parse(readFileSync(fixture, "utf8")) as {
  colors: Record<string, string>;
  default_accent: string;
  accents: Record<string, { base: string; dim: string }>;
};

const css = readFileSync(resolve(process.cwd(), "src/popup/styles.css"), "utf8");

function declared(name: string): string | undefined {
  return css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
}

describe("shared design tokens", () => {
  it("the popup stylesheet uses the fixture's colours", () => {
    expect(declared("bg")).toBe(tokens.colors.bg);
    expect(declared("panel")).toBe(tokens.colors.panel);
    expect(declared("line")).toBe(tokens.colors.line);
    expect(declared("text")).toBe(tokens.colors.text);
    expect(declared("muted")).toBe(tokens.colors.mute);
    expect(declared("danger")).toBe(tokens.colors.danger);
  });

  it("its accent is the default accent", () => {
    expect(declared("accent")).toBe(tokens.accents[tokens.default_accent].base);
  });
});
