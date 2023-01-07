declare module "json-lint" {
  export interface JSONLintResult {}
  export interface JSONLintNormalResult extends JSONLintResult {}
  export interface JSONLintErrorResult extends JSONLintResult {
    line: number;
    error: string;
  }

  export default function JSONLint(json: string): JSONLintErrorResult | JSONLintNormalResult;
}
