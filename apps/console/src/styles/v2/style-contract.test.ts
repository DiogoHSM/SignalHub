import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function moduleFilename(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "file:") return fileURLToPath(parsed);
  const pathname = decodeURIComponent(parsed.pathname);
  return process.platform === "win32" && /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
}

const consoleRoot = resolve(dirname(moduleFilename(import.meta.url)), "../../..");
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
  const variables = new Map<string, ts.Expression>();
  const functions = new Map<string, ts.FunctionLikeDeclaration>();
  const findingPositions = new Set<number>();

  const collectDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      variables.set(node.name.text, node.initializer);
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        functions.set(node.name.text, node.initializer);
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      functions.set(node.name.text, node);
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(sourceFile);

  const recordLiteral = (node: ts.StringLiteralLike): void => {
    if (/^var\(\s*--[\w-]+(?:\s*,[^)]*)?\s*\)$/i.test(node.text.trim())) return;
    if (!directColor.test(node.text)) return;
    const position = node.getStart(sourceFile);
    if (findingPositions.has(position)) return;
    findingPositions.add(position);
    findings.push({
      file,
      line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
      value: node.text
    });
  };

  const active = new Set<ts.Node>();
  const resolveFunction = (node: ts.FunctionLikeDeclaration): void => {
    if (!node.body) return;
    if (!ts.isBlock(node.body)) {
      resolveExpression(node.body);
      return;
    }
    const visitReturns = (child: ts.Node): void => {
      if (child !== node.body && ts.isFunctionLike(child)) return;
      if (ts.isReturnStatement(child) && child.expression) resolveExpression(child.expression);
      ts.forEachChild(child, visitReturns);
    };
    visitReturns(node.body);
  };

  const resolveExpression = (node: ts.Expression): void => {
    if (active.has(node)) return;
    active.add(node);
    try {
      if (ts.isStringLiteralLike(node)) {
        recordLiteral(node);
        return;
      }
      if (ts.isIdentifier(node)) {
        const initializer = variables.get(node.text);
        const fn = functions.get(node.text);
        if (initializer) resolveExpression(initializer);
        if (fn && fn !== initializer) resolveFunction(fn);
        return;
      }
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          const fn = functions.get(node.expression.text);
          if (fn) resolveFunction(fn);
          else resolveExpression(node.expression);
        } else {
          resolveExpression(node.expression);
        }
        node.arguments.forEach(resolveExpression);
        return;
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        resolveExpression(node.expression);
        return;
      }
      if (ts.isObjectLiteralExpression(node)) {
        for (const property of node.properties) {
          if (ts.isPropertyAssignment(property)) resolveExpression(property.initializer);
          else if (ts.isShorthandPropertyAssignment(property)) resolveExpression(property.name);
          else if (ts.isSpreadAssignment(property)) resolveExpression(property.expression);
          else if (ts.isMethodDeclaration(property)) resolveFunction(property);
        }
        return;
      }
      if (ts.isArrayLiteralExpression(node)) {
        for (const element of node.elements) {
          if (!ts.isOmittedExpression(element)) resolveExpression(element);
        }
        return;
      }
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        resolveFunction(node);
        return;
      }

      // Fail closed for any other statically reachable expression shape by
      // following every expression child, while leaving copy outside a color
      // consumer untouched.
      ts.forEachChild(node, (child) => {
        if (ts.isExpression(child)) resolveExpression(child);
      });
    } finally {
      active.delete(node);
    }
  };

  const isColorConsumer = (name: ts.JsxAttributeName): boolean => (
    ts.isIdentifier(name)
    && (name.text === "style" || /(color|fill|stroke|background|gradient|palette)/i.test(name.text))
  );
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && isColorConsumer(node.name) && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) recordLiteral(node.initializer);
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        resolveExpression(node.initializer.expression);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings.sort((left, right) => left.line - right.line);
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
       const SERIES_COLORS = ["currentColor", "var(--chart-white)", "#58a6ff"];
       function severityColor() { return "hsl(12 80% 50%)"; }
       export const Example = () => <><Chart colors={SERIES_COLORS} color={severityColor()} /><div aria-label="white" style={{ color: "rgb(1, 2, 3)", background: "transparent" }} /></>;`,
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

  it("follows arrays through neutral identifiers from color consumers", () => {
    const fixture = ts.createSourceFile(
      "array-alias.tsx",
      `const SERIES = ["#fff"];
       export const Example = () => <Chart colors={SERIES} />;`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    expect(directColorFindingsInSource(fixture, "array-alias.tsx").map(({ value }) => value)).toEqual(["#fff"]);
  });

  it("follows neutral identifiers from inline style values", () => {
    const fixture = ts.createSourceFile(
      "style-alias.tsx",
      `const BAD = "#fff";
       export const Example = () => <div style={{ color: BAD }} />;`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    expect(directColorFindingsInSource(fixture, "style-alias.tsx").map(({ value }) => value)).toEqual(["#fff"]);
  });

  it("follows neutral function returns and object members with cycle protection", () => {
    const fixture = ts.createSourceFile(
      "function-alias.tsx",
      `const VALUES = { primary: "oklch(0.4 0.1 20)" };
       const cycleA = cycleB;
       const cycleB = cycleA;
       function getValue() { return "hsl(12 80% 50%)"; }
       function getOther() { return VALUES.primary; }
       export const Example = () => <>
         <Chart color={getValue()} fill={getOther()} />
         <div style={{ background: cycleA }} />
       </>;`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    expect(directColorFindingsInSource(fixture, "function-alias.tsx").map(({ value }) => value)).toEqual([
      "oklch(0.4 0.1 20)",
      "hsl(12 80% 50%)"
    ]);
  });

  it("reduces the 262-style historical baseline by at least 25 percent", () => {
    expect(staticInlineStyleCount(auditedFiles)).toBeLessThanOrEqual(MAX_STATIC_INLINE_STYLES);
  });
});
