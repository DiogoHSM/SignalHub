import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const consoleRoot = process.cwd().endsWith("apps/console") ? process.cwd() : join(process.cwd(), "apps", "console");
const sourceRoot = join(consoleRoot, "src");
const auditedFiles = [
  "v2/screens/OverviewScreen.tsx",
  "v2/screens/TracesScreen.tsx",
  "v2/screens/TenantScreen.tsx",
  "v2/screens/LlmScreen.tsx",
  "v2/screens/analytics/DashboardsTab.tsx"
].map((file) => join(sourceRoot, file));

const BASELINE_STATIC_INLINE_STYLES = 262;
const MAX_STATIC_INLINE_STYLES = Math.floor(BASELINE_STATIC_INLINE_STYLES * 0.75);
const directColor = /(?:#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\s*\(|\bwhite\b)/i;

type Finding = { file: string; line: number; value: string };

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

function isStaticLiteral(node: ts.Expression): boolean {
  return ts.isStringLiteralLike(node)
    || ts.isNumericLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword
    || (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand));
}

function staticInlineStyleCount(files: string[]): number {
  let count = 0;
  for (const file of files) {
    const sourceFile = parse(file);
    const visit = (node: ts.Node): void => {
      if (
        ts.isJsxAttribute(node)
        && ts.isIdentifier(node.name)
        && node.name.text === "style"
        && node.initializer
        && ts.isJsxExpression(node.initializer)
        && node.initializer.expression
        && ts.isObjectLiteralExpression(node.initializer.expression)
        && node.initializer.expression.properties.every(
          (property) => ts.isPropertyAssignment(property) && isStaticLiteral(property.initializer)
        )
      ) {
        count += 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return count;
}

function directColorFindingsInSource(sourceFile: ts.SourceFile, file: string): Finding[] {
  const findings: Finding[] = [];
  const isStyleValue = (node: ts.StringLiteralLike): boolean => {
    const styleName = (name: ts.PropertyName | ts.JsxAttributeName | undefined): boolean => (
      name != null
      && ts.isIdentifier(name)
      && /(COLOR|GRADIENT|BACKGROUND|FILL|STROKE)/i.test(name.text)
    );
    let parent: ts.Node | undefined = node.parent;
    while (parent) {
      if (ts.isJsxAttribute(parent)) {
        if ((ts.isIdentifier(parent.name) && parent.name.text === "style") || styleName(parent.name)) return true;
      }
      if (ts.isVariableDeclaration(parent)) {
        if (ts.isIdentifier(parent.name) && /(COLOR|GRADIENT)/.test(parent.name.text)) return true;
      }
      if (ts.isPropertyAssignment(parent) && styleName(parent.name)) return true;
      if (ts.isFunctionDeclaration(parent) && styleName(parent.name)) return true;
      parent = parent.parent;
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && isStyleValue(node) && directColor.test(node.text)) {
      findings.push({
        file,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        value: node.text
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function directColorFindings(files: string[]): Finding[] {
  return files.flatMap((file) => directColorFindingsInSource(
    parse(file),
    relative(consoleRoot, file).replaceAll("\\", "/")
  ));
}

describe("audited console style source contracts", () => {
  it("contains no direct color literals in audited TSX", () => {
    expect(directColorFindings(auditedFiles)).toEqual([]);
  });

  it("scans style values and named color data without treating comments or copy as CSS", () => {
    const fixture = ts.createSourceFile(
      "fixture.tsx",
      `// #fff is explanatory copy
       const copy = "white";
       const SERIES_COLORS = ["currentColor", "#58a6ff"];
       function severityColor() { return "hsl(12 80% 50%)"; }
       export const Example = () => <div aria-label="white" style={{ color: "rgb(1, 2, 3)", background: "transparent" }} />;`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    expect(directColorFindingsInSource(fixture, "fixture.tsx").map(({ value }) => value)).toEqual([
      "#58a6ff",
      "hsl(12 80% 50%)",
      "rgb(1, 2, 3)"
    ]);
  });

  it("reduces the 262-style historical baseline by at least 25 percent", () => {
    expect(staticInlineStyleCount(auditedFiles)).toBeLessThanOrEqual(MAX_STATIC_INLINE_STYLES);
  });
});
