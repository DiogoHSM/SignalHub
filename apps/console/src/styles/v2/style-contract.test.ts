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
  type Projection = Array<string | number>;
  type Binding = {
    initializer?: ts.Expression;
    projection: Projection;
    fallbacks: ts.Expression[];
    callable?: ts.FunctionLikeDeclaration;
  };

  const findings: Array<Finding & { position: number }> = [];
  const bindingsByScope = new Map<ts.Node, Map<string, Binding>>();
  const findingPositions = new Set<number>();

  const isLexicalScope = (node: ts.Node): boolean => (
    ts.isSourceFile(node)
    || ts.isBlock(node)
    || ts.isCaseBlock(node)
    || ts.isForStatement(node)
    || ts.isForInStatement(node)
    || ts.isForOfStatement(node)
    || ts.isCatchClause(node)
    || ts.isFunctionLike(node)
  );

  const declarationScope = (node: ts.Node, blockScoped: boolean): ts.Node => {
    let current = node.parent;
    while (current) {
      if (ts.isSourceFile(current)) return current;
      if (ts.isFunctionLike(current)) return current;
      if (blockScoped && isLexicalScope(current)) return current;
      current = current.parent;
    }
    return sourceFile;
  };

  const register = (scope: ts.Node, name: string, binding: Binding): void => {
    let scopedBindings = bindingsByScope.get(scope);
    if (!scopedBindings) {
      scopedBindings = new Map<string, Binding>();
      bindingsByScope.set(scope, scopedBindings);
    }
    scopedBindings.set(name, binding);
  };

  const propertyKey = (name: ts.PropertyName | undefined): string | number | undefined => {
    if (!name) return undefined;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
    if (ts.isNumericLiteral(name)) return Number(name.text);
    return undefined;
  };

  const registerPattern = (
    name: ts.BindingName,
    scope: ts.Node,
    initializer: ts.Expression | undefined,
    projection: Projection = [],
    fallbacks: ts.Expression[] = []
  ): void => {
    if (ts.isIdentifier(name)) {
      register(scope, name.text, { initializer, projection, fallbacks });
      return;
    }
    if (ts.isArrayBindingPattern(name)) {
      name.elements.forEach((element, index) => {
        if (ts.isOmittedExpression(element)) return;
        registerPattern(
          element.name,
          scope,
          initializer,
          element.dotDotDotToken ? projection : [...projection, index],
          element.initializer ? [...fallbacks, element.initializer] : fallbacks
        );
      });
      return;
    }
    for (const element of name.elements) {
      const key = propertyKey(element.propertyName) ?? (ts.isIdentifier(element.name) ? element.name.text : undefined);
      registerPattern(
        element.name,
        scope,
        initializer,
        element.dotDotDotToken || key == null ? projection : [...projection, key],
        element.initializer ? [...fallbacks, element.initializer] : fallbacks
      );
    }
  };

  const collectDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      const declarationList = node.parent;
      const blockScoped = ts.isVariableDeclarationList(declarationList)
        && (declarationList.flags & ts.NodeFlags.BlockScoped) !== 0;
      registerPattern(node.name, declarationScope(node, blockScoped), node.initializer);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      register(declarationScope(node, true), node.name.text, {
        projection: [],
        fallbacks: [],
        callable: node
      });
    } else if (ts.isFunctionExpression(node) && node.name) {
      register(node, node.name.text, { projection: [], fallbacks: [], callable: node });
    }
    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) {
        registerPattern(parameter.name, node, parameter.initializer);
      }
    }
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      registerPattern(node.variableDeclaration.name, node, node.variableDeclaration.initializer);
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(sourceFile);

  const record = (position: number, value: string): void => {
    if (/^var\(\s*--[\w-]+(?:\s*,[^)]*)?\s*\)$/i.test(value.trim())) return;
    if (!directColor.test(value) || findingPositions.has(position)) return;
    findingPositions.add(position);
    findings.push({
      file,
      line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
      position,
      value
    });
  };

  const active = new Set<ts.Node>();
  const findBinding = (name: string, use: ts.Node): Binding | undefined => {
    let current: ts.Node | undefined = use;
    while (current) {
      const binding = bindingsByScope.get(current)?.get(name);
      if (binding) return binding;
      current = current.parent;
    }
    return undefined;
  };

  const resolveFunction = (node: ts.FunctionLikeDeclaration, projection: Projection = []): void => {
    if (!node.body) return;
    if (!ts.isBlock(node.body)) {
      resolveExpression(node.body, projection);
      return;
    }
    const visitReturns = (child: ts.Node): void => {
      if (child !== node.body && ts.isFunctionLike(child)) return;
      if (ts.isReturnStatement(child) && child.expression) resolveExpression(child.expression, projection);
      ts.forEachChild(child, visitReturns);
    };
    visitReturns(node.body);
  };

  const resolveExpression = (node: ts.Expression, projection: Projection = []): void => {
    if (active.has(node)) return;
    active.add(node);
    try {
      if (ts.isStringLiteralLike(node)) {
        record(node.getStart(sourceFile), node.text);
        return;
      }
      if (ts.isTemplateExpression(node)) {
        const staticText = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("");
        const display = node.getText(sourceFile).slice(1, -1);
        record(node.getStart(sourceFile), directColor.test(staticText) ? display : staticText);
        node.templateSpans.forEach((span) => resolveExpression(span.expression));
        return;
      }
      if (ts.isIdentifier(node)) {
        const binding = findBinding(node.text, node);
        if (!binding) return;
        if (binding.initializer) resolveExpression(binding.initializer, [...binding.projection, ...projection]);
        for (const fallback of binding.fallbacks) resolveExpression(fallback, projection);
        if (binding.callable) resolveFunction(binding.callable, projection);
        return;
      }
      if (ts.isCallExpression(node)) {
        resolveExpression(node.expression, projection);
        node.arguments.forEach((argument) => resolveExpression(argument));
        return;
      }
      if (ts.isPropertyAccessExpression(node)) {
        resolveExpression(node.expression, [node.name.text, ...projection]);
        return;
      }
      if (ts.isElementAccessExpression(node)) {
        const key = node.argumentExpression && (
          ts.isStringLiteralLike(node.argumentExpression)
            ? node.argumentExpression.text
            : ts.isNumericLiteral(node.argumentExpression)
              ? Number(node.argumentExpression.text)
              : undefined
        );
        resolveExpression(node.expression, key == null ? [] : [key, ...projection]);
        return;
      }
      if (ts.isObjectLiteralExpression(node)) {
        if (projection.length > 0) {
          const [wanted, ...remaining] = projection;
          let matched = false;
          for (const property of node.properties) {
            if (ts.isSpreadAssignment(property)) {
              resolveExpression(property.expression, projection);
              continue;
            }
            const key = propertyKey(property.name);
            if (key !== wanted && String(key) !== String(wanted)) continue;
            matched = true;
            if (ts.isPropertyAssignment(property)) resolveExpression(property.initializer, remaining);
            else if (ts.isShorthandPropertyAssignment(property)) resolveExpression(property.name, remaining);
            else if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property)) {
              resolveFunction(property, remaining);
            }
          }
          if (matched) return;
        }
        for (const property of node.properties) {
          if (ts.isPropertyAssignment(property)) resolveExpression(property.initializer);
          else if (ts.isShorthandPropertyAssignment(property)) resolveExpression(property.name);
          else if (ts.isSpreadAssignment(property)) resolveExpression(property.expression);
          else if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property)) resolveFunction(property);
        }
        return;
      }
      if (ts.isArrayLiteralExpression(node)) {
        if (projection.length > 0 && typeof projection[0] === "number") {
          const [index, ...remaining] = projection;
          const element = node.elements[index];
          if (element && !ts.isOmittedExpression(element)) {
            resolveExpression(ts.isSpreadElement(element) ? element.expression : element, remaining);
            return;
          }
        }
        for (const element of node.elements) {
          if (!ts.isOmittedExpression(element)) {
            resolveExpression(ts.isSpreadElement(element) ? element.expression : element);
          }
        }
        return;
      }
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        resolveFunction(node, projection);
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
      if (ts.isStringLiteral(node.initializer)) record(node.initializer.getStart(sourceFile), node.initializer.text);
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        resolveExpression(node.initializer.expression);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings
    .sort((left, right) => left.position - right.position)
    .map(({ position: _position, ...finding }) => finding);
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

  it("finds dynamic color function prefixes in interpolated templates", () => {
    const fixture = ts.createSourceFile(
      "template-alias.tsx",
      "const hue = 12;\n"
        + "const shade = `hsl(${hue} 80% 50%)`;\n"
        + "export const Example = () => <div style={{ color: shade }} />;",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    expect(directColorFindingsInSource(fixture, "template-alias.tsx").map(({ value }) => value)).toEqual([
      "hsl(${hue} 80% 50%)"
    ]);
  });

  it("resolves array and object destructured aliases used by color consumers", () => {
    const fixture = ts.createSourceFile(
      "destructured-alias.tsx",
      `const [shade] = ["#abc"];
       const { tone } = { tone: "oklch(0.4 0.1 20)" };
       export const Example = () => <Chart color={shade} fill={tone} />;`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    expect(directColorFindingsInSource(fixture, "destructured-alias.tsx").map(({ value }) => value)).toEqual([
      "#abc",
      "oklch(0.4 0.1 20)"
    ]);
  });

  it("keeps unrelated inner bindings from shadowing an outer color consumer", () => {
    const fixture = ts.createSourceFile(
      "outer-shadow.tsx",
      `const pigment = "#abc";
       function unrelated() { const pigment = "transparent"; return pigment; }
       export const Example = () => <Chart color={pigment} />;`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    expect(directColorFindingsInSource(fixture, "outer-shadow.tsx").map(({ value }) => value)).toEqual(["#abc"]);
  });

  it("resolves a consumer to its nearest inner binding", () => {
    const fixture = ts.createSourceFile(
      "inner-shadow.tsx",
      `export function Example() {
         const sample = "hsl(12 80% 50%)";
         return <Chart color={sample} />;
       }
       const sample = "#abc";`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    expect(directColorFindingsInSource(fixture, "inner-shadow.tsx").map(({ value }) => value)).toEqual([
      "hsl(12 80% 50%)"
    ]);
  });

  it("lets a defaulted parameter binding shadow an outer color", () => {
    const fixture = ts.createSourceFile(
      "parameter-shadow.tsx",
      `const tone = "#abc";
       export function Example({ tone = "oklch(0.4 0.1 20)" }) {
         return <Chart color={tone} />;
       }`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    expect(directColorFindingsInSource(fixture, "parameter-shadow.tsx").map(({ value }) => value)).toEqual([
      "oklch(0.4 0.1 20)"
    ]);
  });

  it("reduces the 262-style historical baseline by at least 25 percent", () => {
    expect(staticInlineStyleCount(auditedFiles)).toBeLessThanOrEqual(MAX_STATIC_INLINE_STYLES);
  });
});
